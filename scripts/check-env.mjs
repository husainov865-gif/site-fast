import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('package.json'));
let failed = false;
function log(ok, text) { console.log(`${ok ? 'OK' : 'FAIL'} ${text}`); if (!ok) failed = true; }
log(Number(process.versions.node.split('.')[0]) >= 22, `Node ${process.versions.node} (required >=22)`);
for (const name of ['postcss', 'playwright']) {
  try { require.resolve(name); log(true, name); } catch { log(false, `${name}: run npm install in the project folder`); }
}
try {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  await browser.close(); log(true, 'Chromium launch');
} catch (error) { log(false, `Chromium: ${error.message.split('\n')[0]}; run npx playwright install chromium`); }
process.exitCode = failed ? 2 : 0;
