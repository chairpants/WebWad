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
  for (const m of src.matchAll(/^\s*export\s+(?:const|let|var)\s+([^=;]+?)\s*=/gm))
    for (const part of m[1].split(','))
      names.push(part.trim().split(/\s/)[0]);
  return [...new Set(names)].filter(Boolean);
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

const js = 'const MODULES = {};\n\n' +
           ORDER.map(f => wrap(f, readFileSync(join(root, f), 'utf8'))).join('\n\n');

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
