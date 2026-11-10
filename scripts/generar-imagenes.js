// Genera las ilustraciones de los productos de ejemplo (public/img/productos/*.svg).
// Solo hace falta ejecutarlo si quieres regenerarlas: node scripts/generar-imagenes.js
const fs = require('fs');
const path = require('path');

const INK = '#1b1a17';
const PAPER = '#fffdf8';
const TONOS = {
  tecnologia: { bg: '#dde6f0', halo: '#eef3f8', accent: '#3f6fb0' },
  hogar: { bg: '#efe3cf', halo: '#f8f0e2', accent: '#c47a2c' },
  belleza: { bg: '#f4dcdd', halo: '#fbeeee', accent: '#cf6078' },
  moda: { bg: '#e1e3d8', halo: '#f0f1ea', accent: '#5d6f4d' },
  juguetes: { bg: '#fae6bd', halo: '#fdf3dc', accent: '#e4572e' },
  despensa: { bg: '#d9e9d5', halo: '#ecf5e9', accent: '#4c8a49' },
};

// Cada dibujo usa trazos de tinta, relleno "papel" (P) y un color de acento (A).
const DIBUJOS = {
  audifonos: ['tecnologia', `
    <path d="M190 335v-35a110 110 0 0 1 220 0v35" fill="none"/>
    <rect x="160" y="310" width="62" height="108" rx="26" fill="A"/>
    <rect x="378" y="310" width="62" height="108" rx="26" fill="A"/>`],
  teclado: ['tecnologia', `
    <rect x="130" y="215" width="340" height="170" rx="22" fill="P"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5, 6].map((c) =>
      `<rect x="${158 + c * 42}" y="${240 + r * 38}" width="30" height="26" rx="6" fill="${(r + c) % 5 === 0 ? 'A' : 'none'}" stroke-width="6"/>`).join('')).join('')}
    <rect x="215" y="352" width="170" height="16" rx="8" fill="A" stroke-width="6"/>`],
  bocina: ['tecnologia', `
    <rect x="205" y="150" width="190" height="300" rx="40" fill="P"/>
    <circle cx="300" cy="350" r="58" fill="A"/><circle cx="300" cy="350" r="18" fill="P" stroke-width="6"/>
    <circle cx="300" cy="225" r="26" fill="P"/>`],
  tetera: ['hogar', `
    <path d="M215 268a85 85 0 0 1 170 0" fill="none"/>
    <path d="M408 318l52-34 14 20-48 50" fill="P"/>
    <path d="M196 290h208a112 100 0 0 1-208 0z" transform="translate(0 -6)" fill="none" stroke="none"/>
    <ellipse cx="300" cy="350" rx="118" ry="88" fill="A"/>
    <path d="M222 284h156" /><circle cx="300" cy="254" r="13" fill="P"/>`],
  lampara: ['hogar', `
    <path d="M225 440h150"/><path d="M300 440V320l82-92" fill="none"/>
    <path d="M338 176l96 96-74 26-48-48z" fill="A"/>
    <circle cx="300" cy="320" r="13" fill="P"/>`],
  cuchillo: ['hogar', `
    <path d="M250 262h215q-18 92-150 92h-65z" fill="P"/>
    <rect x="118" y="262" width="136" height="46" rx="16" fill="A"/>
    <circle cx="160" cy="285" r="5" fill="${INK}" stroke="none"/><circle cx="212" cy="285" r="5" fill="${INK}" stroke="none"/>`],
  serum: ['belleza', `
    <rect x="234" y="282" width="132" height="170" rx="26" fill="P"/>
    <rect x="266" y="244" width="68" height="40" rx="6" fill="${INK}"/>
    <rect x="276" y="148" width="48" height="98" rx="24" fill="A"/>
    <rect x="258" y="334" width="84" height="66" rx="8" fill="A" stroke-width="6"/>`],
  mascarilla: ['belleza', `
    <path d="M212 170h176q22 0 22 22v112q0 126-110 126T190 304V192q0-22 22-22z" fill="P"/>
    <ellipse cx="256" cy="278" rx="27" ry="15" fill="A" stroke-width="6"/>
    <ellipse cx="344" cy="278" rx="27" ry="15" fill="A" stroke-width="6"/>
    <path d="M300 300v34" stroke-width="6"/><ellipse cx="300" cy="376" rx="28" ry="10" fill="A" stroke-width="6"/>`],
  mochila: ['moda', `
    <path d="M258 214v-22a42 42 0 0 1 84 0v22" fill="none"/>
    <rect x="192" y="212" width="216" height="244" rx="48" fill="P"/>
    <path d="M192 296h216"/>
    <rect x="232" y="330" width="136" height="90" rx="18" fill="A"/>`],
  reloj: ['moda', `
    <rect x="258" y="128" width="84" height="344" rx="18" fill="A"/>
    <circle cx="300" cy="300" r="98" fill="P"/>
    <path d="M300 300v-56M300 300l40 22" fill="none"/><circle cx="300" cy="300" r="6" fill="${INK}" stroke="none"/>`],
  lentes: ['moda', `
    <path d="M158 296l-34-42M442 296l34-42" fill="none"/>
    <circle cx="222" cy="312" r="66" fill="A"/><circle cx="378" cy="312" r="66" fill="A"/>
    <path d="M286 300q14-20 28 0" fill="none"/>`],
  robot: ['juguetes', `
    <path d="M300 168v-36" /><circle cx="300" cy="122" r="12" fill="A"/>
    <rect x="226" y="168" width="148" height="112" rx="20" fill="P"/>
    <circle cx="266" cy="220" r="12" fill="${INK}" stroke="none"/><circle cx="334" cy="220" r="12" fill="${INK}" stroke="none"/>
    <rect x="210" y="302" width="180" height="146" rx="22" fill="A"/>
    <path d="M210 340h-40v56M390 340h40v56" fill="none"/>
    <rect x="262" y="340" width="76" height="44" rx="8" fill="P" stroke-width="6"/>`],
  rompecabezas: ['juguetes', `
    <rect x="182" y="182" width="236" height="236" rx="18" fill="P"/>
    <path d="M182 182h118v118H182z" fill="A"/>
    <path d="M300 182v236M182 300h236" fill="none"/>
    <circle cx="300" cy="241" r="21" fill="A"/><circle cx="241" cy="300" r="21" fill="P"/>
    <circle cx="300" cy="359" r="21" fill="P"/><circle cx="359" cy="300" r="21" fill="P"/>`],
  matcha: ['despensa', `
    <path d="M268 232q-18-22 0-44t0-44M332 232q-18-22 0-44t0-44" fill="none" stroke-width="7"/>
    <path d="M172 290h256a128 128 0 0 1-256 0z" fill="P"/>
    <ellipse cx="300" cy="290" rx="128" ry="24" fill="A"/>
    <path d="M250 440h100"/>`],
  caja: ['despensa', `
    <rect x="182" y="258" width="236" height="182" rx="14" fill="P"/>
    <rect x="164" y="204" width="272" height="58" rx="12" fill="A"/>
    <path d="M300 204v236" fill="none"/>
    <path d="M300 204q-58-74-84-28t84 28q58-74 84-28t-84 28" fill="P"/>`],
  chocolate: ['despensa', `
    <rect x="212" y="140" width="176" height="300" rx="14" fill="#7a4a2b"/>
    <path d="M212 215h176M212 290h176M300 140v170" fill="none" stroke-width="6"/>
    <rect x="198" y="310" width="204" height="150" rx="10" fill="P"/>
    <rect x="232" y="352" width="136" height="66" rx="8" fill="A" stroke-width="6"/>`],
};

const outDir = path.join(__dirname, '..', 'public', 'img', 'productos');
fs.mkdirSync(outDir, { recursive: true });

for (const [nombre, [tono, dibujo]] of Object.entries(DIBUJOS)) {
  const t = TONOS[tono];
  const cuerpo = dibujo.replace(/fill="A"/g, `fill="${t.accent}"`).replace(/fill="P"/g, `fill="${PAPER}"`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="Ilustración de producto">
  <rect width="600" height="600" fill="${t.bg}"/>
  <circle cx="300" cy="300" r="232" fill="${t.halo}"/>
  <g stroke="${INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none">${cuerpo}
  </g>
</svg>
`;
  fs.writeFileSync(path.join(outDir, `${nombre}.svg`), svg);
}

// Imagen genérica para productos sin foto.
fs.writeFileSync(path.join(outDir, '..', 'sin-foto.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img" aria-label="Sin foto">
  <rect width="600" height="600" fill="#ece7dc"/>
  <g stroke="#a39c8c" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M190 250l110-56 110 56v118l-110 56-110-56z"/><path d="M190 250l110 56 110-56M300 306v118"/>
  </g>
</svg>
`);
console.log(`Ilustraciones generadas en ${outDir}`);
