// Reading a ROTT WAD in the browser.
//
// Ported from the exporter in ../ROTT (rott.py's Wad class and rott_gfx.py's
// patch_indexed), which is the reference implementation and stays the place
// where the game's own tables and their citations live. Everything here is
// mechanical: lump directory, palette, and the column-major masked shapes.

const TRANSLUCENT = -1;   // a transpatch post that remaps what is behind it
const TRANS_MARK = 254;

export class Wad {
  // `buf` is an ArrayBuffer: a file the player picked, or one fetched.
  constructor(buf) {
    this.bytes = new Uint8Array(buf);
    this.view = new DataView(buf);
    const sig = String.fromCharCode(...this.bytes.subarray(0, 4));
    if (sig !== 'IWAD' && sig !== 'PWAD') throw new Error('not a WAD: ' + sig);
    const n = this.view.getUint32(4, true), off = this.view.getUint32(8, true);
    this.lumps = [];
    this.idx = new Map();
    for (let i = 0; i < n; i++) {
      const p = off + i * 16;
      const o = this.view.getUint32(p, true), sz = this.view.getUint32(p + 4, true);
      let name = '';
      for (let k = 0; k < 8; k++) {
        const c = this.bytes[p + 8 + k];
        if (!c) break;
        name += String.fromCharCode(c);
      }
      this.lumps.push({name, o, sz});
      if (!this.idx.has(name)) this.idx.set(name, i);
    }
    // ROTT's PAL is already 8-bit (values run to 252) -- do NOT rescale it as
    // a 6-bit VGA palette, that blows every texture out to white.
    this.pal = this.byName('PAL');
  }

  byName(name) {
    const i = this.idx.get(name);
    return i === undefined ? null : this.lumpAt(i);
  }

  lumpAt(i) {
    if (i < 0 || i >= this.lumps.length) return null;
    const l = this.lumps[i];
    return this.bytes.subarray(l.o, l.o + l.sz);
  }

  // The name at an index, for the sprite tables, which address art by its
  // position in the shape section rather than by name.
  nameAt(i) {
    return (i >= 0 && i < this.lumps.length) ? this.lumps[i].name : null;
  }
}

// Which table entry column 0 lives at. Most lumps store exactly `width`
// offsets and index them directly; a minority store width + 1 with a filler
// entry first. Both are detectable: the real column 0 always begins
// immediately after the table.
function colBase(dv, at, width) {
  const c0 = dv.getUint16(at + 10, true), c1 = dv.getUint16(at + 12, true);
  if (c0 === 10 + width * 2) return 0;
  if (c1 === 10 + (width + 1) * 2) return 1;
  return 0;
}

// `height` palette indices, null where clear, TRANSLUCENT where see-through.
function decodeColumn(b, start, height, trans) {
  const n = b.length, px = new Array(height).fill(null);
  let i = start;
  if (!(i >= 0 && i < n)) return px;
  while (i < n) {
    const topdelta = b[i];
    if (topdelta === 0xFF) break;
    if (i + 1 >= n) break;
    let length = b[i + 1];
    i += 2;
    // A post in a transpatch whose first data byte is 254 carries no pixels:
    // ScaleTransparentPost remaps what is already on screen for `length` rows
    // and the post is one byte long.
    if (trans && i < n && b[i] === TRANS_MARK) {
      for (let r = 0; r < length; r++) {
        const row = topdelta + r;
        if (row >= 0 && row < height) px[row] = TRANSLUCENT;
      }
      i += 1;
      continue;
    }
    if (length > n - i) length = n - i;   // truncated tail: clip, don't crash
    for (let r = 0; r < length; r++) {
      const row = topdelta + r;
      if (row >= 0 && row < height) px[row] = b[i + r];
    }
    i += length;
  }
  return px;
}

// Decode a lump to {w, h, orig, top, translevel, idx, mask}: raw palette
// indices plus a 0/128/255 opacity byte per pixel, both row-major. 128 is a
// translucent run. Returns null for anything that isn't a valid patch.
export function patchIndexed(wad, lumpName) {
  const data = wad.byName(lumpName);
  if (!data || data.length < 10) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const origsize = dv.getInt16(0, true);
  const width = dv.getInt16(2, true), height = dv.getInt16(4, true);
  const topoffset = dv.getInt16(8, true);
  if (width <= 0 || height <= 0 || width > 320 || height > 2000) return null;
  const base = colBase(dv, 0, width);
  const ncols = width + base;
  if (10 + ncols * 2 > data.length) return null;
  const colofs = [];
  for (let c = 0; c < ncols; c++) colofs.push(dv.getUint16(10 + c * 2, true));
  // base == 1 means the column table starts at 12, which is a transpatch: six
  // shorts of header, the sixth being translevel. That is the set ROTT hands
  // to ScaleTransparentPost, so it is the set whose 254 runs mean "see
  // through me" rather than "palette index 254".
  const trans = base === 1;
  const translevel = trans ? dv.getInt16(10, true) : null;

  const idx = new Uint8Array(width * height), mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    const start = colofs[x + base];
    if (start <= 0 || start >= data.length) continue;
    const col = decodeColumn(data, start, height, trans);
    for (let y = 0; y < height; y++) {
      const v = col[y];
      if (v === null) continue;
      const o = y * width + x;
      if (v === TRANSLUCENT) { mask[o] = 128; continue; }
      idx[o] = v;
      mask[o] = 255;
    }
  }
  // origsize is the reference box the art was drawn for: world size is
  // pixels * 64 / origsize, so a 128-origsize actor is half its pixel size.
  return {w: width, h: height, orig: origsize || 64, top: topoffset,
          translevel, idx, mask};
}

// A raw 64x64 wall texture, 128x128 flat or 256x200 sky half: column-major
// palette indices with no header at all.
export function rawLump(wad, name, expect) {
  const b = wad.byName(name);
  return (b && (expect === undefined || b.length === expect)) ? b : null;
}
