// Base de datos SQLite: un solo archivo en la carpeta de datos.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });

const db = new Database(path.join(config.dataDir, 'tienda.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  slug     TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  description         TEXT NOT NULL DEFAULT '',
  price_cents         INTEGER NOT NULL CHECK (price_cents >= 0),
  compare_price_cents INTEGER,
  stock               INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  category_id         INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  origin              TEXT NOT NULL DEFAULT '',
  image               TEXT NOT NULL DEFAULT '',
  featured            INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  token            TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pendiente',
  customer_name    TEXT NOT NULL,
  email            TEXT NOT NULL,
  phone            TEXT NOT NULL,
  address_line     TEXT NOT NULL,
  neighborhood     TEXT NOT NULL,
  postal_code      TEXT NOT NULL,
  city             TEXT NOT NULL,
  state            TEXT NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  subtotal_cents   INTEGER NOT NULL,
  shipping_cents   INTEGER NOT NULL,
  total_cents      INTEGER NOT NULL,
  payment_provider TEXT NOT NULL DEFAULT '',
  payment_ref      TEXT NOT NULL DEFAULT '',
  async_pending    INTEGER NOT NULL DEFAULT 0,
  stock_reserved   INTEGER NOT NULL DEFAULT 1,
  tracking         TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  paid_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  image       TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  quantity    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

// ---------- Ajustes de la tienda ----------
const DEFAULT_SETTINGS = {
  store_name: 'Mercante',
  tagline: 'Productos importados de todo el mundo',
  announcement: '',
  whatsapp: '',
  contact_email: '',
  shipping_cents: '14900',
  free_shipping_from_cents: '149900',
};

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  out.shipping_cents = Number(out.shipping_cents) || 0;
  out.free_shipping_from_cents = Number(out.free_shipping_from_cents) || 0;
  return out;
}

const upsertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
function setSettings(values) {
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) upsertSetting.run(key, String(value));
  })();
}

/** Genera un slug que no choque con otro registro de la tabla. */
function uniqueSlug(table, base, excludeId = 0) {
  if (!['products', 'categories'].includes(table)) throw new Error('tabla no permitida');
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`);
  let slug = base;
  for (let n = 2; exists.get(slug, excludeId); n++) slug = `${base}-${n}`;
  return slug;
}

module.exports = { db, getSettings, setSettings, uniqueSlug };
