# ROTT web

Rise of the Triad in a browser, reading the player's own game files at run
time. Pick `HUNTBGIN.WAD` and `HUNTBGIN.RTL` from disk, or give a link to
them; nothing about a level is baked into this site.

    python -m http.server 8000      # any static server will do
    node test/decode.test.mjs       # hold the decoders to the reference
    node tools/bundle.mjs           # dist/rott.html: one file, opens from disk

## Opened from a file, not a server

A page opened with file:// cannot load ES modules: the browser calls them
cross-origin and refuses. IndexedDB is worse than refused there -- it never
answers at all -- so the cache is raced against a timer and skipped when it
does not come back.

`node tools/bundle.mjs` writes `dist/rott.html`, the same code with the
modules inlined, which does run from a file. Picking files works; fetching a
URL works where the host allows it (archive.org does); the browser cache
does not, so each run reads the files again.

## Why it is built this way

The predecessor (`../ROTT`) decodes the game files with Python and writes one
14 MB HTML file per level, with the art base64'd into each. That is fine
locally and hopeless to host: ten levels come to ~144 MB of mostly duplicated
art, and every visit pays for a whole copy.

Here the site is a few hundred KB of code. The game files arrive once, from
the player or from a link, and are kept in the browser afterwards. Decoding
them is not the expensive part -- the whole WAD, all 1393 shapes, decodes in
about 45 ms -- so load time is download time and nothing else.

## What lives where

    js/wad.js    lump directory, palette, the column-major masked shapes
    js/rtl.js    level files: RLEW expansion, the three 128x128 planes
    js/load.js   file picker, URL fetch, IndexedDB cache
    js/main.js   the front page
    tools/       reference generator, run against ../ROTT
    test/        Node test holding the JS decoders to that reference

## The other project is the authority

`../ROTT` stays exactly as it is, and stays the place where ROTT's own
behaviour is written down: what a tile means, what a guard does, which frame
belongs to which state -- each transcribed from the GPL source with the
citation beside it, and checked by its selftests.

This project does not re-derive any of that. `tools/make_reference.py`
imports that project read-only and writes down what a correct decode looks
like (sizes and checksums, never the art itself); `test/decode.test.mjs`
holds the JS to it. The behaviour tables come across the same way, as data.

No game data is committed here. `.gitignore` keeps it that way.
