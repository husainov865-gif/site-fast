// Read-only. Reports syntactic errors and candidates for manual review, never deletes CSS.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const args = process.argv.slice(2);
let postcss;
try { postcss = createRequire(path.resolve('package.json'))('postcss'); }
catch { console.error('Missing postcss. Run npm install in the project folder.'); process.exit(2); }
const target = args[0];
const outIndex = args.indexOf('--out');
if (!target || (outIndex >= 0 && !args[outIndex + 1]) || args.includes('--apply')) {
  console.error('Usage: node tools/css-audit.mjs <folder> [--out report.json]. No --apply mode.'); process.exit(2);
}
const errors = [], warnings = [], files = [];
const skipped = new Set(['node_modules', '.git', '.agents', 'reports']);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && !skipped.has(entry.name)) walk(file);
    else if (entry.isFile() && /\.(css|html?)$/i.test(file)) files.push(file);
  }
}
function inspect(css, source) {
  let root;
  try { root = postcss.parse(css, { from: source }); }
  catch (error) { errors.push({ source, line: error.line, reason: error.reason }); return; }
  root.walkRules(rule => {
    const seen = new Set();
    rule.each(node => {
      if (node.type !== 'decl') return;
      if (seen.has(node.prop)) warnings.push({ source, line: node.source?.start.line, selector: rule.selector, reason: `Repeated property ${node.prop}; may be an intentional fallback.` });
      seen.add(node.prop);
    });
  });
}
try {
  if (!fs.statSync(target).isDirectory()) throw new Error('Target must be a folder');
  walk(target);
  if (!files.length) throw new Error('No HTML or CSS files found');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\.css$/i.test(file)) inspect(text, file);
    else {
      let index = 0;
      for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) inspect(match[1], `${file}:style-${++index}`);
    }
  }
  const report = { audit: 'css', files: files.length, errors, warnings, limits: 'No unused-selector detection, cascade proof, visual or CSS feature support validation.' };
  if (outIndex >= 0) {
    const output = path.resolve(args[outIndex + 1]);
    if (fs.existsSync(output) && fs.statSync(output).isDirectory()) throw new Error('Output is a directory');
    if (files.some(file => path.resolve(file) === output)) throw new Error('Output must not overwrite a source file');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2)); process.exitCode = errors.length ? 1 : 0;
} catch (error) { console.error(error.message); process.exitCode = 2; }
