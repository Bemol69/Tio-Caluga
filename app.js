// ===== CONFIGURACIÓN =====
// Datos de la tienda: los inserta scripts/build.mjs desde tienda.config.json y data/ajustes.json
const TIENDA = %%TIENDA_JSON%%;
const WHATSAPP_NUMBER = TIENDA.whatsapp;
const ZONAS = TIENDA.zonas || [];
const PAGOS = TIENDA.pagos && TIENDA.pagos.length ? TIENDA.pagos : ['Transferencia'];
const EMOJI_PAGO = (p) => (/efectivo/i.test(p) ? '💵' : /d[ée]bito|cr[ée]dito|tarjeta/i.test(p) ? '💳' : '🏦');

// Productos y categorías se editan desde el panel /admin (data/productos, data/categorias)
// y se publican juntos en data/catalogo.json (lo genera scripts/build.mjs)
let PRODUCTS = [];
let FILTERS = [['todos', 'Todos']];
let CUPONES = [];

const SORTS = {
  destacados: null,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
};
const MAX_QTY = 20;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// ===== UTILIDADES =====
const clp = (n) => '$' + n.toLocaleString('es-CL');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
const priceText = (p) => (p.price > 0 ? clp(p.price) : 'Consultar');
const pct = (p) => Math.round((1 - p.price / p.before) * 100);
// Se usa api.whatsapp.com y no wa.me: la redirección de wa.me rompe los emojis (llegan como �)
const waUrl = (text) =>
  `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}${text ? '&text=' + encodeURIComponent(text) : ''}`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('is-on'), 2600);
}

// Fotos con otra proporción que el marco 4:5 (flyers, fotos apaisadas) se muestran completas,
// sin recortar, sobre un fondo difuminado de la misma imagen
function fitImage(img) {
  const box = img.closest('.card__media, .pm__frame');
  if (!box || !img.naturalWidth || img.classList.contains('alt')) return;
  const r = img.naturalHeight / img.naturalWidth;
  const fit = r > 1.45 || r < 1;
  box.classList.toggle('is-fit', fit);
  if (fit) box.style.setProperty('--fit-bg', `url("${img.currentSrc || img.src}")`);
}
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') fitImage(e.target); }, true);
const fitAll = (root) => root.querySelectorAll('.card__media img, .pm__frame img').forEach((img) => { if (img.complete) fitImage(img); });
fitAll(document);

function lockScroll() {
  const open = ['#productModal', '#bag', '#promoModal'].some((s) => { const el = $(s); return el && el.classList.contains('is-open'); });
  document.body.style.overflow = open ? 'hidden' : '';
}

// ===== CON O SIN AZÚCAR (preferencia del cliente, se recuerda en este navegador) =====
const AZUCAR_KEY = 'tcAzucar';
let AZUCAR = 'con';
try { AZUCAR = localStorage.getItem(AZUCAR_KEY) === 'sin' ? 'sin' : 'con'; } catch (e) {}
const esSin = (v) => /sin az[uú]car/i.test(v);
// versión que calza con la preferencia (si el producto la tiene)
const versionPreferida = (p) => {
  if (!p.sizes.length) return '';
  if (p.sizes.length === 1) return p.sizes[0];
  const hit = p.sizes.find((v) => (AZUCAR === 'sin' ? esSin(v) : !esSin(v) && /az[uú]car/i.test(v)));
  return hit || '';
};
function marcarPreferencia(root = document) {
  root.querySelectorAll('.flavors li').forEach((li) => {
    const t = li.textContent;
    li.classList.toggle('is-pref', AZUCAR === 'sin' ? esSin(t) : !esSin(t) && /az[uú]car/i.test(t));
  });
}
document.querySelectorAll('input[name="azucar"]').forEach((r) => {
  r.checked = r.value === AZUCAR;
  r.addEventListener('change', () => {
    AZUCAR = r.value;
    try { localStorage.setItem(AZUCAR_KEY, AZUCAR); } catch (e) {}
    marcarPreferencia();
    toast(AZUCAR === 'sin' ? 'Listo: te dejamos elegida la versión sin azúcar añadida 💚' : 'Listo: te dejamos elegida la versión con azúcar ❤️');
  });
});
marcarPreferencia();

// ===== CARTA =====
const grid = $('#productGrid');
const filters = $('#filters');
let currentCat = 'todos';

function renderFilters(active) {
  const count = (k) => (k === 'todos' ? PRODUCTS.length : PRODUCTS.filter((p) => p.tags.includes(k)).length);
  filters.innerHTML = FILTERS
    .filter(([k]) => count(k) > 0) // oculta categorías vacías
    .map(([k, label]) => `<button class="tab ${k === active ? 'is-active' : ''}" role="tab" aria-selected="${k === active}" data-cat="${esc(k)}">${esc(label)}<span class="tab__n">${count(k)}</span></button>`)
    .join('');
}

// Misma tarjeta que escribe scripts/build.mjs en el HTML (para Google)
const card = (p) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <button class="card__media" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
        <img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" decoding="async">
        ${p.thumbs[1] ? `<img class="alt" src="${esc(p.thumbs[1])}" alt="" loading="lazy" decoding="async">` : ''}
        ${p.gallery.length > 1 ? `<span class="card__more">+${p.gallery.length - 1} ${p.gallery.length === 2 ? 'foto' : 'fotos'}</span>` : ''}
      </button>
      ${p.agotado ? '<span class="lid lid--off">Agotado</span>' : p.before ? `<span class="lid"><b>−${pct(p)}%</b></span>` : p.badge ? `<span class="lid lid--txt">${esc(p.badge)}</span>` : ''}
      <div class="card__body">
        ${p.serves ? `<p class="card__serves">${esc(p.serves)}</p>` : ''}
        <h3>${esc(p.name)}</h3>
        ${p.desc ? `<p class="card__desc">${esc(p.desc)}</p>` : ''}
        ${p.sizes.length ? `<ul class="flavors" aria-label="Versiones">${p.sizes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <div class="card__foot">
          <p class="price${p.price > 0 ? '' : ' price--ask'}">${p.before ? `<s>${clp(p.before)}</s>` : ''}<strong>${priceText(p)}</strong></p>
          ${p.agotado
            ? `<a class="btn btn--line btn--sm" target="_blank" rel="noopener" href="${esc(waUrl(`Hola! ¿Cuándo vuelve ${p.name}?`))}">Avísame</a>`
            : `<button class="btn btn--berry btn--sm" type="button" data-view="${esc(p.id)}">${p.sizes.length > 1 ? 'Elegir' : 'Agregar'}</button>`}
        </div>
      </div>
    </article>`;

function renderProducts(cat = currentCat) {
  currentCat = cat;
  let list = cat === 'todos' ? PRODUCTS : PRODUCTS.filter((p) => p.tags.includes(cat));
  const sort = SORTS[$('#sort').value];
  if (sort) list = [...list].sort(sort);
  $('#count').innerHTML = `<strong>${list.length}</strong> ${list.length === 1 ? 'postre' : 'postres'} en la carta`;
  grid.innerHTML = list.map(card).join('');
  fitAll(grid);
  marcarPreferencia(grid);
  tiltCards();
}

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  renderFilters(btn.dataset.cat);
  renderProducts(btn.dataset.cat);
});
$('#sort').addEventListener('change', () => renderProducts());

// ===== FICHA DE PRODUCTO =====
const pModal = $('#productModal');
let current = null;
let photo = 0;
let pick = { size: '', qty: 1 };
let lastFocus = null;

function showPhoto(i) {
  const g = current.gallery;
  photo = (i + g.length) % g.length;
  $('#pmImg').src = g[photo];
  fitImage($('#pmImg'));
  $('#pmThumbs').querySelectorAll('button').forEach((b, k) => b.classList.toggle('is-active', k === photo));
}

function renderSizes() {
  $('#pmSizes').innerHTML = current.sizes
    .map((t) => `<button type="button" role="radio" aria-checked="${t === pick.size}" data-size="${esc(t)}">${esc(t)}</button>`)
    .join('');
}

function openProduct(id) {
  const p = findProduct(id);
  if (!p) return;
  lastFocus = document.activeElement;
  current = p;
  pick = { size: versionPreferida(p), qty: 1 };

  $('#pmImg').alt = p.name;
  $('#pmThumbs').innerHTML = p.gallery.length > 1
    ? p.thumbs.map((src, i) => `<button type="button" data-photo="${i}" aria-label="Foto ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy"></button>`).join('')
    : '';
  pModal.classList.toggle('has-gallery', p.gallery.length > 1);
  showPhoto(0);
  $('#pmCat').textContent = FILTERS.filter(([k]) => p.tags.includes(k)).map(([, l]) => l).join(' · ');
  $('#pmName').textContent = p.name;
  $('#pmServes').textContent = p.serves;
  $('#pmPrice').innerHTML = `${esc(priceText(p))}${p.before ? ` <s>${clp(p.before)}</s>` : ''}`;
  $('#pmDesc').textContent = p.desc;
  $('#pmSizesWrap').hidden = !p.sizes.length;
  $('#pmSizeHint').textContent = p.sizes.length === 1 ? '· única disponible' : '';
  renderSizes();
  $('#pmQty').textContent = '1';
  $('#pmError').hidden = true;
  $('#pmAdd').hidden = p.agotado;
  document.querySelector('.pm__qty').hidden = p.agotado;
  $('#pmAsk').href = waUrl(`Hola Tío Caluga! Quiero consultar por ${p.name} 🍰`);

  pModal.classList.add('is-open');
  pModal.setAttribute('aria-hidden', 'false');
  lockScroll();
  $('#pmAdd').hidden ? $('#pmAsk').focus() : pModal.querySelector('.x').focus();
}

function closeProduct() {
  if (!pModal.classList.contains('is-open')) return;
  pModal.classList.remove('is-open');
  pModal.setAttribute('aria-hidden', 'true');
  lockScroll();
  if (lastFocus && !bagEl.classList.contains('is-open')) lastFocus.focus();
}

pModal.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close]')) { closeProduct(); return; }
  const thumb = t.closest('[data-photo]');
  if (thumb) showPhoto(Number(thumb.dataset.photo));
  const step = t.closest('[data-step-photo]');
  if (step) showPhoto(photo + Number(step.dataset.stepPhoto));
  const size = t.closest('[data-size]');
  if (size) {
    pick.size = size.dataset.size;
    $('#pmError').hidden = true;
    renderSizes();
  }
  const q = t.closest('[data-qty]');
  if (q) {
    pick.qty = Math.min(MAX_QTY, Math.max(1, pick.qty + Number(q.dataset.qty)));
    $('#pmQty').textContent = pick.qty;
  }
});

// Deslizar la foto con el dedo en el celular
let touchX = null;
$('#pmImg').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#pmImg').addEventListener('touchend', (e) => {
  if (touchX === null || current.gallery.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) showPhoto(photo + (dx < 0 ? 1 : -1));
  touchX = null;
});

$('#pmAdd').addEventListener('click', (e) => {
  if (current.sizes.length && !pick.size) {
    $('#pmError').textContent = 'Elige la versión (con o sin azúcar añadida) para agregarlo.';
    $('#pmError').hidden = false;
    return;
  }
  sprinkles(e.currentTarget);
  addToBag(current.id, pick.size, pick.qty);
  closeProduct();
  toast(`${current.name}${pick.size ? ` · ${pick.size}` : ''} agregado a tu pedido`);
});

// ===== PEDIDO (bolsa) =====
// Se guarda en este navegador para no perderlo al recargar la página
const bagEl = $('#bag');
const BAG_KEY = 'tcBag';
let BAG = [];
try { BAG = JSON.parse(localStorage.getItem(BAG_KEY) || '[]'); } catch (e) { BAG = []; }
if (!Array.isArray(BAG)) BAG = [];

function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(BAG)); } catch (e) {}
}

function addToBag(id, size, qty) {
  const line = BAG.find((l) => l.id === id && l.size === size);
  if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
  else BAG.push({ id, size, qty });
  saveBag();
  renderBag(true);
}

// Productos borrados o agotados desde el panel se descartan solos. Si una versión dejó de existir, se marca.
const bagLines = () => BAG
  .map((l) => ({ ...l, p: findProduct(l.id) }))
  .filter((l) => l.p && !l.p.agotado)
  .map((l) => ({ ...l, sinVersion: !!l.size && !l.p.sizes.includes(l.size) }));
const bagTotal = () => bagLines().reduce((s, l) => s + l.p.price * l.qty, 0);
const aCotizar = () => bagLines().some((l) => !l.p.price);

// ===== CÓDIGOS DE DESCUENTO =====
// Se crean en /admin → Códigos de descuento. El catálogo trae solo su huella SHA-256 (no el código en texto):
// aquí se calcula la huella de lo que escribe el cliente y se compara. CUPON_SAL debe coincidir con scripts/build.mjs.
const CUPON_SAL = 'tio-caluga:';
const CUPON_KEY = 'tcCupon';
let CUPON = null; // { codigo, c } del código aplicado
const normCodigo = (c) => String(c || '').toUpperCase().replace(/\s+/g, '');
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const fechaCL = (iso) => iso.split('-').reverse().join('-');

async function huella(codigo) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CUPON_SAL + normCodigo(codigo)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cuponTexto = (c) => (c.tipo === 'monto' ? `${clp(c.valor)} de descuento` : `${c.valor}% de descuento`);
const aplicaA = (c, id) => !c.productos || c.productos.includes(id);

// Descuento del código aplicado sobre el pedido actual
function descuento() {
  if (!CUPON) return null;
  const c = CUPON.c;
  const base = bagLines().filter((l) => l.p.price && aplicaA(c, l.id)).reduce((s, l) => s + l.p.price * l.qty, 0);
  if (!base) return { c, monto: 0, motivo: 'no-aplica' };
  if (c.minimo && base < c.minimo) return { c, monto: 0, motivo: 'minimo', falta: c.minimo - base };
  const monto = c.tipo === 'monto' ? Math.min(c.valor, base) : Math.round((base * c.valor) / 100);
  return { c, monto, base };
}
const totalFinal = () => bagTotal() - ((descuento() || {}).monto || 0);

async function aplicarCupon(codigo, silencioso) {
  const code = normCodigo(codigo);
  if (!code) return;
  let c = null;
  try {
    const h = await huella(code);
    c = CUPONES.find((x) => x.h === h && !(x.vence && x.vence < hoyChile())) || null;
  } catch (e) {
    console.error(e); // crypto.subtle solo existe en https o localhost
  }
  CUPON = c ? { codigo: code, c } : null;
  try { c ? localStorage.setItem(CUPON_KEY, code) : localStorage.removeItem(CUPON_KEY); } catch (e) {}
  if (!c && !silencioso) {
    const st = $('#cuponStatus');
    st.hidden = false;
    st.className = 'coupon__status is-bad';
    st.innerHTML = '<strong>Código no válido</strong><small>No existe o ya no está vigente. Revisa que esté bien escrito.</small>';
    return;
  }
  if (c && !silencioso) $('#fCupon').value = '';
  renderBag();
}

function quitarCupon() {
  CUPON = null;
  try { localStorage.removeItem(CUPON_KEY); } catch (e) {}
  $('#cuponStatus').hidden = true;
  renderBag();
}

function renderCupon() {
  const st = $('#cuponStatus');
  const d = descuento();
  $('#cuponForm').hidden = !!CUPON;
  if (!d) { if (!st.classList.contains('is-bad')) st.hidden = true; return; }
  const c = d.c;
  const detalle = [cuponTexto(c), c.aplica !== 'Toda la tienda' ? `en ${c.aplica}` : 'en toda la carta', c.minimo ? `compra mínima ${clp(c.minimo)}` : '', c.vence ? `válido hasta el ${fechaCL(c.vence)}` : '']
    .filter(Boolean).join(' · ');
  const aviso = d.motivo === 'no-aplica'
    ? '<em>Este código no aplica a los productos de tu pedido.</em>'
    : d.motivo === 'minimo' ? `<em>Te faltan ${clp(d.falta)} en productos de esta promo para usarlo.</em>` : '';
  st.hidden = false;
  st.className = `coupon__status ${d.monto ? 'is-ok' : 'is-warn'}`;
  st.innerHTML = `
    <span class="coupon__badge"><svg class="ic"><use href="#i-check"/></svg>Código válido</span>
    <strong>${esc(CUPON.codigo)} · ${esc(c.titulo)}</strong>
    <small>${esc(detalle)}</small>
    ${aviso}
    <button type="button" class="coupon__rm" data-quitar-cupon>Quitar código</button>`;
}

function renderBag(bump) {
  const lines = bagLines();
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const n = $('#bagCount');
  n.hidden = !units;
  n.textContent = units;
  if (bump) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); }
  $('.fab').hidden = !units;
  $('#fabLabel').textContent = `Mi pedido (${units}) · ${clp(totalFinal())}`;

  $('#bagList').innerHTML = lines.map((l, i) => `
    <li class="bag-item">
      <img src="${esc(l.p.thumb || l.p.img)}" alt="">
      <div>
        <h4>${esc(l.p.name)}</h4>
        <small>${l.size ? `${esc(l.size)}${l.sinVersion ? ' <em>(ya no disponible)</em>' : ''} · ` : ''}${l.p.price ? clp(l.p.price) : 'A cotizar'}</small>
        ${CUPON && l.p.price && aplicaA(CUPON.c, l.id) ? `<span class="tag-off">Código ${esc(CUPON.codigo)}</span>` : ''}
        <div class="qty">
          <button type="button" data-line="${i}" data-step="-1" aria-label="Menos">−</button>
          <span>${l.qty}</span>
          <button type="button" data-line="${i}" data-step="1" aria-label="Más">+</button>
        </div>
      </div>
      <div class="bag-item__side">
        <strong>${l.p.price ? clp(l.p.price * l.qty) : '—'}</strong>
        <button type="button" class="bag-item__rm" data-remove="${i}" aria-label="Quitar ${esc(l.p.name)}"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>
    </li>`).join('');
  $('#bagEmpty').hidden = !!lines.length;
  $('#couponBox').hidden = !lines.length || !CUPONES.length;
  renderCupon();
  $('#bagTitle').textContent = lines.length ? `Tu pedido (${units})` : 'Tu pedido';
  updateOrder();
}

$('#bagList').addEventListener('click', (e) => {
  const lines = bagLines();
  const step = e.target.closest('[data-step]');
  const rm = e.target.closest('[data-remove]');
  const line = step ? lines[step.dataset.line] : rm ? lines[rm.dataset.remove] : null;
  if (!line) return;
  const idx = BAG.findIndex((l) => l.id === line.id && l.size === line.size);
  if (rm || BAG[idx].qty + Number(step.dataset.step) < 1) BAG.splice(idx, 1);
  else BAG[idx].qty = Math.min(MAX_QTY, BAG[idx].qty + Number(step.dataset.step));
  saveBag();
  renderBag();
});

function openBag(encargo) {
  closeProduct();
  renderBag();
  if (encargo) $('#encargoBox').open = true;
  bagEl.classList.add('is-open');
  bagEl.setAttribute('aria-hidden', 'false');
  lockScroll();
  (encargo ? $('#fEncargo') : bagEl.querySelector('.x')).focus();
}
function closeBag() {
  bagEl.classList.remove('is-open');
  bagEl.setAttribute('aria-hidden', 'true');
  lockScroll();
}

// ===== DATOS DE ENTREGA =====
const form = $('#orderForm');
const radio = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';

// Zonas de entrega y medios de pago: los elige el dueño en /admin → Ajustes
$('#fEntrega').innerHTML = [...ZONAS.map((z) => [z, `<svg class="ic"><use href="#i-home"/></svg>${esc(z)}`]), ['retiro', '<svg class="ic"><use href="#i-store"/></svg>Retiro']]
  .map(([v, label], i) => `<label><input type="radio" name="entrega" value="${esc(v)}"${i ? '' : ' checked'}><span>${label}</span></label>`)
  .join('');
$('#fPago').innerHTML = PAGOS
  .map((p, i) => `<label><input type="radio" name="pago" value="${esc(p)}"${i ? '' : ' checked'}><span>${esc(p)}</span></label>`)
  .join('');
$('#fFecha').min = hoyChile();

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const fechaLarga = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const f = new Date(y, m - 1, d);
  return `${DIAS[f.getDay()]} ${d}-${String(m).padStart(2, '0')}-${y}`;
};

function readOrder() {
  const entrega = radio('entrega');
  return {
    entrega,
    retiro: entrega === 'retiro',
    nombre: $('#fNombre').value.trim(),
    fecha: $('#fFecha').value,
    hora: $('#fHora').value,
    direccion: $('#fDireccion').value.trim(),
    regalo: $('#fRegalo').value.trim(),
    pago: radio('pago'),
    nota: $('#fNota').value.trim(),
    encargo: $('#fEncargo').value.trim(),
  };
}

// Código corto para identificar el pedido en el chat (ej: TC-4K7Q)
const orderCode = () => 'TC-' + Date.now().toString(36).slice(-4).toUpperCase();
let CODE = orderCode();

// *texto* = negrita y _texto_ = cursiva en WhatsApp
function buildMessage(o) {
  const lines = bagLines();
  const d = descuento();
  const L = [`🍰 *PEDIDO ${TIENDA.nombre.toUpperCase()} · ${CODE}*`, '━━━━━━━━━━━━━━━'];
  if (lines.length) {
    L.push('🛒 *Postres*');
    lines.forEach((l, i) => {
      const detalle = [l.size, `x${l.qty}`].filter(Boolean).join(' · ');
      const off = d && d.monto && l.p.price && aplicaA(d.c, l.id) ? ' 🏷️' : '';
      L.push(`${i + 1}. *${l.p.name}* · ${detalle} — ${l.p.price ? clp(l.p.price * l.qty) : '_a cotizar_'}${off}`);
    });
  }
  if (o.encargo) L.push(`📝 *Pedido especial:* _${o.encargo}_`);
  L.push('━━━━━━━━━━━━━━━');
  L.push(`🙋 *Nombre:* ${o.nombre || '_(por completar)_'}`);
  L.push(`📅 *Día:* ${o.fecha ? fechaLarga(o.fecha) : '_(por completar)_'}${o.hora ? ` · ${o.hora}` : ''}`);
  if (o.retiro) {
    L.push('🏪 *Entrega:* Retiro (lo coordinamos por WhatsApp)');
  } else {
    L.push(`🚗 *Entrega:* A domicilio en ${o.entrega}`);
    L.push(`🏠 *Dirección:* ${o.direccion || '_(por completar)_'}`);
  }
  if (o.regalo) L.push(`🎁 *Mensaje para la tarjeta:* _${o.regalo}_`);
  L.push(`${EMOJI_PAGO(o.pago)} *Pago:* ${o.pago || PAGOS[0]}`);
  if (o.nota) L.push(`💬 *Comentario:* _${o.nota}_`);
  L.push('━━━━━━━━━━━━━━━');
  if (lines.length) {
    if (d && d.monto) {
      L.push(`🧾 *Subtotal:* ${clp(bagTotal())}`);
      L.push(`🎟️ *Código ${CUPON.codigo}* _(${d.c.titulo} · ${d.c.tipo === 'monto' ? clp(d.c.valor) : d.c.valor + '%'})_: −${clp(d.monto)}`);
    }
    L.push(`💰 *TOTAL: ${clp(totalFinal())}*`);
    const extras = [aCotizar() && 'productos a cotizar', !o.retiro && !esGratis(o.entrega) && 'despacho a coordinar'].filter(Boolean);
    if (extras.length) L.push(`_(+ ${extras.join(' y ')})_`);
    L.push('');
    L.push('¡Hola! Quiero confirmar cupo para este pedido 🙌');
  } else {
    L.push('¡Hola! Quiero cotizar este pedido especial 🙌');
  }
  return L.join('\n');
}
// "Envío gratis en Temuco" → la zona Temuco no suma despacho
const sinTilde = (t) => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const esGratis = (zona) => !!TIENDA.envio_gratis && !!zona && sinTilde(TIENDA.envio_gratis).includes(sinTilde(zona));

// Vista previa con el formato de WhatsApp
const formatPreview = (text) => esc(text)
  .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
  .replace(/(^|\s|\(|—\s)_([^_\n]+)_/g, '$1<em>$2</em>');

function updateOrder() {
  const o = readOrder();
  const lines = bagLines();
  document.querySelectorAll('[data-domicilio]').forEach((el) => { el.hidden = o.retiro; });

  $('#bagTotal').textContent = lines.length ? clp(totalFinal()) : '—';
  const d = descuento();
  $('#bagSums').hidden = !(d && d.monto);
  if (d && d.monto) {
    $('#bagSums').innerHTML = `<span>Subtotal</span><span>${clp(bagTotal())}</span><span>Código ${esc(CUPON.codigo)}</span><span class="off">−${clp(d.monto)}</span>`;
  }
  $('#bagTotalLabel').textContent = aCotizar() ? 'Total (sin productos a cotizar)' : 'Total';
  $('#bagHint').textContent = o.retiro
    ? 'Coordinamos contigo por WhatsApp el lugar y horario del retiro.'
    : esGratis(o.entrega)
      ? `${TIENDA.envio_gratis} 🚗 Confirmamos el horario por WhatsApp.`
      : `El despacho a ${o.entrega} se confirma por WhatsApp junto con el horario.`;
  $('#msgPreview').innerHTML = formatPreview(buildMessage(readOrder()));
}

form.addEventListener('input', updateOrder);
form.addEventListener('change', updateOrder);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const o = readOrder();
  const missing = [];
  if (!bagLines().length && !o.encargo) missing.push('agrega un postre o cuéntanos tu pedido especial');
  if (!o.nombre) missing.push('tu nombre');
  if (!o.fecha) missing.push('el día de entrega');
  if (!o.retiro && !o.direccion) missing.push('la dirección');
  const err = $('#formError');
  if (missing.length) {
    err.textContent = 'Falta: ' + missing.join(', ') + '.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  window.open(waUrl(buildMessage(o)), '_blank', 'noopener');
  CODE = orderCode(); // el próximo pedido lleva otro código
  updateOrder();
});

$('#cuponBtn').addEventListener('click', () => aplicarCupon($('#fCupon').value));
$('#fCupon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicarCupon($('#fCupon').value); } });
$('#fCupon').addEventListener('input', () => { const st = $('#cuponStatus'); if (st.classList.contains('is-bad')) st.hidden = true; });
$('#couponBox').addEventListener('click', (e) => { if (e.target.closest('[data-quitar-cupon]')) quitarCupon(); });

// ===== EVENTOS GENERALES =====
document.addEventListener('click', (e) => {
  const view = e.target.closest('[data-view]');
  if (view) { openProduct(view.dataset.view); return; }
  if (e.target.closest('[data-encargo]')) { openBag(true); return; }
  if (e.target.closest('[data-open-bag]')) { openBag(); return; }
  if (e.target.closest('[data-close-bag]')) closeBag();
});
document.addEventListener('keydown', (e) => {
  if (pModal.classList.contains('is-open') && current && current.gallery.length > 1) {
    if (e.key === 'ArrowLeft') showPhoto(photo - 1);
    if (e.key === 'ArrowRight') showPhoto(photo + 1);
  }
  if (e.key !== 'Escape') return;
  if (pModal.classList.contains('is-open')) closeProduct();
  else closeBag();
});

['#footerWa', '#contactWaBtn', '#floatWa', '#heroWa', '#navWa'].forEach((s) => { const el = $(s); if (el) el.href = waUrl('Hola Tío Caluga! Quiero hacer un pedido 🍰'); });
const b2b = $('#b2bWa');
if (b2b) b2b.href = waUrl('Hola Tío Caluga! Tengo una cafetería/negocio y me interesa vender sus postres ☕');

// ===== OFERTA EN VENTANA EMERGENTE (una vez por visita) =====
const promo = $('#promoModal');
if (promo) {
  const key = 'oferta-vista:' + promo.dataset.flyer; // una oferta nueva se vuelve a mostrar
  const seen = () => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const closePromo = () => {
    promo.classList.remove('is-open');
    promo.setAttribute('aria-hidden', 'true');
    lockScroll();
  };
  promo.addEventListener('click', (e) => { if (e.target.closest('[data-promo-close]')) closePromo(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && promo.classList.contains('is-open')) closePromo(); });
  if (!seen()) {
    setTimeout(() => {
      if (pModal.classList.contains('is-open') || bagEl.classList.contains('is-open')) return; // no interrumpir un pedido en curso
      try { sessionStorage.setItem(key, '1'); } catch {}
      promo.classList.add('is-open');
      promo.setAttribute('aria-hidden', 'false');
      lockScroll();
      promo.querySelector('.x').focus();
    }, 1800);
  }
}

// ===== FOTOS O VIDEOS DE CLIENTES: los videos se descargan al acercarse y solo corren en pantalla =====
const momentVideos = document.querySelectorAll('.moment video');
const loadVideo = (v) => { if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; } };
if (momentVideos.length && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); target.play().catch(() => {}); } else target.pause();
  }), { threshold: 0.25, rootMargin: '300px 0px' });
  momentVideos.forEach((v) => io.observe(v));
} else {
  momentVideos.forEach((v) => { loadVideo(v); v.autoplay = true; v.play().catch(() => {}); });
}

// ===== MENÚ =====
// Barra transparente sobre la portada roja; al pasarla se vuelve de vidrio
const topBar = $('#top');
const heroEl = document.querySelector('.hero');
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const limite = heroEl ? heroEl.offsetHeight - 80 : 10;
    topBar.classList.toggle('is-scrolled', window.scrollY > limite);
    ticking = false;
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Menú a pantalla completa en celular y tablet
const burger = document.querySelector('.burger');
function setMenu(open) {
  topBar.classList.toggle('is-menu', open);
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  document.body.style.overflow = open ? 'hidden' : '';
}
burger.addEventListener('click', () => setMenu(!topBar.classList.contains('is-menu')));
$('#menu').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && topBar.classList.contains('is-menu')) { setMenu(false); burger.focus(); } });
window.matchMedia('(min-width: 1101px)').addEventListener('change', (e) => { if (e.matches) setMenu(false); });

// Marca en el menú la sección que se está viendo
const navLinks = [...document.querySelectorAll('#menu a[href^="#"]')];
const spied = navLinks.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
if ('IntersectionObserver' in window && spied.length) {
  const visibles = new Map();
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((en) => visibles.set(en.target.id, en.isIntersecting ? en.intersectionRatio : 0));
    let best = '';
    let max = 0;
    visibles.forEach((r, id) => { if (r > max) { max = r; best = id; } });
    navLinks.forEach((a) => a.classList.toggle('is-active', !!best && a.getAttribute('href') === '#' + best));
  }, { rootMargin: '-35% 0px -45% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
  spied.forEach((sec) => spy.observe(sec));
}

// ===== VITRINA DE LA PORTADA =====
// El plato muestra un postre a la vez: se cambia solo cada pocos segundos o al tocar uno de la órbita
const vitrina = $('#vitrina');
if (vitrina) {
  const orbs = [...vitrina.querySelectorAll('.orb')];
  const plate = vitrina.querySelector('.vitrina__plate');
  const img = $('#vitrinaImg');
  const tag = vitrina.querySelector('.vitrina__tag');
  let actual = 0;
  let timer = null;
  let enPantalla = true;
  const mostrar = async (k) => {
    if (k === actual) return;
    const o = orbs[k];
    const pre = new Image();
    pre.src = o.dataset.foto;
    try { await pre.decode(); } catch (e) {}
    plate.style.setProperty('--prev', `url("${img.currentSrc || img.src}")`);
    img.classList.remove('is-swap');
    void img.offsetWidth;
    img.src = o.dataset.foto;
    img.alt = o.dataset.nombre;
    if (!reduceMotion) img.classList.add('is-swap');
    $('#vitrinaNombre').textContent = o.dataset.nombre;
    $('#vitrinaPrecio').textContent = o.dataset.precio;
    const ver = $('#vitrinaVer');
    ver.dataset.view = o.dataset.id;
    ver.setAttribute('aria-label', 'Ver ' + o.dataset.nombre);
    tag.classList.remove('is-swap');
    void tag.offsetWidth;
    tag.classList.add('is-swap');
    orbs.forEach((b, n) => { b.classList.toggle('is-on', n === k); b.setAttribute('aria-pressed', String(n === k)); });
    actual = k;
  };
  const programar = () => {
    clearInterval(timer);
    if (reduceMotion || orbs.length < 2) return;
    timer = setInterval(() => { if (enPantalla && !document.hidden) mostrar((actual + 1) % orbs.length); }, 4200);
  };
  vitrina.addEventListener('click', (e) => {
    const o = e.target.closest('.orb');
    if (!o) return;
    mostrar(Number(o.dataset.orb));
    programar(); // al elegir uno, el ciclo vuelve a esperar
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([en]) => { enPantalla = en.isIntersecting; }).observe(vitrina);
  }
  programar();
}

// Aparición al hacer scroll (capas, tarjetas de receta, chorreados)
const revealEls = document.querySelectorAll('[data-reveal], .drip');
if ('IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (!isIntersecting) return;
    target.classList.add('is-in');
    io.unobserve(target);
  }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add('is-in'));
}

// Cifras que cuentan hasta su valor (el HTML ya trae el número final)
const counters = document.querySelectorAll('[data-count]');
if ('IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (!isIntersecting) return;
    io.unobserve(target);
    const end = Number(target.dataset.count) || 0;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1400);
      target.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))).toLocaleString('es-CL');
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  counters.forEach((el) => io.observe(el));
}

// Tarjetas que se inclinan hacia el mouse (solo con mouse)
function tiltCards() {
  if (!finePointer || reduceMotion) return;
  grid.querySelectorAll('.card').forEach((c) => {
    if (c.dataset.tilt) return;
    c.dataset.tilt = '1';
    c.addEventListener('mousemove', (e) => {
      const r = c.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      c.style.setProperty('--ry', `${x * 7}deg`);
      c.style.setProperty('--rx', `${y * -7}deg`);
    });
    c.addEventListener('mouseleave', () => { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); });
  });
}
tiltCards();

// Chispas de colores al agregar al pedido
const SPRINKLE_COLORS = ['#C03B4E', '#F2A7B2', '#C8893F', '#8FA35B', '#FBE9C9', '#5B8FD6'];
function sprinkles(from) {
  if (reduceMotion || !from) return;
  const r = from.getBoundingClientRect();
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('i');
    s.className = 'sprinkle';
    const a = Math.random() * Math.PI * 2;
    const d = 50 + Math.random() * 90;
    s.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${SPRINKLE_COLORS[i % SPRINKLE_COLORS.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 30}px;--rot:${Math.random() * 540}deg`;
    document.body.append(s);
    setTimeout(() => s.remove(), 950);
  }
}

// ===== CARGA DEL CATÁLOGO =====
async function loadProducts() {
  try {
    const res = await fetch('data/catalogo.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const categorias = Array.isArray(data.categorias) ? data.categorias : [];

    // producto -> categorías a las que pertenece (la categoría es la que dice qué productos tiene)
    const tagsOf = {};
    categorias.forEach((c) => (c.productos || []).forEach((id) => (tagsOf[id] = tagsOf[id] || []).push(c.id)));

    const path = (s) => String(s).replace(/^\//, '');
    FILTERS = [['todos', 'Todos'], ...categorias.map((c) => [c.id, c.nombre])];
    CUPONES = Array.isArray(data.cupones) ? data.cupones : [];
    PRODUCTS = (data.productos || []).map((p) => {
      const img = path(p.foto || 'img/logo.jpg');
      const fotos = Array.isArray(p.fotos) ? p.fotos.map(path) : [];
      // versiones livianas que genera el build (si faltan, se usan las originales)
      const minis = Array.isArray(p.minis) && p.minis.length === fotos.length ? p.minis.map(path) : fotos;
      const thumb = p.mini ? path(p.mini) : img;
      return {
        id: p.id,
        name: p.nombre,
        price: Number(p.precio) || 0,
        before: Number(p.antes) || 0,
        serves: p.porciones || '',
        img,
        gallery: [img, ...fotos],
        thumb,
        thumbs: [thumb, ...minis],
        desc: p.descripcion || '',
        sizes: Array.isArray(p.versiones) ? p.versiones.map(String) : [],
        tags: tagsOf[p.id] || [],
        badge: p.etiqueta || '',
        agotado: !!p.agotado,
      };
    });
  } catch (e) {
    console.error(e);
    return; // conserva el HTML que ya escribió el build
  }
  // sin precios cargados, ordenar por precio no tiene sentido
  if (!PRODUCTS.some((p) => p.price > 0)) document.querySelector('.sort').hidden = true;
  renderFilters('todos');
  renderProducts('todos');
  renderBag();
  // vuelve a validar el código que quedó guardado (pudo vencer o apagarse en /admin)
  let guardado = '';
  try { guardado = localStorage.getItem(CUPON_KEY) || ''; } catch (e) {}
  if (guardado && CUPONES.length) aplicarCupon(guardado, true);
}

updateOrder();
loadProducts();
