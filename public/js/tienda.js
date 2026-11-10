// Carrito (guardado en el navegador), página de carrito y formulario de compra.
(function () {
  'use strict';

  var KEY = 'carrito';
  var fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  var money = function (cents) { return fmt.format(cents / 100); };
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------- Almacenamiento ----------
  function readCart() {
    try {
      var data = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(data)) return [];
      return data.filter(function (i) {
        return i && Number.isInteger(i.id) && Number.isInteger(i.qty) && i.qty > 0;
      });
    } catch (e) { return []; }
  }
  function writeCart(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* almacenamiento bloqueado */ }
    updateBadge();
  }
  function updateBadge() {
    var total = readCart().reduce(function (n, i) { return n + i.qty; }, 0);
    $$('[data-cart-count]').forEach(function (el) {
      el.textContent = total;
      el.hidden = total === 0;
    });
  }

  // ---------- Avisos ----------
  var toastTimer;
  function toast(message, withCartLink) {
    var el = $('[data-toast]');
    if (!el) return;
    el.textContent = message;
    if (withCartLink) {
      var a = document.createElement('a');
      a.href = '/carrito';
      a.textContent = 'Ver carrito';
      el.appendChild(document.createTextNode(' '));
      el.appendChild(a);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }

  // ---------- Agregar al carrito ----------
  function addToCart(id, qty, max) {
    var items = readCart();
    var found = items.find(function (i) { return i.id === id; });
    var current = found ? found.qty : 0;
    var limit = Math.min(max || 99, 99);
    if (current >= limit) {
      toast('Ya tienes en tu carrito todas las piezas disponibles.', true);
      return;
    }
    var next = Math.min(current + qty, limit);
    if (found) found.qty = next; else items.push({ id: id, qty: next });
    writeCart(items);
    toast(next - current === 1 ? 'Agregado al carrito.' : 'Agregaste ' + (next - current) + ' piezas al carrito.', true);
  }

  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-add]');
    if (btn) {
      var qty = 1;
      if (btn.hasAttribute('data-use-qty')) {
        var input = $('[data-qty-input]');
        qty = Math.max(1, parseInt(input && input.value, 10) || 1);
      }
      addToCart(Number(btn.getAttribute('data-add')), qty, Number(btn.getAttribute('data-max')));
      return;
    }
    var minus = event.target.closest('[data-qty-minus]');
    var plus = event.target.closest('[data-qty-plus]');
    if (minus || plus) {
      var field = $('[data-qty-input]', (minus || plus).closest('[data-qty]'));
      var max = Number(field.max) || 99;
      var value = (parseInt(field.value, 10) || 1) + (plus ? 1 : -1);
      field.value = Math.min(Math.max(value, 1), max);
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  $$('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form.submit(); });
  });

  // ---------- Datos del carrito desde el servidor ----------
  // Devuelve las líneas con precio y existencias actuales, y corrige el carrito si algo cambió.
  function loadCart() {
    var items = readCart();
    if (!items.length) return Promise.resolve({ lines: [], changes: [], envio: { costo: 0, gratisDesde: 0 } });
    var ids = items.map(function (i) { return i.id; }).join(',');
    return fetch('/api/productos?ids=' + ids, { headers: { Accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('red'); return res.json(); })
      .then(function (data) {
        var byId = {};
        data.productos.forEach(function (p) { byId[p.id] = p; });
        var lines = [];
        var changes = [];
        items.forEach(function (item) {
          var p = byId[item.id];
          if (!p || p.stock <= 0) {
            changes.push(p ? '"' + p.name + '" se agotó y lo quitamos de tu carrito.' : 'Un producto ya no está disponible y lo quitamos de tu carrito.');
            return;
          }
          var qty = Math.min(item.qty, p.stock, 99);
          if (qty < item.qty) changes.push('Solo quedan ' + p.stock + ' piezas de "' + p.name + '"; ajustamos la cantidad.');
          lines.push({ product: p, qty: qty });
        });
        if (changes.length) writeCart(lines.map(function (l) { return { id: l.product.id, qty: l.qty }; }));
        return { lines: lines, changes: changes, envio: data.envio };
      });
  }

  function totals(lines, envio) {
    var subtotal = lines.reduce(function (n, l) { return n + l.product.price_cents * l.qty; }, 0);
    var free = envio.gratisDesde > 0 && subtotal >= envio.gratisDesde;
    var shipping = free ? 0 : envio.costo;
    return { subtotal: subtotal, shipping: shipping, total: subtotal + shipping,
      missing: envio.gratisDesde > 0 && !free && envio.costo > 0 ? envio.gratisDesde - subtotal : 0 };
  }

  function paintTotals(root, t) {
    $('[data-sum-subtotal]', root).textContent = money(t.subtotal);
    $('[data-sum-shipping]', root).textContent = t.shipping ? money(t.shipping) : 'Gratis';
    $('[data-sum-total]', root).textContent = money(t.total);
    var hint = $('[data-ship-hint]', root);
    if (hint) {
      hint.hidden = t.missing <= 0;
      hint.textContent = t.missing > 0 ? 'Te faltan ' + money(t.missing) + ' para el envío gratis.' : '';
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------- Página del carrito ----------
  function initCartPage(root) {
    var list = $('[data-cart-list]', root);
    var notice = $('[data-cart-notice]', root);

    function render(state) {
      $('[data-cart-loading]', root).hidden = true;
      $('[data-cart-empty]', root).hidden = state.lines.length > 0;
      $('[data-cart-full]', root).hidden = state.lines.length === 0;
      if (state.changes.length) { notice.textContent = state.changes.join(' '); notice.hidden = false; }
      list.textContent = '';
      state.lines.forEach(function (line) { list.appendChild(row(line, state)); });
      paintTotals(root, totals(state.lines, state.envio));
    }

    function save(state) {
      writeCart(state.lines.map(function (l) { return { id: l.product.id, qty: l.qty }; }));
      render(state);
    }

    function row(line, state) {
      var p = line.product;
      var li = el('li', 'cart-item');
      var img = el('img');
      img.src = p.image || '/img/sin-foto.svg'; img.alt = ''; img.width = 88; img.height = 88;
      var link = el('a', 'cart-thumb'); link.href = '/producto/' + p.slug; link.appendChild(img);

      var info = el('div', 'cart-info');
      var name = el('a', 'cart-name', p.name); name.href = '/producto/' + p.slug;
      info.appendChild(name);
      info.appendChild(el('p', 'muted', money(p.price_cents) + ' c/u' + (p.origin ? ' · ' + p.origin : '')));

      var qty = el('div', 'qty qty-sm');
      var minus = el('button', '', '−'); minus.type = 'button'; minus.setAttribute('aria-label', 'Quitar una pieza de ' + p.name);
      var count = el('span', 'qty-value', String(line.qty)); count.setAttribute('aria-live', 'polite');
      var plus = el('button', '', '+'); plus.type = 'button'; plus.setAttribute('aria-label', 'Agregar una pieza de ' + p.name);
      plus.disabled = line.qty >= Math.min(p.stock, 99);
      minus.addEventListener('click', function () {
        if (line.qty > 1) line.qty -= 1; else state.lines.splice(state.lines.indexOf(line), 1);
        save(state);
      });
      plus.addEventListener('click', function () { line.qty += 1; save(state); });
      qty.appendChild(minus); qty.appendChild(count); qty.appendChild(plus);

      var remove = el('button', 'link-remove', 'Quitar'); remove.type = 'button';
      remove.setAttribute('aria-label', 'Quitar ' + p.name + ' del carrito');
      remove.addEventListener('click', function () { state.lines.splice(state.lines.indexOf(line), 1); save(state); });

      var controls = el('div', 'cart-controls');
      controls.appendChild(qty); controls.appendChild(remove);
      info.appendChild(controls);

      li.appendChild(link); li.appendChild(info);
      li.appendChild(el('p', 'cart-line-total', money(p.price_cents * line.qty)));
      return li;
    }

    loadCart().then(render).catch(function () {
      $('[data-cart-loading]', root).textContent = 'No pudimos cargar tu carrito. Revisa tu conexión y recarga la página.';
    });
  }

  // ---------- Formulario de compra ----------
  function initCheckout(root) {
    var form = $('[data-checkout-form]', root);
    var errorBox = $('[data-checkout-error]', root);
    var submit = $('[data-checkout-submit]', root);
    var submitText = submit.textContent;

    function showError(message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
      errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    loadCart().then(function (state) {
      if (!state.lines.length) { $('[data-checkout-empty]').hidden = false; return; }
      root.hidden = false;
      var list = $('[data-checkout-items]', root);
      state.lines.forEach(function (line) {
        var li = el('li');
        var img = el('img'); img.src = line.product.image || '/img/sin-foto.svg'; img.alt = ''; img.width = 56; img.height = 56;
        var name = el('span', 'mini-name', line.product.name);
        name.appendChild(el('small', '', line.qty + ' × ' + money(line.product.price_cents)));
        li.appendChild(img); li.appendChild(name);
        li.appendChild(el('span', 'mini-price', money(line.product.price_cents * line.qty)));
        list.appendChild(li);
      });
      paintTotals(root, totals(state.lines, state.envio));
      if (state.changes.length) showError(state.changes.join(' '));
    }).catch(function () {
      root.hidden = false;
      showError('No pudimos cargar tu carrito. Revisa tu conexión y recarga la página.');
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      errorBox.hidden = true;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var cliente = {};
      new FormData(form).forEach(function (value, key) { cliente[key] = value; });
      submit.disabled = true;
      submit.textContent = 'Un momento…';

      fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ cliente: cliente, items: readCart() }),
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (result) {
          if (result.ok && result.data.url) { window.location.assign(result.data.url); return; }
          throw new Error(result.data.error || 'No pudimos procesar tu pedido. Inténtalo de nuevo.');
        })
        .catch(function (err) {
          submit.disabled = false;
          submit.textContent = submitText;
          showError(err instanceof TypeError ? 'Sin conexión. Revisa tu internet e inténtalo de nuevo.' : err.message);
        });
    });
  }

  // ---------- Arranque ----------
  // Si el pedido ya quedó pagado, el carrito se vacía.
  if ($('[data-order-done]')) writeCart([]);
  updateBadge();
  window.addEventListener('storage', function (e) { if (e.key === KEY) updateBadge(); });
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    updateBadge();
    var submit = $('[data-checkout-submit]');
    if (submit) { submit.disabled = false; submit.textContent = 'Continuar al pago seguro'; }
  });

  var cartPage = $('[data-cart-page]');
  if (cartPage) initCartPage(cartPage);
  var checkout = $('[data-checkout]');
  if (checkout) initCheckout(checkout);
})();
