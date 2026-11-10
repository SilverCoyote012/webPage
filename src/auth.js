// Acceso al panel: contraseñas con scrypt y sesiones guardadas en la base de datos.
const crypto = require('crypto');
const { db } = require('./db');
const config = require('./config');

const COOKIE = 'sid';
const SESSION_MS = 1000 * 60 * 60 * 24 * 7; // 7 días

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProd, path: '/', maxAge: SESSION_MS };
}

function login(res, adminId) {
  const id = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (id_hash, admin_id, csrf, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(id), adminId, crypto.randomBytes(24).toString('hex'), Date.now() + SESSION_MS);
  res.cookie(COOKIE, id, cookieOptions());
}

function logout(req, res) {
  const id = readCookie(req, COOKIE);
  if (id) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(id));
  res.clearCookie(COOKIE, { path: '/' });
}

/** Cierra todas las sesiones de un administrador (p. ej. al cambiar la contraseña). */
function logoutEverywhere(adminId) {
  db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId);
}

/** Carga la sesión (si existe) en req.admin y res.locals. */
function loadSession(req, res, next) {
  const id = readCookie(req, COOKIE);
  if (id) {
    const row = db.prepare(
      `SELECT s.csrf, s.expires_at, a.id, a.email
         FROM sessions s JOIN admins a ON a.id = s.admin_id
        WHERE s.id_hash = ?`
    ).get(sha256(id));
    if (row && row.expires_at > Date.now()) {
      req.admin = { id: row.id, email: row.email };
      req.csrf = row.csrf;
      res.locals.admin = req.admin;
      res.locals.csrf = row.csrf;
    }
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect('/admin/login');
  next();
}

/** Protección CSRF: todo POST del panel debe traer el token de la sesión. */
function requireCsrf(req, res, next) {
  const sent = String((req.body && req.body._csrf) || req.query._csrf || '');
  const expected = String(req.csrf || '');
  const ok = sent.length === expected.length && expected.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return res.status(403).send('Sesión caducada. Vuelve atrás, recarga la página e inténtalo de nuevo.');
  next();
}

/** Crea el administrador inicial la primera vez que arranca la tienda. */
function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0) return;
  const generated = !config.adminPassword;
  const password = config.adminPassword || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO admins (email, password_hash) VALUES (?, ?)').run(config.adminEmail, hashPassword(password));
  console.log('\n──────── Acceso al panel de administración ────────');
  console.log(`  Correo:      ${config.adminEmail}`);
  console.log(`  Contraseña:  ${generated ? password : '(la que definiste en ADMIN_PASSWORD)'}`);
  if (generated) console.log('  Guárdala: no se volverá a mostrar. Puedes cambiarla en Ajustes.');
  console.log('────────────────────────────────────────────────────\n');
}

module.exports = {
  hashPassword, verifyPassword, login, logout, logoutEverywhere,
  loadSession, requireAdmin, requireCsrf, ensureAdmin,
};
