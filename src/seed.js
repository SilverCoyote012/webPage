// Carga los productos de ejemplo la primera vez (o al ejecutar "npm run seed" con la tienda vacía).
const { db, setSettings, uniqueSlug } = require('./db');
const { slugify } = require('./util');
const ejemplo = require('./catalogo-ejemplo');

function seedIfEmpty() {
  const yaCargado = db.prepare("SELECT 1 FROM settings WHERE key = 'ejemplo_cargado'").get();
  const hayProductos = db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0;
  if (yaCargado || hayProductos) return false;

  db.transaction(() => {
    const ids = {};
    ejemplo.categorias.forEach((c, i) => {
      const slug = uniqueSlug('categories', slugify(c.name));
      ids[c.key] = db.prepare('INSERT INTO categories (name, slug, position) VALUES (?, ?, ?)').run(c.name, slug, i + 1).lastInsertRowid;
    });
    const insert = db.prepare(
      `INSERT INTO products (name, slug, description, price_cents, compare_price_cents, stock, category_id,
                             origin, image, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of ejemplo.productos) {
      insert.run(p.name, uniqueSlug('products', slugify(p.name)), p.description, p.price * 100,
        p.compare ? p.compare * 100 : null, p.stock, ids[p.cat], p.origin, `/img/productos/${p.img}.svg`, p.featured);
    }
    setSettings({ ejemplo_cargado: '1' });
  })();
  console.log(`Se cargaron ${ejemplo.productos.length} productos de ejemplo.`);
  return true;
}

if (require.main === module) {
  console.log(seedIfEmpty() ? 'Listo.' : 'La tienda ya tiene datos: no se cargó nada.');
}

module.exports = { seedIfEmpty };
