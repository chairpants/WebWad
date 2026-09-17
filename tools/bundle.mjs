// Build dist/rott.html: the whole site as one file you can double-click.
//
//     node tools/bundle.mjs
//
// A page opened from file:// cannot load ES modules -- the browser refuses
// them as cross-origin -- so the hosted site and the local one are the same
// code with the modules inlined in dependency order. There is no minifier and
// no dependency: the point is that the output stays readable.

import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ORDER = ['js/wad.js', 'js/rtl.js', 'js/zip.js', 'js/load.js', 'js/main.js'];

// Modules here export plain declarations and import by name only, so
// inlining is a matter of dropping the import lines and the export keyword.
function inline(src, file) {
  const out = [];
  for (const line of src.split('\n')) {
    if (/^\s*import\s[^(]*from\s+'[^']+';\s*$/.test(line)) continue;
    if (/^\s*export\s+(async\s+function|function|class|const|let)\s/.test(line))
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
    else if (/^\s*export\s*\{/.test(line)) continue;
    else out.push(line);
  }
  return `// ---- ${file} ${'-'.repeat(Math.max(0, 66 - file.length))}\n` + out.join('\n');
}

const js = ORDER.map(f => inline(readFileSync(join(root, f), 'utf8'), f)).join('\n\n');
const html = readFileSync(join(root, 'index.html'), 'utf8')
  .replace('<script type="module" src="js/main.js"></script>',
           '<script>\n(function () {\n' + js + '\n})();\n</script>');

mkdirSync(join(root, 'dist'), {recursive: true});
const out = join(root, 'dist', 'rott.html');
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(1)} KB`);
