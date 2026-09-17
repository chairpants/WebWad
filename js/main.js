// The front page: get the files in, say what is in them, and let a level be
// picked. Nothing about the game is hardcoded here -- the level list is
// whatever the level file says it holds.

import {fromFiles, fromUrl, open, cached} from './load.js';

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

function play(m) {
  // The engine goes here next: build the level from the planes and hand it to
  // the renderer. For now, prove the level really decodes from the file.
  const planes = held.rtl.planes(m);
  if (!planes[0]) { say(`${m.name}: level data would not expand`, true); return; }
  const walls = new Set(), things = new Set();
  planes[0].forEach(v => v && walls.add(v));
  planes[1].forEach(v => v && things.add(v));
  say(`${m.name}: ${planes[0].length} tiles, ${walls.size} wall kinds, ${things.size} thing kinds`);
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
