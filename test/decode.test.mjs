// Hold the JS decoder to what the Python exporter produces.
//
//     node test/decode.test.mjs [path-to-WAD]
//
// reference.json comes from tools/make_reference.py, run against the
// exporter in ../ROTT. Checksums only: no WAD and no art is committed here.

import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {Wad, patchIndexed} from '../js/wad.js';
import {Rtl} from '../js/rtl.js';

const here = dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(readFileSync(join(here, 'reference.json'), 'utf8'));
const wadPath = process.argv[2] ||
      join(here, '..', '..', 'ROTT', ref.wad);

const sha = (b) => createHash('sha256').update(Buffer.from(b)).digest('hex').slice(0, 16);

let checks = 0, bad = 0;
const is = (what, got, want) => {
  checks++;
  if (got === want) return;
  bad++;
  console.error(`  ${what}: got ${got}, expected ${want}`);
};

const file = readFileSync(wadPath);
const wad = new Wad(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

is('wad bytes', file.length, ref.bytes);
is('lump count', wad.lumps.length, ref.lumps);
is('palette', sha(wad.pal), ref.pal);

for (const [name, want] of Object.entries(ref.patches)) {
  const q = patchIndexed(wad, name);
  if (!q) { checks++; bad++; console.error(`  ${name}: did not decode`); continue; }
  is(`${name} w`, q.w, want.w);
  is(`${name} h`, q.h, want.h);
  is(`${name} orig`, q.orig, want.orig);
  is(`${name} top`, q.top, want.top);
  is(`${name} pixels`, sha(q.idx), want.idx);
  is(`${name} mask`, sha(q.mask), want.mask);
}

for (const [name, want] of Object.entries(ref.raw)) {
  const b = wad.byName(name);
  is(`${name} bytes`, b ? b.length : 0, want.bytes);
  is(`${name} sha`, b ? sha(b) : '-', want.sha);
}

// the level file
const rtlFile = readFileSync(join(here, '..', '..', 'ROTT', ref.rtl.file));
const rtl = new Rtl(rtlFile.buffer.slice(rtlFile.byteOffset, rtlFile.byteOffset + rtlFile.byteLength));
is('rtl bytes', rtlFile.length, ref.rtl.bytes);
is('levels used', rtl.used().length, ref.rtl.levels.length);
for (const want of ref.rtl.levels) {
  const m = rtl.maps[want.n];
  is(`level ${want.n} name`, m.name, want.name);
  const planes = rtl.planes(m);
  planes.forEach((p, k) => {
    if (!p) { checks++; bad++; console.error(`  level ${want.n} plane ${k}: did not expand`); return; }
    const lo = new Uint8Array(p.length), hi = new Uint8Array(p.length);
    for (let i = 0; i < p.length; i++) { lo[i] = p[i] & 0xff; hi[i] = p[i] >> 8; }
    is(`level ${want.n} plane ${k}`, sha(Buffer.concat([Buffer.from(lo), Buffer.from(hi)])), want.planes[k]);
  });
}

console.log(bad ? `FAIL ${bad} of ${checks} checks` : `ok: ${checks} checks`);
process.exit(bad ? 1 : 0);
