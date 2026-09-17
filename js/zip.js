// Just enough ZIP to get the game files out of a shareware archive.
//
// A .zip from archive.org is both fewer requests and less to download than
// the files loose: ROTT.zip is 3.7 MB against 6.5 MB for the WAD and RTL on
// their own. Deflate is done by the browser's own DecompressionStream, so
// this is a directory parser and nothing more.

const EOCD = 0x06054b50, EOCD64_LOC = 0x07064b50, CEN = 0x02014b50;

function findEocd(dv) {
  // The end record is last, but a comment may follow it; scan back for it.
  const max = Math.min(dv.byteLength, 0xffff + 22);
  for (let i = 22; i <= max; i++) {
    const at = dv.byteLength - i;
    if (dv.getUint32(at, true) === EOCD) return at;
  }
  return -1;
}

// [{name, size, method, offset}], everything the central directory says.
export function entries(buf) {
  const dv = new DataView(buf);
  const eocd = findEocd(dv);
  if (eocd < 0) throw new Error('not a zip (no end record)');
  let count = dv.getUint16(eocd + 10, true);
  let start = dv.getUint32(eocd + 16, true);
  // Zip64, when the 32-bit fields are saturated.
  if (start === 0xffffffff || count === 0xffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (dv.getUint32(i, true) !== EOCD64_LOC) continue;
      const rec = Number(dv.getBigUint64(i + 8, true));
      count = Number(dv.getBigUint64(rec + 32, true));
      start = Number(dv.getBigUint64(rec + 48, true));
      break;
    }
  }
  const out = [];
  let at = start;
  for (let i = 0; i < count && at + 46 <= dv.byteLength; i++) {
    if (dv.getUint32(at, true) !== CEN) break;
    const method = dv.getUint16(at + 10, true);
    const csize = dv.getUint32(at + 20, true);
    const size = dv.getUint32(at + 24, true);
    const nlen = dv.getUint16(at + 28, true);
    const elen = dv.getUint16(at + 30, true);
    const clen = dv.getUint16(at + 32, true);
    const offset = dv.getUint32(at + 42, true);
    let name = '';
    const b = new Uint8Array(buf, at + 46, nlen);
    for (const c of b) name += String.fromCharCode(c);
    out.push({name, size, csize, method, offset});
    at += 46 + nlen + elen + clen;
  }
  return out;
}

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'function')
    throw new Error('this browser cannot inflate; unzip the file yourself');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer()).buffer;
}

// One entry's bytes. The local header repeats the name and extra fields, and
// its lengths are the ones to trust for where the data starts.
export async function read(buf, entry) {
  const dv = new DataView(buf);
  const at = entry.offset;
  if (dv.getUint32(at, true) !== 0x04034b50) throw new Error('bad local header');
  const nlen = dv.getUint16(at + 26, true), elen = dv.getUint16(at + 28, true);
  const from = at + 30 + nlen + elen;
  const bytes = new Uint8Array(buf, from, entry.csize || entry.size);
  if (entry.method === 0) return bytes.slice().buffer;      // stored
  if (entry.method === 8) return inflate(bytes);            // deflate
  throw new Error(`unsupported compression (method ${entry.method})`);
}

export function isZip(buf) {
  const b = new Uint8Array(buf, 0, 4);
  return b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7);
}

// Pull out whatever looks like game data: the art and the levels, by
// extension, largest first where a zip holds several.
export async function gameFiles(buf) {
  const want = /\.(wad|rtl|rtc|rtr)$/i;
  const picks = entries(buf).filter(e => want.test(e.name))
                            .sort((a, b) => b.size - a.size);
  const out = [];
  for (const e of picks) out.push(await read(buf, e));
  return out;
}
