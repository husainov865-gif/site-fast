import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function inside(root, file) {
  const rel = path.relative(root, file);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Path outside project');
  let current = root;
  for (const part of rel.split(path.sep)) { current = path.join(current, part); if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Update through symlink/junction is not supported'); }
  return file;
}
function files(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Source package has symlink');
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) out.push(...files(path.join(dir, entry.name), relative)); else if (entry.isFile()) out.push(relative);
  }
  return out;
}
try {
  if (!args[0]) throw new Error('Usage: update-project.mjs <project> [--agent codex|claude]');
  const project = fs.realpathSync(path.resolve(args[0]));
  const agentIndex = args.indexOf('--agent'), agent = agentIndex >= 0 ? args[agentIndex + 1] : null;
  if (agent && !['codex', 'claude'].includes(agent)) throw new Error('Invalid agent');
  const candidates = ['codex', 'claude'].map(name => {
    const parent=path.join(project,name==='codex'?'.agents':'.claude','skills');
    const modern=path.join(parent,'site-fast'),legacy=path.join(parent,'site-aidar');
    if(fs.existsSync(path.join(modern,'SKILL.md'))&&fs.existsSync(path.join(legacy,'SKILL.md'))) throw new Error('Both site-fast and legacy site-aidar found; resolve active installation first');
    return {name,base:fs.existsSync(path.join(modern,'SKILL.md'))?modern:legacy,modern};
  }).filter(item => (!agent || agent === item.name) && fs.existsSync(path.join(item.base, 'SKILL.md')));
  if (candidates.length !== 1) throw new Error('Find exactly one installed base, or choose --agent codex|claude');
  let base = inside(project, candidates[0].base);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8);
  const backup = inside(project, path.join(project, '.site-fast-backups/base-' + stamp));
  if(base!==candidates[0].modern){
    const registryFile=path.join(project,'PROJECT-MODULES.json');
    const registry=fs.existsSync(registryFile)?JSON.parse(fs.readFileSync(registryFile,'utf8')):null;
    const oldRelative=path.relative(project,base).split(path.sep).join('/');
    const modern=inside(project,candidates[0].modern),newRelative=path.relative(project,modern).split(path.sep).join('/');
    files(base);
    fs.mkdirSync(backup,{recursive:true});fs.cpSync(base,path.join(backup,'legacy-base'),{recursive:true});
    if(registry){fs.copyFileSync(registryFile,path.join(backup,'legacy-registry.json'));for(const value of Object.values(registry.modules||{})){if(value.path===oldRelative||value.path?.startsWith(oldRelative+'/'))value.path=newRelative+value.path.slice(oldRelative.length);}}
    fs.renameSync(inside(project,base),inside(project,modern));base=modern;
    if(registry)fs.writeFileSync(registryFile,JSON.stringify(registry,null,2)+'\n');
  }
  const targets = [];
  for (const item of ['SKILL.md', 'VERSION', 'agents', 'references', 'assets']) {
    const src = path.join(source, item);
    const list = fs.statSync(src).isDirectory() ? files(src).map(relative => path.join(item, relative)) : [item];
    for (const relative of list) targets.push({ src: path.join(source, relative), dest: inside(project, path.join(base, relative)), key: path.join('base', relative) });
  }
  for (const name of ['site-audit.mjs', 'css-audit.mjs', 'check-env.mjs', 'check-materials.mjs', 'module-status.mjs', 'plan-route.mjs', 'check-design-inputs.mjs', 'deployment-check.mjs']) targets.push({ src: path.join(source, 'scripts', name), dest: inside(project, path.join(project, 'tools', name)), key: path.join('tools', name) });
  // Back up every file that may be overwritten BEFORE changing any installed file.
  fs.mkdirSync(backup, { recursive: true });
  for (const item of targets) if (fs.existsSync(item.dest)) {
    const target = inside(project, path.join(backup, item.key)); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(item.dest, target);
  }
  fs.writeFileSync(path.join(backup, 'restore-map.json'), JSON.stringify(targets.map(item => ({ path: path.relative(project, item.dest), backup: fs.existsSync(item.dest) ? item.key : null })), null, 2));
  for (const item of targets) { fs.mkdirSync(path.dirname(item.dest), { recursive: true }); fs.copyFileSync(item.src, item.dest); }
  console.log(`Base updated. Backup and exact restore-map: ${backup}\nExisting modules/, registry, site, requirements, package.json and state were preserved. Run tools/check-env.mjs and tools/module-status.mjs.`);
} catch (error) { console.error(`${error.message}. If copying was interrupted, inspect .site-fast-backups/base-*/restore-map.json before retrying.`); process.exitCode = 2; }
