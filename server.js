// Punto de entrada de la tienda.
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./src/config');
const { getSettings } = require('./src/db');
const auth = require('./src/auth');
const orders = require('./src/orders');
const payments = require('./src/payments');
const util = require('./src/util');
require('./src/seed').seedIfEmpty();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  strictTransportSecurity: config.isProd,
}));

// Webhook de Stripe: necesita el cuerpo sin procesar para verificar la firma.
app.post('/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  try {
    payments.handleWebhook(req.body, req.headers['stripe-signature']);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook de Stripe rechazado:', err.message);
    res.status(400).send('Webhook no válido');
  }
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
app.use('/uploads', express.static(path.join(config.dataDir, 'uploads'), { maxAge: '30d', index: false }));

// Datos disponibles en todas las plantillas.
app.use((req, res, next) => {
  res.locals.tienda = getSettings();
  res.locals.money = util.money;
  res.locals.fecha = util.fecha;
  res.locals.centsToInput = util.centsToInput;
  res.locals.numeroPedido = util.numeroPedido;
  res.locals.ESTADOS_PEDIDO = util.ESTADOS_PEDIDO;
  res.locals.paymentMode = payments.mode;
  res.locals.path = req.path;
  res.locals.title = '';
  next();
});

app.use(auth.loadSession);
app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/tienda'));

app.use((req, res) => {
  const view = req.path.startsWith('/admin') && req.admin ? 'admin/404' : 'tienda/404';
  res.status(404).render(view, { title: 'Página no encontrada', seccion: '', aviso: '' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return;
  const status = err.status || 500;
  if (req.path.startsWith('/api/')) return res.status(status).json({ error: 'Ocurrió un error. Inténtalo de nuevo.' });
  res.status(status).send('Ocurrió un error inesperado. Vuelve atrás e inténtalo de nuevo.');
});

auth.ensureAdmin();

// Cada 10 minutos se liberan las piezas de pedidos que nunca se pagaron.
orders.expireStaleOrders();
setInterval(() => {
  try { orders.expireStaleOrders(); } catch (err) { console.error(err); }
}, 10 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`Tienda lista en ${config.baseUrl}`);
  console.log(`Panel de administración: ${config.baseUrl}/admin`);
  if (payments.mode === 'demo') {
    console.log('Pagos: MODO DEMOSTRACIÓN (simulados). Agrega STRIPE_SECRET_KEY en .env para cobrar de verdad.');
  } else {
    console.log(`Pagos: Stripe ${payments.isTestMode ? '(modo de prueba)' : '(modo real)'}`);
  }
});
