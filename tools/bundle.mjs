// Build rott.html: the whole site as one file you can double-click.
//
//     node tools/bundle.mjs
//
// A page opened from file:// cannot load ES modules -- the browser refuses
// them as cross-origin -- so the hosted site and the local one are the same
// code, with the modules wrapped up here instead.
//
// Each module keeps its own scope and hands back what it exports, the way it
// would as a module. Concatenating them instead looks simpler and is wrong:
// two modules may both have a DIM, and a bundle that merges their scopes
// breaks in a way that kills every button on the page at once. The parse
// check at the end is there because that failure is silent otherwise.

import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ORDER = ['js/wad.js', 'js/rtl.js', 'js/zip.js', 'js/level.js',
               'js/render.js', 'js/load.js', 'js/main.js'];

// `export function f`, `export class C`, `export const a = 1, b = 2`
function exportedNames(src) {
  const names = [];
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/gm))
    names.push(m[1]);
  // A declaration can name several things: `export const DIM = 128, TILE = 64`.
  // Taking only the first left it out of the module's exports, which made it
  // undefined at every use site -- and undefined arithmetic is NaN, not an
  // error, so the page built a whole level's geometry at NaN and drew nothing
  // where the missing name was used. Split the line's declarators instead.
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var)\s+(.*)$/gm)) {
    let depth = 0, start = 0;
    const line = m[1] + ',';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 0) {
        const id = line.slice(start, i).trim().match(/^[A-Za-z_$][\w$]*/);
        if (id) names.push(id[0]);
        start = i + 1;
      }
    }
  }
  return [...new Set(names)].filter(Boolean);
}

// What each module asks of the others, so a name that is used but never
// exported is caught here rather than becoming an undefined at runtime.
function importedNames(src) {
  const out = [];
  for (const m of src.matchAll(/^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';/gm))
    out.push([m[2].replace(/^\.\//, 'js/'),
              m[1].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)]);
  return out;
}

// `import {a, b} from './x.js';`, however many lines it takes.
function rewriteImports(src) {
  return src.replace(/^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';[ \t]*$/gm,
                     (_, names, from) => {
    const key = from.replace(/^\.\//, 'js/');
    return `const {${names.split(/\s*,\s*/).map(s => s.trim()).filter(Boolean).join(', ')}} = MODULES['${key}'];`;
  });
}

function wrap(file, src) {
  const names = exportedNames(src);
  const body = rewriteImports(src).replace(/^(\s*)export\s+/gm, '$1');
  return `// ---- ${file} ${'-'.repeat(Math.max(0, 62 - file.length))}\n` +
         `MODULES['${file}'] = (function () {\n${body}\n` +
         `return {${names.join(', ')}};\n})();`;
}

const SRC = new Map(ORDER.map(f => [f, readFileSync(join(root, f), 'utf8')]));
const EXPORTS = new Map([...SRC].map(([f, s]) => [f, new Set(exportedNames(s))]));
for (const [f, s] of SRC)
  for (const [from, names] of importedNames(s))
    for (const n of names)
      if (!EXPORTS.has(from) || !EXPORTS.get(from).has(n)) {
        console.error(`${f} imports ${n} from ${from}, which does not export it`);
        process.exit(1);
      }

const js = 'const MODULES = {};\n\n' +
           ORDER.map(f => wrap(f, SRC.get(f))).join('\n\n');

// Does it actually parse? new Function compiles without running.
try {
  new Function(js);
} catch (e) {
  console.error(`bundle would not parse: ${e.message}`);
  process.exit(1);
}

const html = readFileSync(join(root, 'index.html'), 'utf8')
  // three.js goes in whole: a file:// page can run a classic script but may
  // not fetch one from beside it.
  .replace('<script src="vendor/three.min.js"></script>',
           '<script>' + readFileSync(join(root, 'vendor/three.min.js'), 'utf8') + '</script>')
  // and the file:// warning in index.html is pointless in the file that works
  .replace(/<script>\n\/\/ A page opened with file:\/\/[\s\S]*?<\/script>\n/, '')
  .replace('<script type="module" src="js/main.js"></script>',
           '<script>\n(function () {\n' + js + '\n})();\n</script>');

const out = join(root, 'rott.html');
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(1)} KB`);
