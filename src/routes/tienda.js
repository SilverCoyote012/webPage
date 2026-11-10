// Páginas públicas de la tienda y API del carrito.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const orders = require('../orders');
const payments = require('../payments');
const { clean, ESTADOS_MX } = require('../util');

const router = express.Router();
const PER_PAGE = 12;

const PRODUCT_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

const ORDEN = {
  recientes: 'p.created_at DESC, p.id DESC',
  'precio-asc': 'p.price_cents ASC',
  'precio-desc': 'p.price_cents DESC',
  nombre: 'p.name COLLATE NOCASE ASC',
};

// ---------- Inicio ----------
router.get('/', (req, res) => {
  const destacados = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 AND p.featured = 1 ORDER BY p.id LIMIT 8`).all();
  const nuevos = db.prepare(`${PRODUCT_SELECT} WHERE p.active = 1 ORDER BY p.created_at DESC, p.id DESC LIMIT 4`).all();
  const categorias = db.prepare(
    `SELECT c.*, COUNT(p.id) AS total,
            (SELECT image FROM products WHERE category_id = c.id AND active = 1 ORDER BY featured DESC, id LIMIT 1) AS image
       FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.active = 1
      GROUP BY c.id HAVING total > 0 ORDER BY c.position, c.name`
  ).all();
  res.render('tienda/inicio', { title: '', destacados, nuevos, categorias });
});

// ---------- Catálogo ----------
router.get('/productos', (req, res) => {
  const q = clean(req.query.q, 60);
  const categoriaSlug = clean(req.query.categoria, 80);
  const orden = ORDEN[req.query.orden] ? req.query.orden : 'recientes';
  const page = Math.max(1, parseInt(req.query.pagina, 10) || 1);

  const where = ['p.active = 1'];
  const params = [];
  const categoria = categoriaSlug ? db.prepare('SELECT * FROM categories WHERE slug = ?').get(categoriaSlug) : null;
  if (categoriaSlug) { where.push('c.slug = ?'); params.push(categoriaSlug); }
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR p.origin LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM products p LEFT JOIN categories c ON c.id = p.category_id ${whereSql}`
  ).get(...params).n;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const current = Math.min(page, pages);
  const productos = db.prepare(
    `${PRODUCT_SELECT} ${whereSql} ORDER BY ${ORDEN[orden]} LIMIT ? OFFSET ?`
  ).all(...params, PER_PAGE, (current - 1) * PER_PAGE);

  const linkFor = (overrides) => {
    const sp = new URLSearchParams();
    const state = { q, categoria: categoriaSlug, orden: orden === 'recientes' ? '' : orden, pagina: '', ...overrides };
    for (const [k, v] of Object.entries(state)) if (v) sp.set(k, v);
    const qs = sp.toString();
    return `/productos${qs ? `?${qs}` : ''}`;
  };

  const categoriasNav = db.prepare(
    `SELECT c.name, c.slug FROM categories c
      WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.active = 1)
      ORDER BY c.position, c.name`
  ).all();

  res.render('tienda/catalogo', {
    categoriasNav,
    title: categoria ? categoria.name : (q ? `Resultados para "${q}"` : 'Todos los productos'),
    productos, total, q, categoria, categoriaSlug, orden, page: current, pages, linkFor,
  });
});

// ---------- Producto ----------
router.get('/producto/:slug', (req, res, next) => {
  const producto = db.prepare(`${PRODUCT_SELECT} WHERE p.slug = ? AND p.active = 1`).get(req.params.slug);
  if (!producto) return next();
  const relacionados = db.prepare(
    `${PRODUCT_SELECT} WHERE p.active = 1 AND p.id != ? ORDER BY (p.category_id IS ?) DESC, p.featured DESC, p.id LIMIT 4`
  ).all(producto.id, producto.category_id);
  res.render('tienda/producto', { title: producto.name, producto, relacionados });
});

// ---------- Carrito y pago ----------
router.get('/carrito', (req, res) => res.render('tienda/carrito', { title: 'Tu carrito' }));
router.get('/pagar', (req, res) => res.render('tienda/pagar', { title: 'Finalizar compra', estados: ESTADOS_MX }));
router.get('/ayuda', (req, res) => res.render('tienda/ayuda', { title: 'Ayuda' }));

// Datos actuales (precio y existencias) de los productos del carrito.
router.get('/api/productos', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Number.isInteger).slice(0, 50);
  const productos = ids.length
    ? db.prepare(
        `SELECT id, name, slug, price_cents, stock, image, origin FROM products
          WHERE active = 1 AND id IN (${ids.map(() => '?').join(',')})`
      ).all(...ids)
    : [];
  const s = res.locals.tienda;
  res.set('Cache-Control', 'no-store').json({
    productos,
    envio: { costo: s.shipping_cents, gratisDesde: s.free_shipping_from_cents },
  });
});

const checkoutLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});

router.post('/api/checkout', checkoutLimiter, express.json({ limit: '50kb' }), async (req, res) => {
  let order;
  try {
    order = orders.createOrder(req.body && req.body.cliente, req.body && req.body.items);
  } catch (err) {
    if (err.isPublic) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  try {
    const url = await payments.startPayment(order, orders.getItems(order.id));
    res.json({ url });
  } catch (err) {
    console.error('No se pudo iniciar el pago:', err.message);
    orders.cancelOrder(order.id);
    res.status(502).json({ error: 'No pudimos conectar con el procesador de pagos. Inténtalo de nuevo en un momento.' });
  }
});

// ---------- Estado del pedido ----------
router.get('/pedido/:token', async (req, res, next) => {
  let order = orders.getOrderByToken(req.params.token);
  if (!order) return next();
  if (req.query.session_id) {
    try {
      await payments.confirmOnReturn(order, String(req.query.session_id));
      order = orders.getOrder(order.id);
    } catch (err) {
      console.error('No se pudo confirmar el pago al volver:', err.message);
    }
  }
  // El cliente regresó de la página de pago sin pagar: se libera el inventario de inmediato
  // para que pueda intentarlo otra vez desde su carrito.
  let volvioSinPagar = false;
  if (req.query.cancelado && order.status === 'pendiente' && !order.async_pending && order.payment_provider === 'stripe') {
    await payments.abandon(order);
    order = orders.getOrder(order.id);
    volvioSinPagar = order.status === 'cancelado';
  }
  res.set('Cache-Control', 'no-store');
  res.render('tienda/pedido', { title: 'Tu pedido', order, items: orders.getItems(order.id), volvioSinPagar });
});

// ---------- Pago simulado (solo en modo demostración) ----------
router.get('/pago-demo/:token', (req, res, next) => {
  if (payments.mode !== 'demo') return next();
  const order = orders.getOrderByToken(req.params.token);
  if (!order) return next();
  if (order.status !== 'pendiente') return res.redirect(`/pedido/${order.token}`);
  res.set('Cache-Control', 'no-store');
  res.render('tienda/pago-demo', { title: 'Pago de prueba', order, items: orders.getItems(order.id) });
});

router.post('/pago-demo/:token', express.urlencoded({ extended: false }), (req, res, next) => {
  if (payments.mode !== 'demo') return next();
  const order = orders.getOrderByToken(req.params.token);
  if (!order) return next();
  if (order.status === 'pendiente') {
    if (req.body.resultado === 'aprobado') orders.markPaid(order.id);
    else orders.cancelOrder(order.id);
  }
  res.redirect(303, `/pedido/${order.token}`);
});

module.exports = router;
