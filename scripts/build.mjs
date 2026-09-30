// Arma la web para publicar. Vercel lo ejecuta en cada cambio (ver vercel.json).
//  1. Lee tienda.config.json (lo define el desarrollador) y data/ajustes.json (lo edita el cliente en /admin)
//     y data/flyer.json + data/entregas.json + data/franjas.json (también desde /admin)
//  2. Junta data/productos/*.json, data/categorias/*.json y data/cupones/*.json en data/catalogo.json
//  3. Copia el sitio a dist/ reemplazando los %%MARCADORES%%, escribe los productos dentro
//     del HTML (para Google) y genera canonical, Open Graph, datos estructurados, robots.txt y sitemap.xml
// Uso local: node scripts/build.mjs  →  servir la carpeta dist/
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });

// ---------- Fotos livianas ----------
// Tarjetas, portada, flyer y fotos de clientes se muestran chicas: se genera una copia WebP del ancho
// justo en dist/img/_opt/. El nombre lleva un hash del contenido, así el navegador la guarda en caché
// y una foto reemplazada en /admin se ve al tiro. Las originales se mantienen (ficha, Google, redes).
// Si sharp no está instalado, se usan las originales.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('⚠️  sharp no está instalado (npm install): se usan las fotos originales'); }
const OPT = 'img/_opt';
const optimizadas = new Map();
function optimizar(src, ancho) {
  const path = String(src || '').replace(/^\//, '');
  if (!sharp || !/\.(jpe?g|png|webp)$/i.test(path) || !existsSync(join(ROOT, path))) return Promise.resolve(path);
  const key = `${path}@${ancho}`;
  if (!optimizadas.has(key)) {
    optimizadas.set(key, (async () => {
      try {
        const buf = readFileSync(join(ROOT, path));
        const out = `${OPT}/${createHash('sha1').update(buf).digest('hex').slice(0, 12)}-${ancho}.webp`;
        mkdirSync(join(DIST, OPT), { recursive: true });
        await sharp(buf).rotate().resize({ width: ancho, withoutEnlargement: true }).webp({ quality: 76 }).toFile(join(DIST, out));
        return out;
      } catch (e) {
        console.warn(`⚠️  No se pudo optimizar ${path}: ${e.message}`);
        return path;
      }
    })());
  }
  return optimizadas.get(key);
}
const MINI = 600; // ancho de las fotos en las tarjetas del catálogo (≈300 px en pantalla, x2 para pantallas retina)
const config = readJson(join(ROOT, 'tienda.config.json'));
const readData = (file) => (existsSync(join(DATA, file)) ? readJson(join(DATA, file)) : {});
const ajustes = readData('ajustes.json');
const flyer = readData('flyer.json');           // oferta vigente (editable en /admin)
const entregasData = readData('entregas.json'); // 3 fotos o videos de clientes (editable en /admin)
const franjasData = readData('franjas.json');   // frases de la cinta en movimiento (editable en /admin)

// Manda el dominio propio de site_url; si todavía es un .vercel.app, se usa el dominio de producción de Vercel
const propio = config.site_url && !/\.vercel\.app/.test(config.site_url);
const SITE = (!propio && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : config.site_url || 'http://localhost:5600').replace(/\/$/, '');

// ---------- 1. Datos de la tienda ----------
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const lista = (v, def) => {
  const l = (Array.isArray(v) ? v : []).map(str).filter(Boolean);
  return l.length ? [...new Set(l)] : def;
};
const T = {
  nombre: str(config.nombre),
  marca_a: str(config.marca_a) || str(config.nombre),
  marca_b: str(config.marca_b),
  rubro: str(config.rubro),
  schema_tipo: str(config.schema_tipo) || 'Bakery',
  whatsapp: str(ajustes.whatsapp).replace(/\D/g, ''),
  instagram: str(ajustes.instagram).replace(/^@/, ''),
  email: str(ajustes.email),
  ciudad: str(ajustes.ciudad),
  region: str(ajustes.region),
  zonas: lista(ajustes.zonas_entrega, [str(ajustes.ciudad) || 'Temuco']),
  envio_gratis: str(ajustes.envio_gratis),
  pagos: lista(ajustes.medios_pago, ['Transferencia']),
  dias: str(ajustes.dias_entrega) || 'Lunes a domingo',
  puntos: lista(ajustes.puntos_venta, []),
  puntos_total: Math.max(0, Math.round(Number(ajustes.puntos_venta_total) || 0)),
  seguidores: Math.max(0, Math.round(Number(ajustes.seguidores) || 0)),
  hero_titulo: str(ajustes.hero_titulo),
  hero_destacado: str(ajustes.hero_destacado),
  hero_bajada: str(ajustes.hero_bajada),
  hero_lema: str(ajustes.hero_lema),
  direccion: str(ajustes.direccion),
  vitrina: lista(ajustes.vitrina, []),
};
const zonasTexto = T.zonas.length > 1 ? `${T.zonas.slice(0, -1).join(', ')} y ${T.zonas.at(-1)}` : T.zonas[0];

// ---------- Oferta (flyer) ----------
const rel = (path) => str(path).replace(/^\//, '');
const F = {
  imagen: flyer.mostrar !== false ? rel(flyer.imagen) : '',
  titulo: str(flyer.titulo) || 'Oferta especial',
  descripcion: str(flyer.descripcion),
  mensaje: str(flyer.mensaje_whatsapp) || 'Hola Tío Caluga! Quiero la oferta 🍰',
};
F.popup = F.imagen && flyer.popup !== false ? F.imagen : '';

// ---------- Ustedes: fotos o videos de clientes (siempre 3) ----------
const ENTREGAS_BASE = [
  { archivo: 'img/entregas/entrega-1.jpg', titulo: 'Con vista al lago', texto: 'El postre viaja a donde vayas', descripcion: 'Postre Tío Caluga en frasco' },
  { archivo: 'img/entregas/entrega-2.jpg', titulo: 'Recién llegado', texto: 'Entregas de lunes a domingo', descripcion: 'Cliente con su postre Tío Caluga' },
  { archivo: 'img/entregas/entrega-3.jpg', titulo: 'Para compartir', texto: 'Cuchareable y fresco', descripcion: 'Postre Tío Caluga cuchareable' },
];
const listaEntregas = Array.isArray(entregasData.entregas) ? entregasData.entregas : [];
const entregas = ENTREGAS_BASE.map((base, i) => {
  const e = listaEntregas[i] || {};
  const archivo = rel(e.archivo) || base.archivo;
  return {
    archivo,
    video: /\.(mp4|webm|m4v|mov)$/i.test(archivo),
    titulo: str(e.titulo) || (e.archivo ? '' : base.titulo),
    texto: str(e.texto) || (e.archivo ? '' : base.texto),
    descripcion: str(e.descripcion) || str(e.titulo) || base.descripcion,
  };
});

// ---------- Cinta de texto en movimiento ----------
const FRANJA_BASE = ['Con o sin azúcar añadida', 'Entregas de lunes a domingo', 'Caluga artesanal', 'Frambuesas naturales'];
const VELOCIDAD = { lenta: 1.6, normal: 1, rapida: 0.6 };
function franja(key) {
  const f = franjasData[key] || {};
  const frases = (Array.isArray(f.frases) ? f.frases : []).map(str).filter(Boolean);
  const base = frases.length ? frases : FRANJA_BASE;
  // se repite hasta tener ~10 frases por mitad, para que el loop no deje huecos en pantallas anchas
  const vuelta = [];
  while (vuelta.length < 10) vuelta.push(...base);
  return { mostrar: f.mostrar !== false, items: vuelta, segundos: Math.round(vuelta.length * 5 * (VELOCIDAD[f.velocidad] || 1)) };
}
const F1 = franja('franja1');

const faltan = ['nombre', 'whatsapp', 'ciudad'].filter((k) => !T[k]);
if (faltan.length) throw new Error(`Faltan datos obligatorios: ${faltan.join(', ')} (tienda.config.json / data/ajustes.json)`);
if (!/^\d{10,15}$/.test(T.whatsapp) || (T.whatsapp.startsWith('56') && !/^569\d{8}$/.test(T.whatsapp))) {
  throw new Error(`WhatsApp inválido "${T.whatsapp}": usa formato internacional; en Chile son 11 dígitos, ej 56912345678`);
}

// ---------- 2. Catálogo ----------
function readFolder(folder) {
  const dir = join(DATA, folder);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const file of files) {
    try {
      items.push({ id: basename(file, '.json'), ...readJson(join(dir, file)) });
    } catch (e) {
      // Un archivo dañado no debe botar todo el catálogo: se omite y se avisa en el log
      console.warn(`⚠️  Se omitió ${folder}/${file}: ${e.message}`);
    }
  }
  return items;
}

const num = (v, def) => (v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : def);
const byOrder = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');

const productos = readFolder('productos')
  .filter((p) => p.visible !== false && typeof p.nombre === 'string' && p.nombre.trim())
  .map((p) => {
    const precio = Math.max(0, Math.round(num(p.precio, 0)));
    const antes = Math.max(0, Math.round(num(p.precio_antes, 0)));
    return {
      id: p.id,
      nombre: p.nombre.trim(),
      precio,
      // el precio anterior solo se muestra si es mayor que el actual
      antes: precio > 0 && antes > precio ? antes : 0,
      porciones: str(p.porciones),
      foto: typeof p.foto === 'string' && p.foto ? p.foto.replace(/^\//, '') : 'img/logo.jpg',
      fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter((f) => typeof f === 'string' && f).map((f) => f.replace(/^\//, '')),
      // versiones únicas y sin vacíos ("Con azúcar", "Sin azúcar añadida"…)
      versiones: [...new Set((Array.isArray(p.versiones) ? p.versiones : []).map(str).filter(Boolean))],
      descripcion: typeof p.descripcion === 'string' ? p.descripcion.trim() : '',
      etiqueta: typeof p.etiqueta === 'string' ? p.etiqueta.trim() : '',
      agotado: p.agotado === true,
      orden: num(p.orden, 1000),
    };
  })
  .sort(byOrder)
  .map(({ orden, ...p }) => p);

// Versiones chicas para las tarjetas y miniaturas (la ficha del producto usa las originales)
await Promise.all(productos.map(async (p) => {
  p.mini = await optimizar(p.foto, MINI);
  p.minis = await Promise.all(p.fotos.map((f) => optimizar(f, MINI)));
}));

const ids = new Set(productos.map((p) => p.id));

const categorias = readFolder('categorias')
  .filter((c) => c.visible !== false && typeof c.nombre === 'string' && c.nombre.trim())
  .map((c) => ({
    id: c.id,
    nombre: c.nombre.trim(),
    orden: num(c.orden, 1000),
    // se descartan productos borrados u ocultos, y repetidos
    productos: [...new Set(Array.isArray(c.productos) ? c.productos : [])].filter((id) => ids.has(id)),
  }))
  .sort(byOrder)
  .map(({ orden, ...c }) => c);

// ---------- Códigos de descuento (data/cupones, editables en /admin) ----------
// Se publican como huella SHA-256 y no como texto: la web puede comprobar un código que le escriben,
// pero nadie puede sacar la lista de códigos mirando el archivo. La sal debe coincidir con CUPON_SAL en app.js.
const CUPON_SAL = 'tio-caluga:';
const normCodigo = (c) => str(c).toUpperCase().replace(/\s+/g, '');
const huella = (c) => createHash('sha256').update(CUPON_SAL + normCodigo(c)).digest('hex');
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // AAAA-MM-DD
const productosDe = Object.fromEntries(categorias.map((c) => [c.id, c.productos]));
const vistos = new Set();
const cupones = readFolder('cupones')
  .filter((c) => c.activo !== false && normCodigo(c.codigo))
  .map((c) => {
    const tipo = c.tipo === 'monto' ? 'monto' : 'porcentaje';
    const valor = Math.max(0, Math.round(num(c.valor, 0)));
    const vence = /^\d{4}-\d{2}-\d{2}/.test(str(c.vence)) ? str(c.vence).slice(0, 10) : '';
    // sin productos ni categorías elegidos = aplica a toda la tienda
    const cats = Array.isArray(c.categorias) ? c.categorias : [];
    const prods = Array.isArray(c.productos) ? c.productos : [];
    const todos = !cats.length && !prods.length;
    return {
      id: c.id,
      codigo: normCodigo(c.codigo),
      h: huella(c.codigo),
      titulo: str(c.titulo) || normCodigo(c.codigo),
      tipo,
      valor: tipo === 'porcentaje' ? Math.min(100, valor) : valor,
      minimo: Math.max(0, Math.round(num(c.minimo, 0))),
      vence,
      productos: todos ? null : [...new Set([...cats.flatMap((id) => productosDe[id] || []), ...prods])].filter((id) => ids.has(id)),
      aplica: todos ? 'Toda la tienda' : [...categorias.filter((x) => cats.includes(x.id)).map((x) => x.nombre), ...(prods.length ? ['productos seleccionados'] : [])].join(', '),
    };
  })
  .filter((c) => {
    if (!c.valor) return console.warn(`⚠️  Cupón «${c.titulo}» sin valor de descuento: se omitió`), false;
    if (c.vence && c.vence < hoy) return console.warn(`ℹ️  Cupón «${c.titulo}» vencido el ${c.vence}: se omitió`), false;
    if (c.productos && !c.productos.length) return console.warn(`⚠️  Cupón «${c.titulo}» no tiene productos visibles: se omitió`), false;
    if (vistos.has(c.codigo)) return console.warn(`⚠️  Código ${c.codigo} repetido: se usa solo el primero`), false;
    vistos.add(c.codigo);
    return true;
  })
  .map(({ id, codigo, ...c }) => c);

writeFileSync(join(DATA, 'catalogo.json'), JSON.stringify({
  _aviso: 'Archivo generado por scripts/build.mjs. No editar a mano.',
  categorias,
  productos,
  cupones,
}, null, 2) + '\n');
console.log(`✅ catálogo: ${productos.length} productos, ${categorias.length} categorías, ${cupones.length} códigos de descuento activos`);

// ---------- 3. Marcadores %%CLAVE%% ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clp = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const abs = (path) => `${SITE}/${String(path).replace(/^\//, '')}`;
const colores = config.colores || {};
const fuentes = config.fuentes || {};
const hero = Array.isArray(config.hero) ? config.hero : [];
const heroFoto = (i) => (hero[i] && hero[i].foto) || (productos[i] && productos[i].foto) || 'img/logo.jpg';
const HERO_OPT = await Promise.all([optimizar(heroFoto(0), 1100), optimizar(heroFoto(1), 800), optimizar(heroFoto(2), 700)]);

// ---------- Vitrina de la portada: hasta 5 postres elegidos en /admin (si no, los primeros de la carta) ----------
const porId = new Map(productos.map((p) => [p.id, p]));
const vitrina = (T.vitrina.map((id) => porId.get(id)).filter(Boolean).length ? T.vitrina.map((id) => porId.get(id)).filter(Boolean) : productos)
  .filter((p) => !p.agotado)
  .slice(0, 5);
if (!vitrina.length) throw new Error('La vitrina de la portada necesita al menos un postre visible');
const VITRINA = await Promise.all(vitrina.map(async (p) => ({
  id: p.id,
  nombre: p.nombre,
  precio: p.precio > 0 ? clp(p.precio) : 'Consultar',
  foto: await optimizar(p.foto, 900),
  mini: await optimizar(p.foto, 200),
})));
const vitrinaHtml = VITRINA.map((v, i) => `<button type="button" class="orb${i ? '' : ' is-on'}" style="--k:${i}" data-orb="${i}" data-id="${esc(v.id)}" data-foto="${esc(v.foto)}" data-nombre="${esc(v.nombre)}" data-precio="${esc(v.precio)}" aria-label="Ver ${esc(v.nombre)} en la vitrina" aria-pressed="${!i}"><img src="${esc(v.mini)}" alt="" width="200" height="200"></button>`).join('');
const FLYER_OPT = F.imagen ? await optimizar(F.imagen, 880) : '';
for (const e of entregas) if (!e.video) e.archivo = await optimizar(e.archivo, 700);
const heroAlt = (i) => (hero[i] && hero[i].alt) || (productos[i] && productos[i].nombre) || T.nombre;
const FUENTE_TITULOS = fuentes.titulos || 'Fraunces';
const FUENTE_TEXTO = fuentes.texto || 'Figtree';
const fam = (f) => encodeURIComponent(f).replace(/%20/g, '+');

const SEO_TITULO = str(config.seo_titulo) || `${T.nombre} · ${T.rubro} en ${T.ciudad}`;
const SEO_DESCRIPCION = str(config.seo_descripcion) || T.hero_bajada;
const precios = productos.map((p) => p.precio).filter((n) => n > 0);

const VARS = {
  NOMBRE: T.nombre, MARCA_A: T.marca_a, MARCA_B: T.marca_b, RUBRO: T.rubro,
  SEO_TITULO, SEO_DESCRIPCION,
  CIUDAD: T.ciudad, REGION: T.region, ZONAS: zonasTexto, ENVIO_GRATIS: T.envio_gratis, DIAS: T.dias,
  PAGOS: T.pagos.join(' · '),
  INSTAGRAM: T.instagram, EMAIL: T.email,
  PUNTOS_TOTAL: T.puntos_total ? String(T.puntos_total) : '',
  SEGUIDORES: T.seguidores ? clp(T.seguidores).slice(1) : '', SEGUIDORES_N: String(T.seguidores),
  DESDE: precios.length ? clp(Math.min(...precios)) : '',
  HERO_TITULO: T.hero_titulo, HERO_DESTACADO: T.hero_destacado, HERO_BAJADA: T.hero_bajada,
  HERO_TEXTURA: HERO_OPT[1], HERO_LEMA: T.hero_lema,
  VITRINA_ID: VITRINA[0].id, VITRINA_NOMBRE: VITRINA[0].nombre, VITRINA_PRECIO: VITRINA[0].precio, VITRINA_FOTO: VITRINA[0].foto,
  DIRECCION: T.direccion || T.ciudad, DIAS_MIN: T.dias.charAt(0).toLowerCase() + T.dias.slice(1),
  MAPA_QUERY: encodeURIComponent([T.direccion, T.ciudad, T.region, 'Chile'].filter(Boolean).join(', ')),
  HERO_1: HERO_OPT[0], HERO_1_ALT: heroAlt(0), HERO_2: HERO_OPT[1], HERO_2_ALT: heroAlt(1), HERO_3: HERO_OPT[2], HERO_3_ALT: heroAlt(2),
  FUENTES_URL: `https://fonts.googleapis.com/css2?family=${fam(FUENTE_TITULOS)}:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=${fam(FUENTE_TEXTO)}:wght@400;500;600;700&display=swap`,
  FUENTE_TITULOS, FUENTE_TEXTO,
  GITHUB_REPO: str(config.github_repo), SITE_URL: `${SITE}/`,
  COLOR_FONDO: colores.fondo, COLOR_PAPEL: colores.papel,
  COLOR_FRAMBUESA: colores.frambuesa, COLOR_FRAMBUESA_OSCURO: colores.frambuesa_oscuro, COLOR_FRAMBUESA_CLARO: colores.frambuesa_claro,
  COLOR_CALUGA: colores.caluga, COLOR_CALUGA_CLARO: colores.caluga_claro,
  COLOR_CHOCOLATE: colores.chocolate, COLOR_TINTA: colores.tinta, COLOR_TINTA_SUAVE: colores.tinta_suave,
  COLOR_PISTACHO: colores.pistacho, COLOR_CREMA: colores.crema,
  FLYER: FLYER_OPT, FLYER_POPUP: F.popup ? FLYER_OPT : '', FLYER_TITULO: F.titulo, FLYER_TEXTO: F.descripcion,
  FLYER_ALT: F.descripcion || F.titulo,
  FRANJA1: F1.mostrar ? '1' : '', FRANJA1_SEG: String(F1.segundos),
  PUNTOS: T.puntos.length ? '1' : '',
  FLYER_WA: `https://api.whatsapp.com/send?phone=${T.whatsapp}&text=${encodeURIComponent(F.mensaje)}`,
  // Solo lo que necesita el navegador (app.js)
  TIENDA_JSON: JSON.stringify({
    nombre: T.nombre, whatsapp: T.whatsapp, ciudad: T.ciudad, zonas: T.zonas, pagos: T.pagos, envio_gratis: T.envio_gratis,
  }),
};

// Bloques opcionales: <!-- SI:CLAVE --> ... <!-- /SI:CLAVE --> se eliminan si CLAVE está vacía
function render(text, file, escape) {
  let out = text;
  for (let prev; prev !== out;) { // se repite para resolver bloques anidados
    prev = out;
    out = out.replace(/<!-- SI:([A-Z0-9_]+) -->([\s\S]*?)<!-- \/SI:\1 -->/g, (m, key, body) => (str(VARS[key]) ? body : ''));
  }
  const missing = new Set();
  out = out.replace(/%%([A-Z0-9_]+)%%/g, (m, key) => {
    const v = VARS[key];
    if (v === undefined || v === null || (v === '' && key.startsWith('COLOR_'))) { missing.add(key); return m; }
    return escape && key !== 'TIENDA_JSON' ? esc(v) : String(v);
  });
  if (missing.size) throw new Error(`${file}: faltan valores para ${[...missing].join(', ')}`);
  return out;
}

// ---------- 4. SEO ----------
const pct = (p) => Math.round((1 - p.precio / p.antes) * 100);
const card = (p) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <button class="card__media" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
        <img src="${esc(p.mini)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">
        ${p.minis[0] ? `<img class="alt" src="${esc(p.minis[0])}" alt="" loading="lazy" decoding="async">` : ''}
        ${p.fotos.length ? `<span class="card__more">+${p.fotos.length} ${p.fotos.length === 1 ? 'foto' : 'fotos'}</span>` : ''}
      </button>
      ${p.agotado ? '<span class="lid lid--off">Agotado</span>' : p.antes ? `<span class="lid"><b>−${pct(p)}%</b></span>` : p.etiqueta ? `<span class="lid lid--txt">${esc(p.etiqueta)}</span>` : ''}
      <div class="card__body">
        ${p.porciones ? `<p class="card__serves">${esc(p.porciones)}</p>` : ''}
        <h3>${esc(p.nombre)}</h3>
        ${p.descripcion ? `<p class="card__desc">${esc(p.descripcion)}</p>` : ''}
        ${p.versiones.length ? `<ul class="flavors" aria-label="Versiones">${p.versiones.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <div class="card__foot">
          <p class="price${p.precio > 0 ? '' : ' price--ask'}">${p.antes ? `<s>${clp(p.antes)}</s>` : ''}<strong>${p.precio > 0 ? clp(p.precio) : 'Consultar'}</strong></p>
          ${p.agotado
            ? `<a class="btn btn--line btn--sm" target="_blank" rel="noopener" href="${esc(`https://api.whatsapp.com/send?phone=${T.whatsapp}&text=${encodeURIComponent(`Hola! ¿Cuándo vuelve ${p.nombre}?`)}`)}">Avísame</a>`
            : `<button class="btn btn--berry btn--sm" type="button" data-view="${esc(p.id)}">${p.versiones.length > 1 ? 'Elegir' : 'Agregar'}</button>`}
        </div>
      </div>
    </article>`; // misma tarjeta que card() en app.js

const entregaHtml = (e, i) => `
          <figure class="moment moment--${i + 1}">
            ${e.video
              ? `<video data-src="${esc(e.archivo)}#t=0.1" muted loop playsinline preload="none" aria-label="${esc(e.descripcion)}"></video>`
              : `<img src="${esc(e.archivo)}" alt="${esc(e.descripcion)}" loading="lazy">`}
            ${e.titulo || e.texto ? `<figcaption>${e.titulo ? `<strong>${esc(e.titulo)}</strong>` : ''}${e.texto ? `<span>${esc(e.texto)}</span>` : ''}</figcaption>` : ''}
          </figure>`;

const OG_IMAGE = abs(heroFoto(0));
const sameAs = [T.instagram && `https://www.instagram.com/${T.instagram}/`].filter(Boolean);

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': T.schema_tipo,
      '@id': `${SITE}/#tienda`,
      name: T.nombre,
      description: SEO_DESCRIPCION,
      url: `${SITE}/`,
      logo: abs('img/logo.jpg'),
      image: [OG_IMAGE, abs('img/logo.jpg')],
      email: T.email || undefined,
      telephone: `+${T.whatsapp}`,
      servesCuisine: 'Repostería',
      areaServed: T.zonas.map((name) => ({ '@type': 'City', name })),
      priceRange: precios.length ? `${clp(Math.min(...precios))} – ${clp(Math.max(...precios))}` : undefined,
      currenciesAccepted: 'CLP',
      paymentAccepted: T.pagos.join(', '),
      address: { '@type': 'PostalAddress', streetAddress: T.direccion || undefined, addressLocality: T.ciudad, addressRegion: T.region || undefined, addressCountry: 'CL' },
      sameAs: sameAs.length ? sameAs : undefined,
    },
    {
      '@type': 'ItemList',
      name: 'Catálogo',
      // Google exige precio en los Product: los "Consultar" quedan fuera de los datos estructurados
      itemListElement: productos.filter((p) => p.precio > 0).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.nombre,
          image: [p.foto, ...p.fotos].map(abs),
          description: p.descripcion || p.nombre,
          offers: {
            '@type': 'Offer',
            url: `${SITE}/#catalogo`,
            price: p.precio,
            priceCurrency: 'CLP',
            availability: `https://schema.org/${p.agotado ? 'OutOfStock' : 'InStock'}`,
            seller: { '@id': `${SITE}/#tienda` },
            // producto perecible: no se aceptan devoluciones
            hasMerchantReturnPolicy: {
              '@type': 'MerchantReturnPolicy',
              applicableCountry: 'CL',
              returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
            },
          },
        },
      })),
    },
  ],
};

const head = `<link rel="canonical" href="${SITE}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(T.nombre)}">
  <meta property="og:locale" content="es_CL">
  <meta property="og:url" content="${SITE}/">
  <meta property="og:title" content="${esc(SEO_TITULO)}">
  <meta property="og:description" content="${esc(SEO_DESCRIPCION)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">${config.google_verificacion
    ? `\n  <meta name="google-site-verification" content="${esc(config.google_verificacion)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

// ---------- 5. dist/ ----------
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const marker of ['<!-- SEO:HEAD', '<!-- SEO:PRODUCTOS -->', '<!-- ENTREGAS:LISTA', '<!-- FRANJA1 -->', '<!-- PUNTOS:LISTA -->', '<!-- ZONAS:LISTA -->', '<!-- VITRINA:LISTA -->']) {
  if (!html.includes(marker)) throw new Error(`Falta el marcador ${marker} en index.html`);
}
html = render(html, 'index.html', true)
  .replace(/<!-- SEO:HEAD[^>]*-->/, head)
  .replace('<!-- SEO:PRODUCTOS -->', productos.map(card).join(''))
  .replace(/<!-- ENTREGAS:LISTA[^>]*-->/, entregas.map(entregaHtml).join(''))
  // la cinta lleva sus frases 2 veces seguidas: la animación corre la mitad y vuelve a empezar sin salto
  .replace('<!-- FRANJA1 -->', [...F1.items, ...F1.items].map((t) => `<span>${esc(t)}</span>`).join(''))
  .replace('<!-- PUNTOS:LISTA -->', T.puntos.map((t) => {
    const [lugar, zona] = t.split('·').map((s) => s.trim());
    return `<li><strong>${esc(lugar)}</strong>${zona ? `<span>${esc(zona)}</span>` : ''}</li>`;
  }).join(''))
  .replace('<!-- ZONAS:LISTA -->', T.zonas.map((z) => `<li>${esc(z)}</li>`).join(''))
  .replace('<!-- VITRINA:LISTA -->', vitrinaHtml);

cpSync(join(ROOT, 'img'), join(DIST, 'img'), { recursive: true });
if (existsSync(join(ROOT, 'favicon.ico'))) cpSync(join(ROOT, 'favicon.ico'), join(DIST, 'favicon.ico')); // Google busca el ícono aquí
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
cpSync(join(DATA, 'catalogo.json'), join(DIST, 'data', 'catalogo.json'));
// styles.css y app.js llevan ?v=hash: se guardan en caché y cada cambio publicado se descarga de nuevo
const css = render(readFileSync(join(ROOT, 'styles.css'), 'utf8'), 'styles.css', false);
const js = render(readFileSync(join(ROOT, 'app.js'), 'utf8'), 'app.js', false);
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
html = html
  .replace('href="styles.css"', `href="styles.css?v=${version(css)}"`)
  .replace('src="app.js"', `src="app.js?v=${version(js)}"`);
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'styles.css'), css);
writeFileSync(join(DIST, 'app.js'), js);
writeFileSync(join(DIST, 'admin', 'config.yml'), render(readFileSync(join(ROOT, 'admin', 'config.yml'), 'utf8'), 'admin/config.yml', false));

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`);

if (!existsSync(join(ROOT, 'img', 'logo.jpg'))) console.warn('⚠️  Falta img/logo.jpg (logo de la tienda)');
console.log(`✅ sitio listo en dist/ para ${SITE}`);
