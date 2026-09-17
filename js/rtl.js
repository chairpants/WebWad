// Reading a ROTT level file (.RTL / .RTC / .RTR) in the browser.
//
// Ported from ../ROTT's rott.py (rlew/expand/load/planes). A level file holds
// 100 slots; each says whether it is used, its RLEW tag, its name, and where
// its three 128x128 planes live: walls, things, and the info plane.

const HDR = 8, MAPHDR = 64, NMAPS = 100, DIM = 128;

// Wolf3D-style RLEW expansion, `skip` leading bytes ignored.
function rlew(b, tag, nwords, skip) {
  const out = new Uint16Array(nwords);
  let i = skip, k = 0;
  const n = b.length;
  while (k < nwords && i + 1 < n) {
    const w = b[i] | (b[i + 1] << 8);
    i += 2;
    if (w === tag) {
      const cnt = b[i] | (b[i + 1] << 8), val = b[i + 2] | (b[i + 3] << 8);
      i += 4;
      for (let c = 0; c < cnt && k < nwords; c++) out[k++] = val;
    } else {
      out[k++] = w;
    }
  }
  return k === nwords ? out : null;
}

// A plane may or may not carry a leading uint16 expanded-length. Try both.
function expand(b, tag, nwords) {
  return rlew(b, tag, nwords, 2) || rlew(b, tag, nwords, 0);
}

export class Rtl {
  constructor(buf) {
    this.bytes = new Uint8Array(buf);
    const sig = String.fromCharCode(...this.bytes.subarray(0, 3));
    if (sig !== 'RTL' && sig !== 'RTC' && sig !== 'RTR')
      throw new Error('not an RTL/RTC/RTR file: ' + sig);
    this.sig = sig;
    const dv = new DataView(buf);
    this.maps = [];
    for (let i = 0; i < NMAPS; i++) {
      const o = HDR + i * MAPHDR;
      const used = dv.getUint32(o, true);
      const tag = dv.getUint32(o + 8, true), spec = dv.getUint32(o + 12, true);
      const start = [0, 1, 2].map(k => dv.getUint32(o + 16 + k * 4, true));
      const length = [0, 1, 2].map(k => dv.getUint32(o + 28 + k * 4, true));
      let name = '';
      for (let k = 0; k < 24; k++) {
        const c = this.bytes[o + 40 + k];
        if (!c) break;
        name += String.fromCharCode(c);
      }
      this.maps.push({n: i, used, tag, spec, name, start, length});
    }
  }

  // The levels a player can actually pick.
  used() { return this.maps.filter(m => m.used); }

  // [walls, things, info], each 128*128 words.
  planes(m) {
    return m.start.map((s, k) =>
      expand(this.bytes.subarray(s, s + m.length[k]), m.tag, DIM * DIM));
  }
}
