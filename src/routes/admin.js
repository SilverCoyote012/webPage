// Panel de administración.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { db, getSettings, setSettings, uniqueSlug } = require('../db');
const auth = require('../auth');
const orders = require('../orders');
const payments = require('../payments');
const { clean, cleanMultiline, toCents, slugify, ESTADOS_PEDIDO } = require('../util');

const router = express.Router();
const uploadsDir = path.join(config.dataDir, 'uploads');

router.use(express.urlencoded({ extended: false, limit: '100kb' }));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.locals.seccion = '';
  res.locals.aviso = AVISOS[req.query.aviso] || '';
  next();
});

const AVISOS = {
  guardado: 'Cambios guardados.',
  creado: 'Producto creado.',
  eliminado: 'Eliminado correctamente.',
  password: 'Contraseña actualizada. Vuelve a iniciar sesión en tus otros dispositivos.',
  'categoria-en-uso': 'Categoría eliminada. Sus productos quedaron sin categoría.',
};

// ---------- Inicio de sesión ----------
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).render('admin/login', {
    title: 'Entrar', error: 'Demasiados intentos. Espera 15 minutos.', email: '',
  }),
});

router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Entrar', error: '', email: '' });
});

router.post('/login', loginLimiter, (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  const ok = admin
    ? auth.verifyPassword(String(req.body.password || ''), admin.password_hash)
    : (auth.hashPassword('tiempo-constante'), false);
  if (!ok) {
    return res.status(401).render('admin/login', { title: 'Entrar', error: 'Correo o contraseña incorrectos.', email });
  }
  auth.login(res, admin.id);
  res.redirect('/admin');
});

// A partir de aquí todo requiere sesión.
router.use(auth.requireAdmin);

// Subida de fotos (JPG, PNG o WebP de hasta 5 MB).
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (EXT[file.mimetype]) return cb(null, true);
    cb(new Error('La foto debe ser JPG, PNG o WebP.'));
  },
});
const uploadImage = (req, res, next) => upload.single('image')(req, res, (err) => {
  if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'La foto pesa más de 5 MB.' : err.message;
  next();
});

function removeUpload(image) {
  if (!image || !image.startsWith('/uploads/')) return;
  fs.rm(path.join(uploadsDir, path.basename(image)), { force: true }, () => {});
}

// Los formularios con archivo pasan por multer antes de revisar el token CSRF.
router.post(/^\/productos(\/\d+)?$/, uploadImage);
router.post('/{*ruta}', (req, res, next) => {
  // Si la petición se rechaza, no se conserva la foto que venía en ella.
  res.on('finish', () => { if (res.statusCode === 403 && req.file) removeUpload(`/uploads/${req.file.filename}`); });
  next();
}, auth.requireCsrf);

router.post('/logout', (req, res) => {
  auth.logout(req, res);
  res.redirect('/admin/login');
});

// ---------- Resumen ----------
router.get('/', (req, res) => {
  const PAGADOS = "status IN ('pagado','enviado','entregado')";
  // Las fechas se guardan en UTC; para "hoy" usamos la hora del centro de México (UTC-6).
  const ventas = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN date(paid_at,'-6 hours') = date('now','-6 hours') THEN total_cents END), 0) AS hoy,
       COALESCE(SUM(CASE WHEN paid_at >= datetime('now','-30 days') THEN total_cents END), 0) AS mes,
       COUNT(CASE WHEN paid_at >= datetime('now','-30 days') THEN 1 END) AS pedidos_mes
     FROM orders WHERE ${PAGADOS}`
  ).get();
  const porEnviar = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pagado'").get().n;
  const pocoStock = db.prepare(
    'SELECT id, name, stock, image FROM products WHERE active = 1 AND stock <= 3 ORDER BY stock, name LIMIT 8'
  ).all();
  const recientes = db.prepare("SELECT * FROM orders WHERE status != 'cancelado' ORDER BY id DESC LIMIT 6").all();

  const porDia = new Map(db.prepare(
    `SELECT date(paid_at,'-6 hours') AS dia, SUM(total_cents) AS total
       FROM orders WHERE ${PAGADOS} AND paid_at >= datetime('now','-15 days') GROUP BY dia`
  ).all().map((r) => [r.dia, r.total]));
  const dias = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - 6 * 3600e3 - i * 86400e3);
    const key = d.toISOString().slice(0, 10);
    dias.push({ key, label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, total: porDia.get(key) || 0 });
  }

  res.render('admin/resumen', {
    title: 'Resumen', seccion: 'resumen', ventas, porEnviar, pocoStock, recientes, dias,
    totalProductos: db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
  });
});

// ---------- Productos ----------
router.get('/productos', (req, res) => {
  const q = clean(req.query.q, 60);
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const productos = db.prepare(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.name LIKE ? ESCAPE '\\' ORDER BY p.id DESC`
  ).all(like);
  res.render('admin/productos', { title: 'Productos', seccion: 'productos', productos, q });
});

const categoriasTodas = () => db.prepare('SELECT * FROM categories ORDER BY position, name').all();

function renderProductForm(res, producto, error = '') {
  res.status(error ? 422 : 200).render('admin/producto-form', {
    title: producto.id ? 'Editar producto' : 'Nuevo producto',
    seccion: 'productos', producto, categorias: categoriasTodas(), error,
  });
}

router.get('/productos/nuevo', (req, res) => {
  renderProductForm(res, { name: '', description: '', price_cents: null, compare_price_cents: null,
    stock: 1, category_id: null, origin: '', image: '', featured: 0, active: 1 });
});

router.get('/productos/:id', (req, res, next) => {
  const producto = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!producto) return next();
  renderProductForm(res, producto);
});

/** Lee y valida el formulario de producto. Devuelve { data, error }. */
function readProductForm(req) {
  const b = req.body || {};
  const price = toCents(b.price);
  const compare = b.compare_price ? toCents(b.compare_price) : null;
  const stock = Number(b.stock);
  const categoryId = Number(b.category_id) || null;
  const data = {
    name: clean(b.name, 140),
    description: cleanMultiline(b.description, 4000),
    price_cents: price,
    compare_price_cents: compare && price != null && compare > price ? compare : null,
    stock: Number.isInteger(stock) && stock >= 0 ? stock : 0,
    category_id: categoryId && db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId) ? categoryId : null,
    origin: clean(b.origin, 60),
    featured: b.featured ? 1 : 0,
    active: b.active ? 1 : 0,
  };
  let error = req.uploadError || '';
  if (!error && data.name.length < 2) error = 'Escribe el nombre del producto.';
  if (!error && (price == null || price <= 0)) error = 'Escribe un precio válido, por ejemplo 1299 o 1299.50.';
  if (!error && price > 99999999) error = 'El precio es demasiado alto.';
  if (!error && b.compare_price && compare == null) error = 'El precio anterior no es válido.';
  if (!error && (!Number.isInteger(stock) || stock < 0)) error = 'Las existencias deben ser un número entero (0 o más).';
  return { data, error };
}

router.post('/productos', (req, res) => {
  const { data, error } = readProductForm(req);
  if (error) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    return renderProductForm(res, { ...data, image: '' }, error);
  }
  data.image = req.file ? `/uploads/${req.file.filename}` : '';
  data.slug = uniqueSlug('products', slugify(data.name));
  db.prepare(
    `INSERT INTO products (name, slug, description, price_cents, compare_price_cents, stock, category_id,
                           origin, image, featured, active)
     VALUES (@name, @slug, @description, @price_cents, @compare_price_cents, @stock, @category_id,
             @origin, @image, @featured, @active)`
  ).run(data);
  res.redirect('/admin/productos?aviso=creado');
});

router.post('/productos/:id', (req, res, next) => {
  const actual = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!actual) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    return next();
  }
  const { data, error } = readProductForm(req);
  if (error) {
    if (req.file) removeUpload(`/uploads/${req.file.filename}`);
    return renderProductForm(res, { ...actual, ...data }, error);
  }
  data.image = actual.image;
  if (req.file) data.image = `/uploads/${req.file.filename}`;
  else if (req.body.remove_image) data.image = '';
  if (data.image !== actual.image) removeUpload(actual.image);
  data.slug = data.name === actual.name ? actual.slug : uniqueSlug('products', slugify(data.name), actual.id);
  data.id = actual.id;
  db.prepare(
    `UPDATE products SET name=@name, slug=@slug, description=@description, price_cents=@price_cents,
            compare_price_cents=@compare_price_cents, stock=@stock, category_id=@category_id, origin=@origin,
            image=@image, featured=@featured, active=@active WHERE id=@id`
  ).run(data);
  res.redirect('/admin/productos?aviso=guardado');
});

router.post('/productos/:id/eliminar', (req, res) => {
  const actual = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (actual) {
    db.prepare('DELETE FROM products WHERE id = ?').run(actual.id);
    // Los pedidos anteriores conservan nombre y foto: solo se borra la foto si ningún pedido la usa.
    if (!db.prepare('SELECT 1 FROM order_items WHERE image = ?').get(actual.image)) removeUpload(actual.image);
  }
  res.redirect('/admin/productos?aviso=eliminado');
});

// ---------- Categorías ----------
router.get('/categorias', (req, res) => {
  const categorias = db.prepare(
    `SELECT c.*, COUNT(p.id) AS total FROM categories c LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id ORDER BY c.position, c.name`
  ).all();
  res.render('admin/categorias', { title: 'Categorías', seccion: 'categorias', categorias });
});

router.post('/categorias', (req, res) => {
  const name = clean(req.body.name, 60);
  if (name) {
    const position = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM categories').get().n;
    db.prepare('INSERT INTO categories (name, slug, position) VALUES (?, ?, ?)')
      .run(name, uniqueSlug('categories', slugify(name)), position);
  }
  res.redirect('/admin/categorias?aviso=guardado');
});

router.post('/categorias/:id', (req, res) => {
  const name = clean(req.body.name, 60);
  const position = Number.isInteger(Number(req.body.position)) ? Number(req.body.position) : 0;
  if (name) db.prepare('UPDATE categories SET name = ?, position = ? WHERE id = ?').run(name, position, req.params.id);
  res.redirect('/admin/categorias?aviso=guardado');
});

router.post('/categorias/:id/eliminar', (req, res) => {
  const usada = db.prepare('SELECT 1 FROM products WHERE category_id = ?').get(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect(`/admin/categorias?aviso=${usada ? 'categoria-en-uso' : 'eliminado'}`);
});

// ---------- Pedidos ----------
router.get('/pedidos', (req, res) => {
  const estado = ESTADOS_PEDIDO[req.query.estado] ? req.query.estado : '';
  const pedidos = estado
    ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 300').all(estado)
    : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all();
  const conteo = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, r.n])
  );
  res.render('admin/pedidos', { title: 'Pedidos', seccion: 'pedidos', pedidos, estado, conteo });
});

router.get('/pedidos/:id', (req, res, next) => {
  const order = orders.getOrder(req.params.id);
  if (!order) return next();
  res.render('admin/pedido', {
    title: 'Pedido', seccion: 'pedidos', order, items: orders.getItems(order.id), paymentMode: payments.mode,
  });
});

router.post('/pedidos/:id', (req, res, next) => {
  const order = orders.getOrder(req.params.id);
  if (!order) return next();
  const nuevo = String(req.body.status || '');
  const tracking = clean(req.body.tracking, 120);
  db.prepare('UPDATE orders SET tracking = ? WHERE id = ?').run(tracking, order.id);

  if (nuevo !== order.status && ESTADOS_PEDIDO[nuevo]) {
    if (nuevo === 'cancelado') orders.cancelOrder(order.id);
    else if (nuevo === 'pagado' && ['pendiente', 'cancelado'].includes(order.status)) orders.markPaid(order.id);
    else if (['pagado', 'enviado', 'entregado'].includes(nuevo) && ['pagado', 'enviado', 'entregado'].includes(order.status)) {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(nuevo, order.id);
    }
  }
  res.redirect(`/admin/pedidos/${order.id}?aviso=guardado`);
});

// ---------- Ajustes ----------
function renderSettings(res, extra = {}) {
  res.status(extra.error || extra.passwordError ? 422 : 200).render('admin/ajustes', {
    title: 'Ajustes', seccion: 'ajustes', ajustes: getSettings(), error: '', passwordError: '',
    paymentMode: payments.mode, isTestMode: payments.isTestMode,
    webhookListo: Boolean(config.stripeWebhookSecret), baseUrl: config.baseUrl, ...extra,
  });
}

router.get('/ajustes', (req, res) => renderSettings(res));

router.post('/ajustes', (req, res) => {
  const shipping = toCents(req.body.shipping || '0');
  const freeFrom = toCents(req.body.free_shipping_from || '0');
  const storeName = clean(req.body.store_name, 40);
  if (!storeName) return renderSettings(res, { error: 'Escribe el nombre de la tienda.' });
  if (shipping == null || freeFrom == null) return renderSettings(res, { error: 'Revisa los montos de envío.' });
  setSettings({
    store_name: storeName,
    tagline: clean(req.body.tagline, 90),
    announcement: clean(req.body.announcement, 120),
    whatsapp: clean(req.body.whatsapp, 20).replace(/\D/g, ''),
    contact_email: clean(req.body.contact_email, 160),
    shipping_cents: shipping,
    free_shipping_from_cents: freeFrom,
  });
  res.redirect('/admin/ajustes?aviso=guardado');
});

router.post('/ajustes/password', (req, res) => {
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  const actual = String(req.body.current || '');
  const nueva = String(req.body.password || '');
  if (!auth.verifyPassword(actual, admin.password_hash)) {
    return renderSettings(res, { passwordError: 'La contraseña actual no es correcta.' });
  }
  if (nueva.length < 10) return renderSettings(res, { passwordError: 'La nueva contraseña debe tener al menos 10 caracteres.' });
  if (nueva !== String(req.body.confirm || '')) return renderSettings(res, { passwordError: 'Las contraseñas nuevas no coinciden.' });
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(auth.hashPassword(nueva), admin.id);
  auth.logoutEverywhere(admin.id);
  auth.login(res, admin.id);
  res.redirect('/admin/ajustes?aviso=password');
});

module.exports = router;
