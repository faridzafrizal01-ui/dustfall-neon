// Renders the four named frames (?shot=...) headless and saves screenshots/
// 1-play.jpg 2-plant.jpg 3-buy.jpg 4-start.jpg at 1280x800. Each frame is rendered
// twice by the page itself, then frozen, so the capture is deterministic.
// Usage: node shots.mjs [port] — assumes a server already serves game/ at that
// port (serve.ts). Prints console errors and any network request, then exits.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const port = process.argv[2] ?? '8080';
const base = `http://localhost:${port}/index.html`;
const shots = [
  ['play', '1-play.jpg'],
  ['plant', '2-plant.jpg'],
  ['buy', '3-buy.jpg'],
  ['start', '4-start.jpg'],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!url.startsWith(`http://localhost:${port}`) && !url.startsWith(`http://127.0.0.1:${port}`)) {
        problems.push(`network request: ${url}`);
      }
    }
  });
  mkdirSync('screenshots', { recursive: true });
  for (const [shot, name] of shots) {
    await page.goto(`${base}?shot=${shot}&seed=7`, { waitUntil: 'load' });
    await page.waitForFunction('window.__shotReady === true', null, { timeout: 20000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join('screenshots', name), type: 'jpeg', quality: 88 });
    const consoleCount = problems.length;
    console.log(`${name}: shot=${shot} — console problems so far: ${consoleCount}`);
  }
  if (problems.length > 0) {
    console.log('PROBLEMS:');
    for (const p of problems) console.log('  ' + p);
    process.exitCode = 1;
  } else {
    console.log('OK: 0 console errors, 0 network requests');
  }
} finally {
  await browser.close();
}
