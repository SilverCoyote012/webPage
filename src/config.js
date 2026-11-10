// Configuración central: lee las variables del archivo .env
require('dotenv').config({ quiet: true });
const path = require('path');

const port = Number(process.env.PORT) || 3000;

module.exports = {
  port,
  isProd: process.env.NODE_ENV === 'production',
  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  trustProxy: process.env.TRUST_PROXY === '1',
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@mitienda.mx').trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  stripeSecretKey: (process.env.STRIPE_SECRET_KEY || '').trim(),
  stripeWebhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  currency: 'mxn',
};
