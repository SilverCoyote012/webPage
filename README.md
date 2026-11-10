# Tienda en línea de productos importados

Tienda completa lista para vender en México (precios en MXN):

- **Tienda**: inicio, catálogo con búsqueda, filtros por categoría y orden, página de producto, carrito y compra con dirección de envío.
- **Pagos con tarjeta** mediante [Stripe Checkout](https://stripe.com/mx). Los datos de la tarjeta se capturan en la página de Stripe; nunca pasan por este servidor.
- **Panel de administración** (`/admin`): ventas, pedidos, productos con foto, categorías, inventario, costos de envío y datos de la tienda.
- **Inventario automático**: las piezas se apartan al crear el pedido y regresan solas si el pago no se completa.

Hecha con Node.js, Express y SQLite (un solo archivo de base de datos, sin servicios adicionales).

## Ponerla en marcha

Necesitas [Node.js](https://nodejs.org) 20 o más reciente.

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm start
```

Abre <http://localhost:3000>. La primera vez se cargan 16 productos de ejemplo y en la consola aparecen el correo y la contraseña del panel (`/admin`). Cámbiala en **Ajustes → Cambiar contraseña**.

Mientras no agregues las claves de Stripe la tienda trabaja en **modo demostración**: todo funciona, pero el pago es simulado y lo avisa con una barra amarilla.

## Primeros pasos en el panel

1. **Ajustes**: nombre de la tienda, frase, WhatsApp, correo, costo de envío y monto para envío gratis.
2. **Categorías**: crea las tuyas o renombra las de ejemplo.
3. **Productos**: edita o elimina los de ejemplo y sube los tuyos (foto JPG, PNG o WebP de hasta 5 MB; cuadrada se ve mejor).
4. **Pedidos**: cuando entre un pedido pagado, márcalo como *Enviado* y escribe el número de guía. El cliente lo ve en la página de su pedido.

## Activar los cobros con Stripe

1. Crea tu cuenta en <https://dashboard.stripe.com/register> (país: México) y completa los datos de tu negocio y tu cuenta bancaria.
2. En **Desarrolladores → Claves de API** copia la *clave secreta*. Empieza con la de prueba (`sk_test_…`) y pégala en `.env`:

   ```
   STRIPE_SECRET_KEY=sk_test_...
   ```

3. En **Desarrolladores → Webhooks** agrega un destino con la dirección `https://TU-DOMINIO/webhooks/stripe` y estos eventos:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
   Copia el *secreto de firma* (`whsec_…`) en `.env`:

   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

4. Reinicia la tienda. Prueba una compra con la tarjeta `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.
5. Cuando todo funcione, cambia las dos claves por las reales (`sk_live_…` y el secreto del webhook en modo real).

Para probar webhooks en tu computadora usa la [CLI de Stripe](https://docs.stripe.com/stripe-cli): `stripe listen --forward-to localhost:3000/webhooks/stripe`.

Los métodos de pago (tarjetas, OXXO, etc.) se activan en tu panel de Stripe, en **Configuración → Métodos de pago**; la tienda muestra los que tengas activos. Los reembolsos también se hacen desde Stripe.

## Publicarla en internet

Funciona en cualquier servicio que ejecute Node.js y ofrezca **disco persistente** (por ejemplo Railway, Render, Fly.io o un servidor propio). La base de datos y las fotos viven en la carpeta `data/`: si esa carpeta no está en un disco persistente, se pierden en cada despliegue.

Variables para producción:

```
NODE_ENV=production
BASE_URL=https://tu-dominio.mx
DATA_DIR=/ruta/al/disco/persistente
TRUST_PROXY=1
ADMIN_EMAIL=tu-correo@dominio.mx
ADMIN_PASSWORD=una-contraseña-larga
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

El sitio debe servirse por **HTTPS** (los servicios mencionados lo incluyen). Haz respaldos periódicos de la carpeta `data/`.

## Antes de lanzar

- Sustituye los productos, fotos y textos de ejemplo por los tuyos.
- Revisa el texto de la página **Ayuda** (`views/tienda/ayuda.ejs`): envíos, cambios y devoluciones.
- Publica tu **aviso de privacidad** y tus **términos y condiciones**; en México son obligatorios para vender en línea y deben redactarse para tu negocio.
- La tienda todavía no envía correos de confirmación: el cliente consulta su pedido en el enlace que ve al pagar. Stripe puede enviar el recibo por correo si lo activas en **Configuración → Correos electrónicos para clientes**.

## Personalizar el diseño

Los colores y tipografías están al inicio de `public/css/tienda.css`, en el bloque `:root`. Cambia `--brand` y `--accent` para adaptar la tienda a tu marca. El nombre de la tienda se cambia en el panel.

## Estructura

```
server.js              Arranque del servidor
src/
  config.js            Lee el archivo .env
  db.js                Base de datos y ajustes
  orders.js            Pedidos e inventario
  payments.js          Stripe y modo demostración
  auth.js              Acceso al panel
  routes/tienda.js     Páginas públicas y API del carrito
  routes/admin.js      Panel de administración
  catalogo-ejemplo.js  Productos de ejemplo
views/                 Plantillas (tienda y panel)
public/                Estilos, scripts, tipografías e imágenes
data/                  Base de datos y fotos subidas (no se sube a Git)
```
