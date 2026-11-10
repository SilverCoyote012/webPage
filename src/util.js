// Utilidades compartidas: dinero, fechas, textos.
const fmtMoney = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const fmtDate = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City',
});

/** Centavos -> "$1,299.00" */
const money = (cents) => fmtMoney.format((Number(cents) || 0) / 100);

/** "1,299.50" -> 129950 (centavos). Devuelve null si no es un precio válido. */
function toCents(value) {
  const clean = String(value ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}

/** Centavos -> "1299.50" para rellenar campos de formulario. */
const centsToInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));

const fecha = (iso) => (iso ? fmtDate.format(new Date(iso)) : '');

function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

const clean = (value, max = 200) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const cleanMultiline = (value, max = 4000) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

const ESTADOS_MX = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua',
  'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero',
  'Hidalgo', 'Jalisco', 'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla',
  'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas',
  'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas',
];

// Estados de un pedido y cómo se muestran.
const ESTADOS_PEDIDO = {
  pendiente: { label: 'Pendiente de pago', tone: 'warn' },
  pagado: { label: 'Pagado · por enviar', tone: 'info' },
  enviado: { label: 'Enviado', tone: 'ok' },
  entregado: { label: 'Entregado', tone: 'done' },
  cancelado: { label: 'Cancelado', tone: 'off' },
};

const numeroPedido = (id) => `#${1000 + Number(id)}`;

module.exports = {
  money, toCents, centsToInput, fecha, slugify, clean, cleanMultiline,
  ESTADOS_MX, ESTADOS_PEDIDO, numeroPedido,
};
