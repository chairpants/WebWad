// Getting the game files in: from the player's disk, or from a URL, with
// whatever came last kept in the browser so the next visit costs nothing.
//
// Nothing here is ROTT-specific beyond the two file extensions -- which file
// is the art and which is the levels is decided by what the headers say.

import {Wad} from './wad.js';
import {Rtl} from './rtl.js';

const DB = 'rott-web', STORE = 'files';

function idb() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

async function cacheGet(key) {
  try {
    const db = await idb();
    return await new Promise((ok, no) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => ok(r.result || null);
      r.onerror = () => no(r.error);
    });
  } catch (e) { return null; }      // private windows, blocked storage
}

async function cachePut(key, value) {
  try {
    const db = await idb();
    await new Promise((ok, no) => {
      const t = db.transaction(STORE, 'readwrite');
      t.objectStore(STORE).put(value, key);
      t.oncomplete = ok;
      t.onerror = () => no(t.error);
    });
  } catch (e) { /* caching is a convenience, never a requirement */ }
}

// Tell the files apart by their own headers rather than their names, so
// oddly named copies still work.
function sniff(buf) {
  const b = new Uint8Array(buf, 0, 4);
  const s = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (s === 'IWAD' || s === 'PWAD') return 'wad';
  if (s.startsWith('RTL') || s.startsWith('RTC') || s.startsWith('RTR')) return 'rtl';
  return null;
}

export function open(buffers) {
  let wad = null, rtl = null;
  for (const buf of buffers) {
    const kind = sniff(buf);
    if (kind === 'wad') wad = new Wad(buf);
    else if (kind === 'rtl') rtl = new Rtl(buf);
  }
  return {wad, rtl};
}

export async function fromFiles(files, onProgress = () => {}) {
  const bufs = [];
  for (const f of files) {
    onProgress(`reading ${f.name}`);
    bufs.push(await f.arrayBuffer());
    await cachePut(f.name.toUpperCase(), bufs[bufs.length - 1]);
  }
  return open(bufs);
}

// A URL is one file; call it once per file. Progress is reported in bytes
// when the server says how big the thing is.
export async function fromUrl(url, onProgress = () => {}) {
  const hit = await cacheGet(url);
  if (hit) { onProgress('from cache'); return hit; }
  const res = await fetch(url, {mode: 'cors'});
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body) {                     // no streams: take it in one go
    const buf = await res.arrayBuffer();
    await cachePut(url, buf);
    return buf;
  }
  const reader = res.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(total ? `${(got / 1e6).toFixed(1)} of ${(total / 1e6).toFixed(1)} MB`
                     : `${(got / 1e6).toFixed(1)} MB`);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  await cachePut(url, out.buffer);
  return out.buffer;
}

export async function cached(names) {
  const bufs = [];
  for (const n of names) {
    const b = await cacheGet(n);
    if (b) bufs.push(b);
  }
  return bufs.length ? open(bufs) : null;
}
