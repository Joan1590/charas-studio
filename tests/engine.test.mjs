// Run: make test
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradientMap, yShiftFor, encodeIndexedPNG, indexColors, inflate, crc32, pngKeyColor, sheetLayout } from '../public/engine.js';

test('gradientMap matches EasyChar SVG filter output (default colors)', () => {
  // gray 173, 67, 161 -> values captured from jetrotal.github.io/EasyChar in Chromium
  const px = new Uint8ClampedArray([175, 175, 174, 255, 68, 68, 67, 255, 163, 163, 162, 255, 9, 9, 9, 0]);
  gradientMap(px, ['#1a1a1a', '#cc0000', '#ffffff']);
  assert.deepEqual([...px], [222, 91, 91, 255, 119, 12, 12, 255, 217, 66, 66, 255, 9, 9, 9, 0]);
});

test('yShiftFor follows EasyChar changeYposition order', () => {
  const rules = [
    { v: 'adult', body: [1, 9], cats: ['clothes'], dy: -2 },
    { v: 'adult', body: [2], cats: ['clothes'], dy: -1 },
    { v: 'child', notRe: 'body|clothes|bg-color', dy: 2 },
    { v: 'child', cats: ['xtra-body'], dy: 1 },
  ];
  assert.equal(yShiftFor(rules, { variant: 'adult', body: 9, cat: 'clothes' }), -2);
  assert.equal(yShiftFor(rules, { variant: 'adult', body: 2, cat: 'clothes' }), -1);
  assert.equal(yShiftFor(rules, { variant: 'child', body: 1, cat: 'hair-front' }), 2);
  assert.equal(yShiftFor(rules, { variant: 'child', body: 1, cat: 'xtra-body' }), 1);
  assert.equal(yShiftFor(rules, { variant: 'child', body: 1, cat: 'clothes' }), 0);
  assert.equal(yShiftFor(undefined, { variant: 'adult', body: 1, cat: 'head' }), 0);
});

function chunks(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  for (let p = 8; p < bytes.length; p += 12 + view.getUint32(p)) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    assert.equal(view.getUint32(p + 8 + len), crc32(bytes.subarray(p + 4, p + 8 + len)), `${type} crc`);
    out[type] = bytes.subarray(p + 8, p + 8 + len);
  }
  return out;
}

test('encodeIndexedPNG writes an RM2k-style 8-bit palette PNG', async () => {
  // 3x2: transparent, red, blue / red, half-alpha (dropped), blue
  const px = new Uint8Array([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 9, 9, 9, 100, 0, 0, 255, 255]);
  const { bytes, reduced, colors } = await encodeIndexedPNG(px, 3, 2);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const c = chunks(bytes);
  assert.deepEqual([...c.IHDR], [0, 0, 0, 3, 0, 0, 0, 2, 8, 3, 0, 0, 0]);
  assert.equal(c.PLTE.length, 768);
  assert.deepEqual([...c.tRNS], [0]);
  assert.deepEqual([reduced, colors], [0, 3]);
  assert.deepEqual([...c.PLTE.subarray(0, 9)], [0x20, 0x9c, 0x00, 255, 0, 0, 0, 0, 255]);
  assert.deepEqual([...(await inflate(c.IDAT))], [0, 0, 1, 2, 0, 1, 0, 2]);
  assert.equal(pngKeyColor(bytes), null); // has tRNS
});

test('pngKeyColor reads palette entry 0 of classic sheets without tRNS', async () => {
  const { bytes } = await encodeIndexedPNG(new Uint8Array([1, 2, 3, 255]), 1, 1);
  const c = chunks(bytes);
  const noTrns = new Uint8Array(await new Blob([bytes.subarray(0, 8),
    ...['IHDR', 'PLTE', 'IDAT', 'IEND'].map((t) => {
      const d = c[t]; const o = new Uint8Array(12 + d.length); const v = new DataView(o.buffer);
      v.setUint32(0, d.length); o.set([...t].map((x) => x.charCodeAt(0)), 4); o.set(d, 8);
      v.setUint32(8 + d.length, crc32(o.subarray(4, 8 + d.length))); return o;
    })]).arrayBuffer());
  assert.deepEqual(pngKeyColor(noTrns), [0x20, 0x9c, 0x00]);
});

test('indexColors keeps the 255 most used colors and an unused key', () => {
  const n = 300;
  const px = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) px.set([i & 255, i >> 8, 0x9c, 255], i * 4);
  px.set([0x20, 0x9c, 0x00, 255], 0); // occupy the default key color
  const { palette, indices, reduced } = indexColors(px);
  assert.equal(palette.length, 256);
  assert.equal(reduced, 45);
  assert.ok(!palette.slice(1).includes(palette[0]));
  assert.ok(indices.every((i) => i >= 1));
});

test('sheetLayout maps sprite sizes to RM2k sheets', () => {
  assert.deepEqual(sheetLayout(72, 128), [4, 2]);
  assert.deepEqual(sheetLayout(48, 48), [4, 4]);
  assert.deepEqual(sheetLayout(288, 384), [1, 1]);
});

test('every language translates every key with the same {vars}', async () => {
  const { STRINGS, LANGS } = await import('../public/i18n.js');
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const keys = Object.keys(STRINGS.es).sort();
  assert.deepEqual(Object.keys(STRINGS).sort(), Object.keys(LANGS).sort());
  for (const [lang, dict] of Object.entries(STRINGS)) {
    assert.deepEqual(Object.keys(dict).sort(), keys, `${lang} keys`);
    for (const k of keys) assert.equal(vars(dict[k]), vars(STRINGS.es[k]), `${lang} ${k} vars`);
  }
});
