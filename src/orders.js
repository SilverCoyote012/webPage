// Lógica de pedidos: crear, pagar, cancelar y liberar inventario.
const crypto = require('crypto');
const { db, getSettings } = require('./db');
const { clean, cleanMultiline, ESTADOS_MX } = require('./util');

class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.isPublic = true; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateCustomer(input = {}) {
  const c = {
    customer_name: clean(input.nombre, 120),
    email: clean(input.email, 160).toLowerCase(),
    phone: clean(input.telefono, 30),
    address_line: clean(input.direccion, 200),
    neighborhood: clean(input.colonia, 120),
    postal_code: clean(input.cp, 5),
    city: clean(input.ciudad, 120),
    state: clean(input.estado, 60),
    notes: cleanMultiline(input.notas, 500),
  };
  if (c.customer_name.length < 3) throw new PublicError('Escribe tu nombre completo.');
  if (!EMAIL_RE.test(c.email)) throw new PublicError('Revisa tu correo electrónico.');
  if (c.phone.replace(/\D/g, '').length < 10) throw new PublicError('Escribe un teléfono de 10 dígitos.');
  if (c.address_line.length < 5) throw new PublicError('Escribe la calle y el número.');
  if (!c.neighborhood) throw new PublicError('Escribe la colonia.');
  if (!/^\d{5}$/.test(c.postal_code)) throw new PublicError('El código postal debe tener 5 dígitos.');
  if (!c.city) throw new PublicError('Escribe la ciudad o municipio.');
  if (!ESTADOS_MX.includes(c.state)) throw new PublicError('Selecciona un estado.');
  return c;
}

/** Junta cantidades repetidas y valida el formato del carrito. */
function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new PublicError('Tu carrito está vacío.');
  if (items.length > 50) throw new PublicError('Demasiados productos en un solo pedido.');
  const byId = new Map();
  for (const item of items) {
    const id = Number(item && item.id);
    const qty = Number(item && item.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      throw new PublicError('El carrito tiene datos no válidos. Vuelve a agregar los productos.');
    }
    byId.set(id, (byId.get(id) || 0) + qty);
  }
  return [...byId].map(([id, qty]) => ({ id, qty }));
}

function shippingFor(subtotalCents, settings = getSettings()) {
  const free = settings.free_shipping_from_cents;
  if (free > 0 && subtotalCents >= free) return 0;
  return settings.shipping_cents;
}

/**
 * Crea el pedido con precios tomados de la base de datos (nunca del navegador)
 * y aparta el inventario. Todo en una sola transacción.
 */
const createOrder = db.transaction((customerInput, itemsInput) => {
  const customer = validateCustomer(customerInput);
  const items = normalizeItems(itemsInput);
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
  const lines = [];
  let subtotal = 0;

  for (const { id, qty } of items) {
    const p = getProduct.get(id);
    if (!p) throw new PublicError('Uno de los productos ya no está disponible. Revisa tu carrito.', 409);
    if (p.stock < qty) {
      throw new PublicError(
        p.stock === 0 ? `"${p.name}" se agotó.` : `Solo quedan ${p.stock} piezas de "${p.name}".`, 409
      );
    }
    lines.push({ product: p, qty });
    subtotal += p.price_cents * qty;
  }

  const shipping = shippingFor(subtotal);
  const token = crypto.randomBytes(18).toString('base64url');
  const info = db.prepare(
    `INSERT INTO orders (token, customer_name, email, phone, address_line, neighborhood, postal_code,
                         city, state, notes, subtotal_cents, shipping_cents, total_cents)
     VALUES (@token, @customer_name, @email, @phone, @address_line, @neighborhood, @postal_code,
             @city, @state, @notes, @subtotal, @shipping, @total)`
  ).run({ ...customer, token, subtotal, shipping, total: subtotal + shipping });

  const addItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, name, image, price_cents, quantity) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const takeStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  for (const { product, qty } of lines) {
    addItem.run(info.lastInsertRowid, product.id, product.name, product.image, product.price_cents, qty);
    takeStock.run(qty, product.id);
  }
  return getOrder(info.lastInsertRowid);
});

const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
const getOrderByToken = (token) => db.prepare('SELECT * FROM orders WHERE token = ?').get(String(token));
const getItems = (orderId) => db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);

function setPaymentRef(orderId, provider, ref) {
  db.prepare('UPDATE orders SET payment_provider = ?, payment_ref = ? WHERE id = ?').run(provider, ref, orderId);
}

/** Marca el pedido como pagado. Es seguro llamarla varias veces. */
const markPaid = db.transaction((orderId) => {
  const order = getOrder(orderId);
  if (!order || !['pendiente', 'cancelado'].includes(order.status)) return false;
  if (!order.stock_reserved) {
    // El pedido se había cancelado y el pago llegó después: se vuelve a apartar el inventario.
    const take = db.prepare('UPDATE products SET stock = MAX(stock - ?, 0) WHERE id = ?');
    for (const item of getItems(orderId)) if (item.product_id) take.run(item.quantity, item.product_id);
  }
  db.prepare(
    `UPDATE orders SET status = 'pagado', async_pending = 0, stock_reserved = 1,
            paid_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
  ).run(orderId);
  return true;
});

/** Cancela el pedido y devuelve las piezas al inventario. */
const cancelOrder = db.transaction((orderId) => {
  const order = getOrder(orderId);
  if (!order || order.status === 'cancelado') return false;
  if (order.stock_reserved) {
    const giveBack = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
    for (const item of getItems(orderId)) if (item.product_id) giveBack.run(item.quantity, item.product_id);
  }
  db.prepare("UPDATE orders SET status = 'cancelado', async_pending = 0, stock_reserved = 0 WHERE id = ?").run(orderId);
  return true;
});

function markAsyncPending(orderId) {
  db.prepare("UPDATE orders SET async_pending = 1 WHERE id = ? AND status = 'pendiente'").run(orderId);
}

/** Libera el inventario de pedidos que nunca se pagaron (más de 1 hora). */
function expireStaleOrders() {
  const stale = db.prepare(
    `SELECT id FROM orders
      WHERE status = 'pendiente' AND async_pending = 0
        AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-60 minutes')`
  ).all();
  for (const { id } of stale) cancelOrder(id);
  return stale.length;
}

module.exports = {
  PublicError, createOrder, getOrder, getOrderByToken, getItems, setPaymentRef,
  markPaid, cancelOrder, markAsyncPending, expireStaleOrders, shippingFor,
};
