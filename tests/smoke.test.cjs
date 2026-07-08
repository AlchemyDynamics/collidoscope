const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function staticServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const filePath = path.resolve(root, `.${requested}`);
    const relativePath = path.relative(root, filePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/index.html` });
    });
  });
}

test('loads, starts, and records one collision without browser errors', async t => {
  const { server, url } = await staticServer();
  t.after(() => server.close());

  const browser = await chromium.launch();
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(url, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Start Collidoscope' }).click();
  await page.locator('#modal-help [data-close]').click();
  await page.getByRole('button', { name: 'Fire the proton beams' }).click();

  await page.waitForFunction(
    () => document.querySelector('#hud-status')?.textContent?.includes('EVENT RECORDED'),
    null,
    { timeout: 8000 }
  );

  const report = await page.locator('#event-report').innerText();
  const canvasBox = await page.locator('#scene3d').boundingBox();
  const fallbackVisible = await page.locator('.webgl-fallback').isVisible().catch(() => false);

  assert.match(report, /Collision #1/);
  assert.match(report, /particles detected/);
  assert.ok(canvasBox.width > 300, `expected canvas width > 300, got ${canvasBox.width}`);
  assert.ok(canvasBox.height > 300, `expected canvas height > 300, got ${canvasBox.height}`);
  assert.equal(fallbackVisible, false, 'WebGL fallback should not appear in the smoke test browser');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
});
