// Pure logic shared by the app and the tests (no DOM access here).

// Mirrors Blink's feColorMatrix -> feComponentTransfer(table) so output matches EasyChar bit for bit
export function gradientMap(rgba, colors) {
  // tableValues are parsed as float32; the table math runs in double and truncates to uint8
  const stops = colors.map((hex) => [1, 3, 5].map((i) => Math.fround(parseInt(hex.slice(i, i + 2), 16) / 255)));
  const n = stops.length - 1;
  const lut = [0, 1, 2].map((ch) => Uint8Array.from({ length: 256 }, (_, i) => {
    const c = i / 255;
    const k = Math.floor(c * n);
    const v1 = stops[k][ch];
    const v2 = stops[Math.min(k + 1, n)][ch];
    return Math.min(255, Math.max(0, 255 * (v1 + (c * n - k) * (v2 - v1))));
  }));
  for (let p = 0; p < rgba.length; p += 4) {
    if (!rgba[p + 3]) continue;
    const g = Math.min(255, Math.round(0.33 * (rgba[p] + rgba[p + 1] + rgba[p + 2])));
    rgba[p] = lut[0][g];
    rgba[p + 1] = lut[1][g];
    rgba[p + 2] = lut[2][g];
  }
  return rgba;
}

// RPG Maker 2000 sheet grid (slots) for a single sprite of w x h
export function sheetLayout(w, h) {
  if (w === 72 && h === 128) return [4, 2]; // CharSet 288x256
  if (w === 48 && h === 48) return [4, 4]; // FaceSet 192x192
  return [1, 1];
}

// Map RGBA pixels to <=256 palette entries; index 0 is the transparent key (RM2k rule)
export function indexColors(rgba) {
  const rgb = (p) => (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
  const counts = new Map();
  for (let p = 0; p < rgba.length; p += 4) {
    if (rgba[p + 3] >= 128) counts.set(rgb(p), (counts.get(rgb(p)) ?? 0) + 1);
  }
  // ponytail: popularity quantizer (top 255, rest -> nearest); median cut if rare colors matter
  const colors = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, 255);
  let key = 0x209c00; // charas green, shifted until unused
  while (counts.has(key)) key = (key + 0x010305) & 0xffffff;
  const lookup = new Map(colors.map((c, i) => [c, i + 1]));
  const nearest = (c) => {
    let best = 1, bestD = Infinity;
    colors.forEach((q, i) => {
      const d = ((c >> 16) - (q >> 16)) ** 2 + (((c >> 8) & 255) - ((q >> 8) & 255)) ** 2 + ((c & 255) - (q & 255)) ** 2;
      if (d < bestD) { bestD = d; best = i + 1; }
    });
    return best;
  };
  const indices = new Uint8Array(rgba.length / 4);
  for (let p = 0; p < rgba.length; p += 4) {
    if (rgba[p + 3] < 128) continue;
    const c = rgb(p);
    if (!lookup.has(c)) lookup.set(c, nearest(c));
    indices[p / 4] = lookup.get(c);
  }
  return { palette: [key, ...colors], indices, reduced: Math.max(0, counts.size - 255) };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export const inflate = (bytes) => pipe(bytes, new DecompressionStream('deflate'));

// 8-bit indexed PNG, 256-entry palette, index 0 transparent: what RPG Maker 2000/2003 expects
export async function encodeIndexedPNG(rgba, w, h) {
  const { palette, indices, reduced } = indexColors(rgba);
  const raw = new Uint8Array((w + 1) * h); // each scanline: filter byte 0 + indices
  for (let y = 0; y < h; y++) raw.set(indices.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 3, 0, 0, 0], 8); // depth 8, palette color type
  const plte = new Uint8Array(256 * 3);
  palette.forEach((c, i) => plte.set([c >> 16, (c >> 8) & 255, c & 255], i * 3));
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('tRNS', new Uint8Array([0])),
    chunk('IDAT', await pipe(raw, new CompressionStream('deflate'))), chunk('IEND', new Uint8Array()),
  ];
  return { bytes: new Uint8Array(await new Blob(parts).arrayBuffer()), reduced, colors: palette.length };
}

// Key color of an indexed PNG without tRNS (classic RM2k sheets): palette entry 0
export function pngKeyColor(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0) !== 0x89504e47) return null;
  let indexed = false;
  let key = null;
  for (let p = 8; p + 8 <= bytes.length; p += 12 + view.getUint32(p)) {
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    if (type === 'IHDR') indexed = bytes[p + 17] === 3;
    else if (type === 'PLTE' && indexed) key = [...bytes.subarray(p + 8, p + 11)];
    else if (type === 'tRNS') return null; // the browser already applies it
    else if (type === 'IDAT') break; // tRNS must come before IDAT
  }
  return key;
}

// Port of EasyChar's changeYposition: first matching rule wins
export function yShiftFor(rules = [], { variant, body, cat }) {
  for (const r of rules) {
    if (r.v && r.v !== variant) continue;
    if (r.body && !r.body.includes(body)) continue;
    if (r.cats && !r.cats.includes(cat)) continue;
    if (r.notRe && new RegExp(r.notRe).test(cat)) continue;
    return r.dy;
  }
  return 0;
}
