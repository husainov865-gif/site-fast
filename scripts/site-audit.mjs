// Local HTML opens via file://: checks the actual double-click workflow. Remote target checks ONE URL.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const args = process.argv.slice(2), target = args[0];
const outIndex = args.indexOf('--out');
if (!target || (outIndex >= 0 && !args[outIndex + 1])) {
  console.error('Usage: node tools/site-audit.mjs <folder|HTML-file|http(s)-URL> [--out report-folder]'); process.exit(2);
}
let chromium;
try { ({ chromium } = createRequire(path.resolve('package.json'))('playwright')); }
catch { console.error('Missing playwright. Run npm install in the project folder.'); process.exit(2); }
const sizes = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 430, height: 900 }, { width: 768, height: 1024 }, { width: 1280, height: 690 }, { width: 1440, height: 900 }];
const output = path.resolve(outIndex >= 0 ? args[outIndex + 1] : 'reports/site-audit');
const pages = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['node_modules', '.git', '.agents', 'reports'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.html?$/i.test(file)) pages.push(pathToFileURL(file).href);
  }
}
let browser;
try {
  if (/^https?:\/\//i.test(target)) pages.push(new URL(target).href);
  else if (fs.statSync(target).isDirectory()) walk(path.resolve(target));
  else if (/\.html?$/i.test(target)) pages.push(pathToFileURL(path.resolve(target)).href);
  if (!pages.length) throw new Error('No HTML pages found');
  fs.mkdirSync(output, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const results = [];
  for (const [pageIndex, url] of pages.entries()) {
    for (const size of sizes) {
      const context = await browser.newContext({ viewport: size, isMobile: size.width < 700, hasTouch: size.width < 700, deviceScaleFactor: 1 });
      const page = await context.newPage(), errors = [], warnings = [];
      page.on('pageerror', error => errors.push({ kind: 'javascript', message: error.message }));
      page.on('requestfailed', request => errors.push({ kind: 'resource', url: request.url(), message: request.failure()?.errorText }));
      page.on('response', response => { if (response.status() >= 400) errors.push({ kind: 'http', url: response.url(), status: response.status() }); });
      let screenshot = null;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        await page.evaluate(async () => { await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3000))]); });
        // Bound lazy-loading scan to avoid unending feeds. The limit is reported.
        const scan = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, step: innerHeight - 80 }));
        const limit = Math.min(scan.height, 20000);
        for (let y = 0; y < limit; y += scan.step) { await page.evaluate(y => scrollTo(0, y), y); await page.waitForTimeout(80); }
        if (scan.height > limit) warnings.push({ kind: 'scan-limit', message: 'Lazy-load scan limited to 20000px. Inspect the rest manually.' });
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(200);
        const dom = await page.evaluate(() => {
          const visible = element => { const r = element.getBoundingClientRect(), s = getComputedStyle(element); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
          return {
            overflow: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - innerWidth,
            title: document.title.trim(), viewport: !!document.querySelector('meta[name="viewport"]'),
            h1: [...document.querySelectorAll('h1')].filter(visible).length,
            brokenImages: [...document.images].filter(image => visible(image) && (!image.complete || image.naturalWidth === 0)).map(image => image.currentSrc || image.src),
            smallControls: [...document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea')].filter(visible).filter(element => { const r = element.getBoundingClientRect(); return r.width < 36 || r.height < 36; }).slice(0, 20).map(element => ({ tag: element.tagName, text: (element.textContent || element.getAttribute('aria-label') || element.getAttribute('name') || '').trim().slice(0, 70) }))
          };
        });
        if (dom.overflow > 1) errors.push({ kind: 'overflow', pixels: dom.overflow });
        if (!dom.title) errors.push({ kind: 'title', message: 'Empty title' });
        if (!dom.viewport) errors.push({ kind: 'viewport', message: 'Missing meta viewport' });
        if (dom.h1 !== 1) warnings.push({ kind: 'h1', count: dom.h1 });
        dom.brokenImages.forEach(url => errors.push({ kind: 'image', url }));
        if (size.width < 700 && dom.smallControls.length) warnings.push({ kind: 'small-controls', controls: dom.smallControls });
        screenshot = `page-${pageIndex + 1}-${size.width}x${size.height}.png`;
        await page.screenshot({ path: path.join(output, screenshot), fullPage: true, timeout: 30000 });
      } catch (error) { errors.push({ kind: 'page', message: error.message }); }
      results.push({ url, viewport: size, screenshot, errors, warnings });
      await context.close();
    }
  }
  const report = { audit: 'site', timestamp: new Date().toISOString(), pages: pages.length, errors: results.reduce((sum, result) => sum + result.errors.length, 0), warnings: results.reduce((sum, result) => sum + result.warnings.length, 0), limits: 'Only initial page states. No automatic clicks, form submissions, visual judgement, contrast proof, link crawling or mailbox delivery check. Remote target is ONE URL; run for each page.', results };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Pages: ${report.pages}; errors: ${report.errors}; warnings: ${report.warnings}; report: ${path.join(output, 'report.json')}`);
  process.exitCode = report.errors ? 1 : 0;
} catch (error) { console.error(error.message); process.exitCode = 2; }
finally { if (browser) await browser.close(); }
