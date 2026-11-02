// No network, no installation, no overwrite. Run: node create-project.mjs <new-project>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolkit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];
const intoEmpty = process.argv.includes('--into-empty');
if (!arg || arg.startsWith('--')) {
  console.error('Usage: node scripts/create-project.mjs <project-folder> [--into-empty]');
  process.exit(2);
}
const destination = path.resolve(arg);
const relative = path.relative(toolkit, destination);
if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
  console.error('Choose a project outside the toolkit folder.'); process.exit(2);
}
if (fs.existsSync(destination)) {
  if (!intoEmpty || !fs.statSync(destination).isDirectory() || fs.readdirSync(destination).length !== 0) {
    console.error('Folder already exists. Nothing changed. Choose a NEW folder, or --into-empty for a completely empty folder.'); process.exit(2);
  }
}
try {
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(toolkit, 'assets/project-template'), destination, { recursive: true, errorOnExist: true, force: false });
  fs.mkdirSync(path.join(destination, 'tools'), { recursive: true });
  for (const file of ['site-audit.mjs', 'css-audit.mjs', 'check-env.mjs', 'check-materials.mjs', 'module-status.mjs', 'plan-route.mjs', 'check-design-inputs.mjs', 'deployment-check.mjs']) {
    fs.copyFileSync(path.join(toolkit, 'scripts', file), path.join(destination, 'tools', file), fs.constants.COPYFILE_EXCL);
  }
  const skill = path.join(destination, '.agents/skills/site-fast');
  fs.mkdirSync(skill, { recursive: true });
  for (const item of ['SKILL.md', 'VERSION', 'agents', 'references', 'assets']) {
    fs.cpSync(path.join(toolkit, item), path.join(skill, item), { recursive: true, force: false, errorOnExist: true });
  }
  const config = JSON.parse(fs.readFileSync(path.join(toolkit, 'package.json'), 'utf8'));
  config.name = 'my-site-project';
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  const lockPath = path.join(toolkit, 'package-lock.json');
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.name = config.name;
    if (lock.packages?.['']) lock.packages[''].name = config.name;
    fs.writeFileSync(path.join(destination, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(`Project created: ${destination}\nSkill: .agents/skills/site-fast\nNext: finish dependency checks, then request materials briefly using references/conversation.md.`);
} catch (error) {
  console.error(`Creation incomplete: ${error.message}. Inspect the destination; no automatic deletion was performed.`);
  process.exitCode = 2;
}
