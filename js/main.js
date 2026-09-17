// The front page: get the files in, say what is in them, and let a level be
// picked. Nothing about the game is hardcoded here -- the level list is
// whatever the level file says it holds.

import {fromFiles, fromUrl, open, cached, companions} from './load.js';
import {Level} from './render.js';

const $ = (id) => document.getElementById(id);
const status = $('status');
const say = (msg, bad = false) => { status.textContent = msg; status.classList.toggle('bad', bad); };

const held = {wad: null, rtl: null, buffers: []};

function describe() {
  const bits = [];
  if (held.wad) bits.push(`${held.wad.lumps.length} lumps`);
  if (held.rtl) bits.push(`${held.rtl.used().length} levels`);
  if (!bits.length) return;
  say(bits.join(', ') + (held.wad && held.rtl ? '' : ' -- still need the ' + (held.wad ? 'levels (.RTL)' : 'art (.WAD)')));
  listLevels();
}

function listLevels() {
  const box = $('levels');
  box.textContent = '';
  if (!held.rtl) return;
  const ol = document.createElement('ol');
  for (const m of held.rtl.used()) {
    const li = document.createElement('li');
    li.textContent = m.name;
    const b = document.createElement('button');
    b.textContent = 'play';
    b.disabled = !held.wad;
    b.onclick = () => play(m);
    li.append(b);
    ol.append(li);
  }
  box.append(ol);
}

let level = null;

// three.js is vendored and loaded by an ordinary script tag: a module would
// be refused from file://, and a CDN would put someone else's uptime between
// a player and their own game files.
function getThree() {
  if (!window.THREE) throw new Error('three.js did not load (vendor/three.min.js)');
  return window.THREE;
}

async function play(m) {
  const planes = held.rtl.planes(m);
  if (!planes[0]) { say(`${m.name}: level data would not expand`, true); return; }
  try {
    say(`${m.name}: building...`);
    const THREE = getThree();
    const view = document.getElementById('view');
    const canvas = document.getElementById('canvas');
    view.hidden = false;
    document.getElementById('front').hidden = true;
    const t0 = performance.now();
    level = new Level(THREE, canvas, held.wad, planes);
    window.level = level;             // a handle to poke at from the console
    document.getElementById('levelname').textContent = m.name;
    say(`${m.name}: built in ${Math.round(performance.now() - t0)} ms`);
    run();
  } catch (err) {
    say(`${m.name}: ${err.message || err}`, true);
    throw err;
  }
}

let last = 0;
function run() {
  const canvas = document.getElementById('canvas');
  const loop = (t) => {
    if (!level) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    level.step(dt);
    document.getElementById('pos').textContent = level.where();
    requestAnimationFrame(loop);
  };
  addEventListener('resize', () => level && level.resize(canvas));
  canvas.onclick = () => canvas.requestPointerLock();
  addEventListener('mousemove', (e) => {
    if (!level || document.pointerLockElement !== canvas) return;
    level.yaw -= e.movementX * 0.0022;
    level.pitch = Math.max(-1.5, Math.min(1.5, level.pitch - e.movementY * 0.0022));
  });
  addEventListener('keydown', (e) => {
    if (!level) return;
    if (e.code === 'Escape') { leave(); return; }
    if (e.code === 'KeyE' || e.code === 'Space') {
      const msg = level.use();
      document.getElementById('pos').textContent = msg || level.where();
      return;
    }
    level.keys[e.code] = true;
  });
  addEventListener('keyup', (e) => level && (level.keys[e.code] = false));
  requestAnimationFrame((t) => { last = t; loop(t); });
}

function leave() {
  level = null;
  document.exitPointerLock && document.exitPointerLock();
  document.getElementById('view').hidden = true;
  document.getElementById('front').hidden = false;
}

function took(t0) { return `${Math.round(performance.now() - t0)} ms`; }

$('pick').addEventListener('change', async (e) => {
  const t0 = performance.now();
  try {
    say('reading...');
    const got = await fromFiles(e.target.files, say);
    if (got.wad) held.wad = got.wad;
    if (got.rtl) held.rtl = got.rtl;
    describe();
    say(status.textContent + `  (${took(t0)})`);
  } catch (err) { say(String(err.message || err), true); }
});

$('get').addEventListener('click', async () => {
  const url = $('url').value.trim();
  if (!url) return;
  const t0 = performance.now();
  try {
    say('fetching...');
    const buf = await fromUrl(url, (p) => say('fetching ' + p));
    const got = await open([buf]);
    if (got.wad) held.wad = got.wad;
    if (got.rtl) held.rtl = got.rtl;
    if (!got.wad && !got.rtl) { say('that file is neither a WAD nor a level file', true); return; }
    // One URL brings one file. Its companion sits beside it under the same
    // name, so go and get that too rather than making it a second errand.
    const missing = held.wad && !held.rtl ? 'wad' : (!held.wad && held.rtl ? 'rtl' : null);
    if (missing) {
      for (const alt of companions(url, missing)) {
        try {
          say('fetching the other file...');
          const more = await open([await fromUrl(alt, (p) => say('fetching ' + p))]);
          if (more.wad) held.wad = more.wad;
          if (more.rtl) held.rtl = more.rtl;
          if (more.wad || more.rtl) break;
        } catch (e) { /* try the next spelling */ }
      }
    }
    describe();
    say(status.textContent + `  (${took(t0)})`);
  } catch (err) {
    say(`could not load: ${err.message || err}. If the host does not allow ` +
        `cross-origin reads, download the file and pick it above.`, true);
  }
});

// Whatever was loaded last time is already here.
cached(['HUNTBGIN.WAD', 'HUNTBGIN.RTL']).then((got) => {
  if (!got) return;
  held.wad = got.wad || held.wad;
  held.rtl = got.rtl || held.rtl;
  describe();
});
