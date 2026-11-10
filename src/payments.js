// Cobros. Con claves de Stripe se usa Stripe Checkout (página de pago alojada por Stripe:
// los datos de tarjeta nunca pasan por este servidor). Sin claves, la tienda trabaja en
// modo demostración con pagos simulados.
const config = require('./config');
const orders = require('./orders');

const stripe = config.stripeSecretKey ? require('stripe')(config.stripeSecretKey) : null;
const mode = stripe ? 'stripe' : 'demo';
const isTestMode = mode === 'stripe' && config.stripeSecretKey.startsWith('sk_test_');

/** Inicia el cobro de un pedido y devuelve la dirección a la que hay que enviar al cliente. */
async function startPayment(order, items) {
  if (mode === 'demo') {
    orders.setPaymentRef(order.id, 'demo', '');
    return `/pago-demo/${order.token}`;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    locale: 'es-419',
    customer_email: order.email,
    client_reference_id: String(order.id),
    metadata: { order_id: String(order.id) },
    payment_intent_data: { metadata: { order_id: String(order.id) } },
    line_items: items.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: config.currency,
        unit_amount: item.price_cents,
        product_data: { name: item.name },
      },
    })),
    shipping_options: [{
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: order.shipping_cents === 0 ? 'Envío gratis' : 'Envío estándar',
        fixed_amount: { amount: order.shipping_cents, currency: config.currency },
      },
    }],
    // La sesión de pago caduca a los 35 minutos; después se libera el inventario.
    expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
    success_url: `${config.baseUrl}/pedido/${order.token}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.baseUrl}/pedido/${order.token}?cancelado=1`,
  });
  orders.setPaymentRef(order.id, 'stripe', session.id);
  return session.url;
}

/** Aplica al pedido lo que diga una sesión de Stripe Checkout. */
function applySession(session, eventType) {
  const orderId = Number(session.metadata && session.metadata.order_id);
  const order = orderId ? orders.getOrder(orderId) : null;
  if (!order || order.payment_ref !== session.id) return;

  if (eventType === 'checkout.session.expired' || eventType === 'checkout.session.async_payment_failed') {
    if (order.status === 'pendiente') orders.cancelOrder(order.id);
  } else if (session.payment_status === 'paid' && session.amount_total === order.total_cents) {
    orders.markPaid(order.id);
  } else if (session.status === 'complete' && session.payment_status === 'unpaid') {
    // Pagos diferidos (p. ej. OXXO): el cliente aún debe pagar la ficha.
    orders.markAsyncPending(order.id);
  }
}

/** Al volver de Stripe confirmamos el pago directo con su API (por si el webhook tarda). */
async function confirmOnReturn(order, sessionId) {
  if (mode !== 'stripe' || order.status !== 'pendiente') return;
  if (!sessionId || order.payment_ref !== sessionId) return;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  applySession(session, 'return');
}

/** El cliente abandonó el pago: se cierra la sesión de Stripe y se cancela el pedido. */
async function abandon(order) {
  if (mode !== 'stripe' || order.status !== 'pendiente' || !order.payment_ref) return;
  try {
    const session = await stripe.checkout.sessions.retrieve(order.payment_ref);
    if (session.status === 'complete') return applySession(session, 'return');
    if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
  } catch (err) {
    console.error('No se pudo cerrar la sesión de pago:', err.message);
    return;
  }
  orders.cancelOrder(order.id);
}

/** Webhook de Stripe: verifica la firma y actualiza el pedido. */
function handleWebhook(rawBody, signature) {
  if (mode !== 'stripe' || !config.stripeWebhookSecret) {
    const err = new Error('Webhook no configurado'); err.status = 400; throw err;
  }
  const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  if (event.type.startsWith('checkout.session.')) applySession(event.data.object, event.type);
}

module.exports = { mode, isTestMode, startPayment, confirmOnReturn, abandon, handleWebhook };
