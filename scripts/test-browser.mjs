import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const { chromium, firefox } = process.env.ROULETTE_PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.ROULETTE_PLAYWRIGHT_MODULE))
  : await import('playwright');
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const prefix = '/russian-roulette-revamped/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const asset = path.startsWith(prefix) ? path.slice(prefix.length) || 'index.html' : '';
  if (!asset || !asset.split('/').every(part => /^[\w.-]+$/.test(part) && part !== '..')) {
    response.writeHead(404).end();
    return;
  }
  try {
    const data = await readFile(resolve(dist, asset));
    response.writeHead(200, { 'Content-Type': mime[extname(asset)] ?? 'application/octet-stream' }).end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${prefix}`;
try {
  const engines = [
    ['Chromium', chromium, {
      executablePath: process.env.ROULETTE_CHROMIUM,
      args: process.env.ROULETTE_RENDERER === 'webgpu'
        ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ozone-platform=wayland']
        : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader-webgl'],
    }],
    ['Firefox', firefox, { firefoxUserPrefs: { 'webgl.force-enabled': true, 'dom.webgpu.enabled': false } }],
  ];
  for (const [name, engine, options] of engines) {
    if (process.env.ROULETTE_BROWSER && process.env.ROULETTE_BROWSER !== name) continue;
    const browser = await engine.launch({ headless: process.env.ROULETTE_HEADED !== '1', ...options });
    let page;
    const messages = [];
    try {
      page = await browser.newPage({ viewport: { width: 900, height: 660 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type()) && messages.length < 25) messages.push(message.text());
      });
      await page.route('**/*', (route) => route.request().url().startsWith(url) ? route.continue() : route.abort());
      if (process.env.ROULETTE_RENDERER !== 'webgpu') {
        await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true }));
      }
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        window.testRendererContexts = [];
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          const context = getContext.call(this, type, ...args);
          if (context && (type === 'webgpu' || type === 'webgl2')) window.testRendererContexts.push(type);
          return context;
        };
      });
      const wasm = page.waitForResponse((result) => result.url() === url + 'wasm/russian_roulette_wasm_bg.wasm');
      await page.goto(url);
      assert.equal((await wasm).status(), 200);
      const start = page.getByRole('button', { name: 'ENTER CHAMBER' });
      await start.waitFor();
      assert.ok(await start.isEnabled());
      if (process.env.ROULETTE_RENDERER === 'webgpu') {
        assert.ok(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter())),
          `${name} did not expose a WebGPU adapter in this environment`);
      } else {
        assert.ok(await page.evaluate(() => document.createElement('canvas').getContext('webgl2') !== null),
          `${name} did not expose WebGL 2 in this environment`);
      }
      const expected = await page.evaluate(async (base) => {
        const core = await import(base + 'wasm/russian_roulette_wasm.js');
        await core.default();
        const seed = Array.from({ length: 99 }, (_, i) => i + 1).find(candidate => {
          const round = core.create_round({ branch: 'REVAMPED', difficulty: 'NORMAL', seed: candidate });
          return !round.chambers[0].isLive;
        });
        const out = core.create_round({ branch: 'REVAMPED', difficulty: 'NORMAL', seed });
        const original = Crypto.prototype.getRandomValues;
        Crypto.prototype.getRandomValues = function (target) {
          if (target instanceof Uint32Array && target.length === 1) {
            target[0] = seed;
            return target;
          }
          return original.call(this, target);
        };
        return out.liveCount;
      }, url);
      await start.click();
      const self = page.getByText('SHOOT SELF', { exact: true });
      await self.waitFor({ timeout: 45_000, state: 'attached' });
      assert.equal(await page.locator('canvas').count(), 1);
      const count = page.getByText('CYLINDER', { exact: true }).locator('..');
      assert.match(await count.innerText(), /6/);
      const totals = count.locator('..');
      assert.match(await totals.innerText(), new RegExp('LIVE\\s+' + expected));
      await self.evaluate((element) => element.click());
      await page.waitForFunction(() =>
        [...document.querySelectorAll('span')].some(el => el.textContent === 'CYLINDER' && el.parentElement.textContent === 'CYLINDER5'),
        undefined, { timeout: 20_000 });
      await page.setViewportSize({ width: 820, height: 580 });
      if (process.env.ROULETTE_RENDERER === 'webgpu') {
        assert.ok(await page.evaluate(() => window.testRendererContexts.includes('webgpu')));
      }
      await page.reload();
      await start.waitFor();
      assert.deepEqual(errors, []);
      console.log(`${name} ${browser.version()} passed subpath, WASM, gameplay and reload checks`);
    } catch (error) {
      console.error(name, messages, await page?.locator('body').innerText().catch(() => ''));
      throw error;
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}
