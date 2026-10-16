// Charas Studio: Charas-Project archive + EasyChar engine in one static page.
import { gradientMap, yShiftFor, sheetLayout, encodeIndexedPNG, pngKeyColor } from './engine.js';
import { LANGS, t, setLang, getLang, detectLang } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
const DEFAULT_COLORS = ['#1a1a1a', '#cc0000', '#ffffff']; // EasyChar's colorObjs
const SHOW_BY_DEFAULT = /^(body|base|face|eyes|hairs?)$/i;

const state = {
  gens: [], gen: null, set: null, data: null,
  layers: {}, variant: null, active: null,
  zoom: 4, tool: 'pencil', pose: 0, playing: true, thumbRow: 0,
  expanded: new Set(), search: '',
};

const out = $('#out');
const base = document.createElement('canvas'); // composed sprites, before paint
const paint = document.createElement('canvas'); // pencil pixels
const mask = document.createElement('canvas'); // eraser holes
const anim = $('#anim');

// ---------- helpers ----------
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids.filter((k) => k != null && k !== false));
  return node;
}

let statusTimer;
function status(msg, isError = false) {
  const s = $('#status');
  s.textContent = msg;
  s.className = `status show${isError ? ' error' : ''}`;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (s.className = 'status'), isError ? 6000 : 2200);
  if (isError) console.error(msg);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const geo = () => {
  const { w, h, grid: [cols, rows] } = state.data;
  return { w, h, cols, rows, cw: w / cols, ch: h / rows, cells: cols * rows };
};
const catById = (id) => state.data.categories.find((c) => c.id === id);
const items = (cat) => cat.flat[cat.variants ? state.variant : '_'] ?? [];
const currentItem = (cat) => (cat ? items(cat)[state.layers[cat.id].idx] : undefined);
// Charas category names are translated ("Items 2" -> "Objetos 2"); EasyChar ids stay as-is
const catName = (cat) => {
  const [, name, num] = cat.name.match(/^(.*?)((?: \d+)?)$/);
  const tr = t(`cat.${name}`);
  return (tr === `cat.${name}` ? name : tr) + num;
};

// ---------- data loading ----------
function normalize(data) {
  let slot = 0;
  for (const c of data.categories) c.slots ??= [slot++];
  data.slotCount ??= slot;
  const byId = Object.fromEntries(data.categories.map((c) => [c.id, c]));
  for (const c of data.categories) {
    const lists = c.variants ?? { _: c.items ?? byId[c.itemsRef]?.items ?? [] };
    c.flat = {};
    for (const [v, groups] of Object.entries(lists)) {
      c.flat[v] = groups.flatMap((g, gi) =>
        [g, ...(g.alts ?? [])].map((it, ai) => ({
          id: it.id, t: it.t, a: it.a, gi, alt: ai > 0, alts: ai === 0 ? (g.alts?.length ?? 0) : 0,
          src: Array.isArray(it.src) ? it.src : [`${data.base}${it.src ?? `${it.id}.png`}`],
        })));
    }
  }
  return data;
}

function defaultLayer(cat, cells) {
  return {
    show: cat.show ?? SHOW_BY_DEFAULT.test(cat.name),
    idx: 0, recolor: !!cat.recolor, colors: [...DEFAULT_COLORS], opacity: 100,
    frames: Array(cells).fill('t'),
  };
}

async function loadIndex() {
  const results = await Promise.allSettled(['data/charas/index.json', 'data/easychar/index.json'].map(fetchJSON));
  state.gens = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
  results.filter((r) => r.status === 'rejected').forEach((r) => console.warn('index missing:', r.reason.message));
  if (!state.gens.length) throw new Error(t('st.noData'));
  $('#genSelect').replaceChildren(...state.gens.map((g, i) => el('option', { value: String(i) }, g.name)));
}

async function selectGen(i) {
  state.gen = state.gens[i];
  $('#genSelect').value = String(i);
  $('#setSelect').replaceChildren(...state.gen.sets.map((s, j) =>
    el('option', { value: String(j) }, `${s.name} (${s.count})`)));
  await selectSet(0);
}

async function selectSet(j) {
  state.set = state.gen.sets[j];
  $('#setSelect').value = String(j);
  status(t('st.loading', { name: state.set.name }));
  try {
    state.data = normalize(await fetchJSON(state.set.file));
  } catch (e) {
    status(t('st.loadError', { msg: e.message }), true);
    return;
  }
  const g = geo();
  state.variant = state.data.defaultVariant ?? null;
  state.layers = Object.fromEntries(state.data.categories.map((c) => [c.id, defaultLayer(c, g.cells)]));
  state.active = state.data.categories.find((c) => c.menu !== false)?.id;
  state.expanded.clear();
  state.pose = g.rows === 4 && g.cols === 3 ? 2 : 0;
  state.thumbRow = state.pose;
  const fit = Math.min(($('.stage').clientWidth - 26) / g.w, 1100 / g.h);
  state.zoom = Math.max(1, Math.min(8, Math.floor(fit)));
  for (const c of [base, paint, mask, out]) Object.assign(c, { width: g.w, height: g.h });
  setupVariantSwitch();
  setupThumbRow();
  setupPoses();
  setupSheet();
  applyZoom();
  buildLayers();
  buildGrid();
  await render();
}

// ---------- images & recolor ----------
const imageCache = new Map();
function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('st.imgError', { src })));
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

const recolorCache = new Map();
async function getDrawable(src, colors) {
  const img = await loadImage(src);
  if (!colors) return img;
  const key = `${src}|${colors.join()}`;
  if (!recolorCache.has(key)) {
    // ponytail: unbounded until 400 entries, then flushed; LRU if memory matters
    if (recolorCache.size > 400) recolorCache.clear();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    gradientMap(data.data, colors);
    ctx.putImageData(data, 0, 0);
    recolorCache.set(key, c);
  }
  return recolorCache.get(key);
}

// ---------- EasyChar rules ----------
function bodyType() {
  return +(currentItem(catById(state.data.bodyCat))?.id ?? 0);
}

function isVisible(cat) {
  const rule = state.data.autoShow?.[cat.id];
  if (!rule) return state.layers[cat.id].show;
  return (!rule.v || rule.v === state.variant) && (!rule.body || rule.body.includes(bodyType()))
    && !!state.layers[rule.visible]?.show;
}

function recolorOf(cat) {
  const src = state.data.autoShow?.[cat.id]?.recolorFrom ?? state.data.remap?.[cat.id];
  const L = state.layers[src] ?? state.layers[cat.id];
  return L.recolor ? L.colors : null;
}

function yShift(cat) {
  return yShiftFor(state.data.yshift, { variant: state.variant, body: bodyType(), cat: cat.id });
}

// ---------- rendering ----------
let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const { w, h, cols, cw, ch } = geo();
  const draws = [];
  for (const cat of state.data.categories) {
    const item = isVisible(cat) && currentItem(cat);
    if (!item) continue;
    const L = state.layers[cat.id];
    const colors = recolorOf(cat);
    const dy = yShift(cat);
    cat.slots.forEach((slot, i) => item.src[i] && draws.push({ slot, src: item.src[i], L, colors, dy }));
  }
  draws.sort((a, b) => a.slot - b.slot);
  let imgs;
  try {
    imgs = await Promise.all(draws.map((d) => getDrawable(d.src, d.colors)));
  } catch (e) {
    status(e.message, true);
    return;
  }
  if (token !== renderToken) return; // a newer render started meanwhile
  const ctx = base.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  // 'b' (back) frames are drawn under every 't' (top) frame, 'h' is hidden: charas frame flags
  for (const pass of ['b', 't']) {
    draws.forEach((d, i) => {
      const fr = d.L.frames;
      ctx.globalAlpha = d.L.opacity / 100;
      if (pass === 't' && fr.every((f) => f === 't')) return ctx.drawImage(imgs[i], 0, d.dy);
      fr.forEach((f, c) => {
        if (f !== pass) return;
        const x = (c % cols) * cw;
        const y = Math.floor(c / cols) * ch;
        ctx.drawImage(imgs[i], x, y, cw, ch, x, y + d.dy, cw, ch);
      });
    });
  }
  ctx.globalAlpha = 1;
  composite();
}

let filled = new Set();
function composite() {
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, out.width, out.height);
  ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(paint, 0, 0);
  // Remember which cells have pixels so the animation skips empty frames
  const { cols, cells, cw, ch } = geo();
  const px = ctx.getImageData(0, 0, out.width, out.height).data;
  filled = new Set();
  for (let i = 3; i < px.length; i += 4) {
    if (!px[i]) continue;
    const x = (i >> 2) % out.width;
    const y = Math.floor((i >> 2) / out.width);
    filled.add(Math.floor(y / ch) * cols + Math.floor(x / cw));
    if (filled.size === cells) break;
  }
}

function applyZoom() {
  $('#zoom').value = String(state.zoom);
  out.style.width = `${out.width * state.zoom}px`;
  out.style.height = `${out.height * state.zoom}px`;
}

// ---------- animation ----------
function poseInfo() {
  const { cols, rows } = geo();
  const span = cols % 3 === 0 ? 3 : cols;
  return { span, perRow: cols / span, count: rows * (cols / span) };
}

function setupPoses() {
  const { cols, rows } = geo();
  const { count } = poseInfo();
  const arrows = cols === 3 && rows === 4 ? ['↑', '→', '↓', '←'] : null;
  const wrap = $('#poseButtons');
  wrap.replaceChildren(...Array.from({ length: count }, (_, p) => el('button', {
    class: 'btn small', 'aria-pressed': String(p === state.pose), 'aria-label': t('anim.n', { n: p + 1 }),
    onclick: () => {
      state.pose = p;
      wrap.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === p)));
    },
  }, arrows ? arrows[p] : String(p + 1))));
  $('.anim-row').hidden = count * poseInfo().span <= 1;
}

let tick = 0;
setInterval(() => {
  if (!state.data) return;
  const { cw, ch, cols } = geo();
  const { span, perRow } = poseInfo();
  const row = Math.floor(state.pose / perRow);
  const first = (state.pose % perRow) * span;
  const used = Array.from({ length: span }, (_, i) => i).filter((i) => filled.has(row * cols + first + i));
  const seq = span === 3 && used.length === 3 ? [0, 1, 2, 1] : used;
  if (state.playing) tick++;
  if (!seq.length) return;
  const col = first + (state.playing ? seq[tick % seq.length] : seq[Math.min(1, seq.length - 1)]);
  const scale = Math.max(1, Math.floor(96 / Math.max(cw, ch)));
  if (anim.width !== cw * scale) Object.assign(anim, { width: cw * scale, height: ch * scale });
  const ctx = anim.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, anim.width, anim.height);
  ctx.drawImage(out, col * cw, row * ch, cw, ch, 0, 0, anim.width, anim.height);
}, 160);

// ---------- layers panel (EasyChar rows) ----------
function buildLayers() {
  const list = $('#layerList');
  const { cols, cells } = geo();
  list.replaceChildren(...state.data.categories.filter((c) => c.menu !== false).map((cat) => {
    const L = state.layers[cat.id];
    const name = catName(cat);
    const idx = el('input', { type: 'number', min: '1', 'aria-label': t('layer.number', { cat: name }), value: String(L.idx + 1) });
    const of = el('span', { class: 'of' });
    const colorInputs = L.colors.map((c, i) => el('input', {
      type: 'color', value: c, 'aria-label': t('layer.color', { i: i + 1, cat: name }), disabled: !L.recolor,
      oninput: (e) => { L.colors[i] = e.target.value; render(); },
    }));
    const frameBtns = L.frames.map((f, i) => el('button', {
      type: 'button', 'data-f': f, 'aria-label': t('layer.frame', { i: i + 1, f }), title: t('layer.frame', { i: i + 1, f }),
      onclick: (e) => {
        L.frames[i] = { t: 'b', b: 'h', h: 't' }[L.frames[i]];
        e.target.dataset.f = L.frames[i];
        e.target.textContent = L.frames[i];
        render();
      },
    }, f));
    const row = el('div', { class: 'layer', 'data-cat': cat.id },
      el('input', {
        type: 'checkbox', checked: L.show, 'aria-label': t('layer.show', { cat: name }),
        onchange: (e) => { L.show = e.target.checked; syncRow(row, cat); render(); },
      }),
      el('button', { class: 'layer-name', title: t('layer.catalogOf', { cat: name }), onclick: () => setActive(cat.id) }, name),
      el('div', { class: 'stepper' },
        el('button', { class: 'icon-btn', 'aria-label': t('layer.prev', { cat: name }), onclick: () => step(cat, -1) }, '‹'),
        idx,
        el('button', { class: 'icon-btn', 'aria-label': t('layer.next', { cat: name }), onclick: () => step(cat, 1) }, '›'),
        of),
      el('div', { class: 'recolor' },
        el('input', {
          type: 'checkbox', checked: L.recolor, 'aria-label': t('layer.recolor', { cat: name }), title: t('layer.recolorTip'),
          onchange: (e) => { L.recolor = e.target.checked; colorInputs.forEach((c) => (c.disabled = !L.recolor)); render(); },
        }),
        ...colorInputs),
      el('details', {},
        el('summary', {}, t('layer.advanced')),
        el('div', { class: 'adv' },
          el('label', {}, t('layer.opacity'), el('input', {
            type: 'range', min: '0', max: '100', value: String(L.opacity), 'aria-label': t('layer.opacityOf', { cat: name }),
            oninput: (e) => { L.opacity = +e.target.value; render(); },
          })),
          cells > 1 && el('div', {},
            el('div', { class: 'frames', style: `grid-template-columns: repeat(${cols}, auto)` }, ...frameBtns),
            el('p', { class: 'frames-legend' }, t('layer.legend'))))));
    idx.addEventListener('change', () => setIndex(cat, +idx.value - 1));
    syncRow(row, cat);
    return row;
  }));
}

function syncRow(row, cat) {
  const L = state.layers[cat.id];
  const total = items(cat).length;
  row.classList.toggle('off', !L.show);
  row.classList.toggle('active', cat.id === state.active);
  row.querySelector('input[type=checkbox]').checked = L.show;
  const idx = row.querySelector('input[type=number]');
  idx.value = String(Math.min(L.idx + 1, total));
  idx.max = String(total);
  row.querySelector('.of').textContent = `/ ${total}`;
}

function syncAllRows() {
  document.querySelectorAll('.layer').forEach((row) => syncRow(row, catById(row.dataset.cat)));
}

function setIndex(cat, i, { show = true } = {}) {
  const total = items(cat).length;
  if (!total) return;
  const L = state.layers[cat.id];
  L.idx = ((i % total) + total) % total; // wrap like EasyChar
  if (show) L.show = true;
  syncAllRows(); // body-type changes may affect other rows' rules
  if (cat.id === state.active) markSelected();
  render();
}

const step = (cat, d) => setIndex(cat, state.layers[cat.id].idx + d);

function setActive(id) {
  state.active = id;
  state.search = '';
  $('#search').value = '';
  syncAllRows();
  buildGrid();
}

// ---------- catalog browser (charas style) ----------
function setupThumbRow() {
  const { rows } = geo();
  $('#thumbRowWrap').hidden = rows <= 1;
  $('#thumbRow').replaceChildren(...Array.from({ length: rows }, (_, r) => el('option', { value: String(r) }, String(r + 1))));
  $('#thumbRow').value = String(state.thumbRow);
}

function thumbStyle(item) {
  const { w, h, cw, ch, cols } = geo();
  const s = Math.max(1, Math.floor(64 / Math.max(cw, ch)));
  const col = cols === 3 ? 1 : 0;
  const urls = item.src.filter(Boolean).reverse().map((u) => `url("${encodeURI(u)}")`).join(',');
  return {
    width: `${cw * s}px`, height: `${ch * s}px`, backgroundImage: urls,
    backgroundSize: `${w * s}px ${h * s}px`,
    backgroundPosition: `${-col * cw * s}px ${-state.thumbRow * ch * s}px`,
  };
}

function buildGrid() {
  const grid = $('#grid');
  const cat = catById(state.active);
  if (!cat) return grid.replaceChildren(el('p', { class: 'empty' }, t('grid.noLayers')));
  const all = items(cat);
  const q = state.search.trim().toLowerCase();
  const shown = all.map((it, i) => ({ it, i })).filter(({ it }) => (q
    ? `${it.t} ${it.a ?? ''}`.toLowerCase().includes(q)
    : !it.alt || state.expanded.has(`${cat.id}:${it.gi}`)));
  $('#browserTitle').textContent = catName(cat);
  $('#browserCount').textContent = q ? t('grid.countOf', { n: shown.length, total: all.length }) : t('grid.count', { total: all.length });
  const selected = state.layers[cat.id].idx;
  grid.replaceChildren(...(shown.length ? shown.map(({ it, i }) => {
    const label = it.a ? t('grid.by', { t: it.t, a: it.a }) : it.t;
    const node = el('div', {
      class: `item${it.alt ? ' alt' : ''}`, role: 'option', tabindex: '0', title: label,
      'aria-selected': String(i === selected), 'data-i': String(i), 'aria-label': label,
      onclick: () => setIndex(cat, i),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIndex(cat, i); } },
    },
    el('div', { class: 'thumb checker' }),
    el('span', { class: 't' }, it.t),
    it.a && el('span', { class: 'a' }, it.a),
    it.alts > 0 && !q && el('button', {
      class: 'more', 'aria-label': t('grid.variants', { n: it.alts }), title: t('grid.variantsTip'),
      onclick: (e) => {
        e.stopPropagation();
        const key = `${cat.id}:${it.gi}`;
        state.expanded.has(key) ? state.expanded.delete(key) : state.expanded.add(key);
        buildGrid();
      },
    }, state.expanded.has(`${cat.id}:${it.gi}`) ? '−' : `+${it.alts}`));
    Object.assign(node.firstChild.style, thumbStyle(it));
    return node;
  }) : [el('p', { class: 'empty' }, t('grid.empty'))]));
}

function markSelected() {
  const sel = String(state.layers[state.active].idx);
  document.querySelectorAll('#grid .item').forEach((n) => n.setAttribute('aria-selected', String(n.dataset.i === sel)));
}

// ---------- variants (EasyChar child/adult) ----------
function setupVariantSwitch() {
  const v = state.data.variants;
  $('#variantWrap').hidden = !v;
  if (!v) return;
  $('#variantA').textContent = v[1];
  $('#variantB').textContent = v[0];
  $('#variantToggle').checked = state.variant === v[0];
}

// ---------- drawing (EasyChar pencil / eraser) ----------
let drawing = null;
function canvasPoint(e) {
  const r = out.getBoundingClientRect();
  return [Math.floor(((e.clientX - r.left) / r.width) * out.width), Math.floor(((e.clientY - r.top) / r.height) * out.height)];
}

function plot(x, y) {
  const p = paint.getContext('2d');
  const m = mask.getContext('2d');
  if (state.tool === 'pencil') {
    p.fillStyle = $('#brushColor').value;
    p.fillRect(x, y, 1, 1);
    m.clearRect(x, y, 1, 1);
  } else {
    p.clearRect(x, y, 1, 1);
    m.fillStyle = '#000';
    m.fillRect(x, y, 1, 1);
  }
}

function line(x0, y0, x1, y1) { // Bresenham
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

out.addEventListener('contextmenu', (e) => e.preventDefault());
out.addEventListener('pointerdown', (e) => {
  const [x, y] = canvasPoint(e);
  if (e.button === 2) { // eyedropper
    const [r, g, b, a] = out.getContext('2d').getImageData(x, y, 1, 1).data;
    if (a) $('#brushColor').value = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    return;
  }
  out.setPointerCapture(e.pointerId);
  drawing = [x, y];
  plot(x, y);
  composite();
});
out.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const [x, y] = canvasPoint(e);
  line(drawing[0], drawing[1], x, y);
  drawing = [x, y];
  composite();
});
out.addEventListener('pointerup', () => (drawing = null));
out.addEventListener('pointercancel', () => (drawing = null));

function clearPaint() {
  paint.getContext('2d').clearRect(0, 0, paint.width, paint.height);
  mask.getContext('2d').clearRect(0, 0, mask.width, mask.height);
  composite();
}

// ---------- RPG Maker 2000 sheet ----------
const sheets = new Map(); // "WxH" -> canvas, shared by every set with that sprite size
let slot = 0;

function sheetInfo() {
  const { w, h } = geo();
  const [cols, rows] = sheetLayout(w, h);
  const key = `${w}x${h}`;
  if (!sheets.has(key)) sheets.set(key, Object.assign(document.createElement('canvas'), { width: w * cols, height: h * rows }));
  return { canvas: sheets.get(key), cols, rows, w, h, multi: cols * rows > 1 };
}

function setupSheet() {
  const { canvas, cols, rows, multi } = sheetInfo();
  slot = 0;
  const view = $('#sheet');
  Object.assign(view, { width: canvas.width, height: canvas.height });
  for (const id of ['#sheetView', '#placeBtn', '#clearSlotBtn', '#loadSheetBtn']) $(id).hidden = !multi;
  const slots = $('#slots');
  Object.assign(slots.style, { gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` });
  slots.replaceChildren(...Array.from({ length: cols * rows }, (_, i) => el('button', {
    type: 'button', 'aria-pressed': String(i === slot), onclick: () => selectSlot(i),
  })));
  labelSheet();
  drawSheet();
}

function labelSheet() {
  $('#sheetDownload').textContent = t(sheetInfo().multi ? 'sheet.download' : 'sheet.downloadSingle');
  $('#slots').querySelectorAll('button').forEach((b, i) => {
    b.setAttribute('aria-label', t('sheet.slot', { n: i + 1 }));
    b.title = t('sheet.slot', { n: i + 1 });
  });
}

function selectSlot(i) {
  slot = i;
  $('#slots').querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
}

function drawSheet() {
  const { canvas } = sheetInfo();
  const ctx = $('#sheet').getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(canvas, 0, 0);
}

function slotRect() {
  const { cols, w, h } = sheetInfo();
  return [(slot % cols) * w, Math.floor(slot / cols) * h, w, h];
}

function placeInSlot() {
  const { canvas, cols, rows } = sheetInfo();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(...slotRect());
  ctx.drawImage(out, slotRect()[0], slotRect()[1]);
  drawSheet();
  selectSlot((slot + 1) % (cols * rows));
}

function clearSlot() {
  sheetInfo().canvas.getContext('2d').clearRect(...slotRect());
  drawSheet();
}

async function loadSheet(file) {
  const { canvas } = sheetInfo();
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width !== canvas.width || bmp.height !== canvas.height) {
      throw new Error(t('sheet.sizeError', { w: canvas.width, h: canvas.height, bw: bmp.width, bh: bmp.height }));
    }
    const tmp = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, tmp.width, tmp.height);
    const px = img.data;
    if (px.every((v, i) => i % 4 !== 3 || v === 255)) {
      // Classic RM2k sheet: palette index 0 (or the top-left pixel for BMP) is the transparent color
      const key = pngKeyColor(new Uint8Array(await file.arrayBuffer())) ?? [...px.subarray(0, 3)];
      for (let p = 0; p < px.length; p += 4) {
        if (px[p] === key[0] && px[p + 1] === key[1] && px[p + 2] === key[2]) px[p + 3] = 0;
      }
    }
    canvas.getContext('2d').putImageData(img, 0, 0);
    drawSheet();
    status(t('sheet.loaded'));
  } catch (e) {
    status(t('sheet.loadError', { msg: e.message }), true);
  }
}

async function downloadRM2k() {
  const { canvas, multi } = sheetInfo();
  const src = multi ? canvas : out;
  try {
    const rgba = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
    const { bytes, reduced } = await encodeIndexedPNG(rgba, src.width, src.height);
    if (reduced) status(t('sheet.reduced', { n: reduced }));
    saveBlob(new Blob([bytes], { type: 'image/png' }), `${state.set.name.replace(/\W+/g, '_')}_rm2k.png`);
  } catch (e) {
    status(t('export.error', { msg: e.message }), true);
  }
}

function saveBlob(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- credits ----------
function creditsText() {
  const lines = [];
  if (state.gen.source === 'charas') {
    lines.push('Sprites: Charas-Project (http://charas-project.net)',
      'Charas Generator © 2002-2026 Alexander Bonivento', '', t('cr.piecesUsed'));
    for (const cat of state.data.categories) {
      const it = isVisible(cat) && currentItem(cat);
      if (it) lines.push(`  ${catName(cat)}: ${it.t}${it.a ? ` — ${it.a}` : ''} (#${it.id})`);
    }
  } else {
    lines.push(state.data.credits || 'EasyChar — https://jetrotal.github.io/EasyChar/');
  }
  return lines.join('\n');
}

let charasCredits;
async function charasCreditsText() {
  charasCredits ??= fetchJSON('data/charas/credits.json');
  const c = await charasCredits;
  return ['Charas-Project (charas2)', c.site.generator, `${t('cr.offline')}: ${c.site.offline}`, `${t('cr.docs')}: ${c.site.docs}`, '',
    t('cr.spriteAuthors', { a: c.authors.length, s: c.sprites }),
    ...c.authors.map(([name, n]) => `  ${name} (${n})`), '', t('cr.thanks')].join('\n');
}

async function openCredits() {
  $('#creditsText').value = creditsText();
  $('#infoDialog').showModal();
  try {
    $('#charasCreditsText').value = await charasCreditsText();
    const n = (await charasCredits).authors.length;
    $('#charasCredits summary').textContent = t('dlg.allCharasN', { n });
  } catch (e) {
    charasCredits = undefined; // retry on next open
    $('#charasCreditsText').value = t('cr.loadError', { msg: e.message });
  }
}

// ---------- wiring ----------
function bindUI() {
  $('#genSelect').addEventListener('change', (e) => selectGen(+e.target.value));
  $('#setSelect').addEventListener('change', (e) => selectSet(+e.target.value));
  $('#variantToggle').addEventListener('change', (e) => {
    state.variant = state.data.variants[e.target.checked ? 0 : 1];
    syncAllRows();
    buildGrid();
    render();
  });
  $('#zoom').addEventListener('input', (e) => { state.zoom = +e.target.value; applyZoom(); });
  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    state.tool = b.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((o) => o.classList.toggle('active', o === b));
  }));
  $('#clearPaint').addEventListener('click', clearPaint);
  $('#playBtn').addEventListener('click', (e) => {
    state.playing = !state.playing;
    e.target.textContent = t(state.playing ? 'ui.pause' : 'ui.play');
    e.target.setAttribute('aria-pressed', String(state.playing));
  });
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; buildGrid(); });
  $('#thumbRow').addEventListener('change', (e) => { state.thumbRow = +e.target.value; buildGrid(); });
  $('#downloadBtn').addEventListener('click', () => out.toBlob((blob) => {
    if (!blob) return status(t('export.pngError'), true);
    saveBlob(blob, `${state.set.name.replace(/\W+/g, '_')}_${Date.now()}.png`);
  }, 'image/png'));
  $('#placeBtn').addEventListener('click', placeInSlot);
  $('#clearSlotBtn').addEventListener('click', clearSlot);
  $('#loadSheetBtn').addEventListener('click', () => $('#sheetFile').click());
  $('#sheetFile').addEventListener('change', (e) => {
    if (e.target.files[0]) loadSheet(e.target.files[0]);
    e.target.value = '';
  });
  $('#sheetDownload').addEventListener('click', downloadRM2k);
  $('#randomBtn').addEventListener('click', () => {
    for (const cat of state.data.categories) {
      if (cat.menu === false) continue;
      const n = items(cat).length;
      if (n) state.layers[cat.id].idx = Math.floor(Math.random() * n);
    }
    syncAllRows();
    buildGrid();
    render();
  });
  $('#resetBtn').addEventListener('click', () => { clearPaint(); selectSet(state.gen.sets.indexOf(state.set)); });
  $('#themeBtn').addEventListener('click', () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const cur = document.documentElement.dataset.theme ?? (dark ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* storage blocked: theme just won't persist */ }
  });
  $('#infoBtn').addEventListener('click', openCredits);
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById(b.dataset.copy).value);
      status(t('cr.copied'));
    } catch (e) {
      status(t('cr.copyError', { msg: e.message }), true);
    }
  }));
}

// ---------- language ----------
const OG_LOCALES = { es: 'es_ES', en: 'en_US', pt: 'pt_BR', fr: 'fr_FR', it: 'it_IT', de: 'de_DE', nl: 'nl_NL', sv: 'sv_SE', da: 'da_DK', ru: 'ru_RU' };

function applyLang(lang, { inUrl = false } = {}) {
  setLang(lang);
  const l = getLang();
  document.documentElement.lang = l;
  document.title = t('meta.title');
  $('meta[name="description"]').content = t('meta.description');
  $('meta[property="og:locale"]').content = OG_LOCALES[l];
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  // Trusted strings from i18n.js only (never scraped data)
  document.querySelectorAll('[data-i18n-html]').forEach((n) => { n.innerHTML = t(n.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-attr]').forEach((n) => n.dataset.i18nAttr.split(';').forEach((pair) => {
    const [attr, key] = pair.split('=');
    n.setAttribute(attr, t(key));
  }));
  $('#langSelect').value = l;
  document.querySelectorAll('#langLinks a').forEach((a) => a.setAttribute('aria-current', String(a.hreflang === l)));
  const url = new URL(location.href);
  if (inUrl) {
    url.searchParams.set('lang', l);
    history.replaceState(null, '', url);
  }
  // Each ?lang= page is its own canonical so hreflang alternates are not folded into one
  const canonical = $('link[rel="canonical"]');
  const root = canonical.href.split('?')[0];
  canonical.href = url.searchParams.has('lang') ? `${root}?lang=${l}` : root;
  $('#playBtn').textContent = t(state.playing ? 'ui.pause' : 'ui.play');
  if (state.data) {
    buildLayers();
    buildGrid();
    setupPoses();
    labelSheet();
  }
}

function chooseLang(lang) {
  try { localStorage.setItem('lang', lang); } catch { /* storage blocked: choice lasts this visit */ }
  applyLang(lang, { inUrl: true });
}

$('#langSelect').replaceChildren(...Object.entries(LANGS).map(([k, v]) => el('option', { value: k }, v)));
$('#langSelect').addEventListener('change', (e) => chooseLang(e.target.value));
document.querySelectorAll('#langLinks a').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  chooseLang(a.hreflang);
  scrollTo({ top: 0, behavior: 'smooth' });
}));

applyLang(detectLang());
bindUI();
loadIndex().then(() => selectGen(0)).catch((e) => status(e.message, true));
