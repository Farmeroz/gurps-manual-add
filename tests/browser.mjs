import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(
      '<!doctype html><html><head><link rel="stylesheet" href="/styles/manual-add.css"></head><body style="font:15px/1.4 system-ui;background:#292b31;margin:16px"><main class="gurps-manual-add manual-damage-workbench" style="width:min(620px,100%);margin:auto"><section class="window-content"></section></main></body></html>',
    );
  }
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.GCS_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    globalThis.game = {
      user: { id: 'gm', name: 'GM', isGM: true },
      settings: { get: (_id, key) => (key === 'helpTooltips' ? globalThis.helpOn : 'public') },
    };
    globalThis.helpOn = true;
    globalThis.GURPS = {
      DamageTables: { woundModifiers: { cr: {}, cut: {}, imp: {}, burn: {} } },
      ModifierBucket: { modifierStack: { modifierList: [] } },
    };
    globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }) } };
    const { createWorkbenchClass } = await import('/scripts/workbench.mjs');
    const Workbench = createWorkbenchClass(
      class {
        static get defaultOptions() {
          return {};
        }
        activateListeners() {}
        async close() {
          this.closed = true;
        }
      },
    );
    globalThis.mount = (selected = true, attached = false) => {
      globalThis.rollCount = 0;
      globalThis.chatCount = 0;
      globalThis.queues = [];
      globalThis.returned = null;
      const recipients = selected
        ? ['One', 'Two'].map((name) => ({
            key: name,
            name,
            actor: { hitLocationsWithDR: [{ where: 'Torso' }] },
          }))
        : [];
      globalThis.app = new Workbench(
        { expression: '2d+1 cut' },
        {
          assertEnabled: () => {},
          returnTargetName: 'One',
          receiveRolls: attached
            ? async (_recipients, seeds) => {
                globalThis.returned = seeds;
              }
            : undefined,
          readRecipients: () => recipients,
          roller: async () => ({
            _getDiceData: () => ({}),
            _createDraggableSection: async (_actor, _dice, target) => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              return {
                target,
                damage: ++globalThis.rollCount + 6,
                roll: {},
                explainLineOne: 'Rolled (3,3) + 1 = 7.',
              };
            },
          }),
          createMessage: async () => ({ id: `chat-${++globalThis.chatCount}` }),
          startQueue: async (...args) => {
            globalThis.queues.push(args);
            return {
              completion: new Promise((resolve) => {
                globalThis.finishQueue = resolve;
              }),
            };
          },
        },
      );
      const host = document.querySelector('.window-content');
      host.innerHTML = app.markup();
      app.element = host.querySelector('form');
      app.activateListeners(app.element);
    };
    mount();
    globalThis.help = (await import('/scripts/help.mjs')).helpController;
    help.start();
  });
  assert.equal(await page.evaluate(() => rollCount), 0);
  await page.locator('[data-field="expression"]').fill('2d-1x3(2) imp');
  assert.equal(await page.locator('[data-field="modifier"]').inputValue(), '-1');
  assert.equal(await page.locator('[data-field="multiplier"]').inputValue(), '3');
  assert.equal(await page.locator('[data-field="damageType"]').inputValue(), 'imp');
  await page.locator('[data-field="distribution"]').selectOption('separate');
  await page.locator('[data-action="roll"]').click();
  await page.waitForFunction(() => app.batch?.messageId);
  assert.equal(await page.evaluate(() => rollCount), 2);
  assert.equal(await page.evaluate(() => queues.length), 0);
  await page.locator('[data-field="distribution"]').focus();
  await page.getByRole('tooltip').waitFor();
  assert.match(await page.getByRole('tooltip').textContent(), /independent roll/);
  await page.keyboard.press('Escape');
  await mkdir(path.join(root, 'test-output'), { recursive: true });
  await page.screenshot({
    path: path.join(root, 'test-output/roller-preview.png'),
    fullPage: true,
  });
  await page.locator('[data-action="review"]').click();
  await page.waitForFunction(() => queues.length === 1);
  assert.deepEqual(
    await page.evaluate(() => queues[0][2].map((s) => [s.damage, s.damageType, s.armorDivisor])),
    [
      [7, 'imp', 2],
      [8, 'imp', 2],
    ],
  );
  assert.equal(await page.locator('[data-action="review"]').isDisabled(), true);
  await page.evaluate(() => finishQueue(true));
  assert.equal(await page.locator('[data-action="review"]').isDisabled(), true);
  console.log(
    'PASS: real browser expression fields, separate rolls, explicit hand-off, and batch lock',
  );

  await page.evaluate(() => {
    mount(false);
    game.user.isGM = false;
  });
  await page.locator('[data-field="visibility"]').selectOption('blind');
  await page.locator('[data-action="roll"]').click();
  await page.waitForFunction(() => app.batch?.messageId);
  assert.match(await page.locator('.manual-roll-results').textContent(), /visible to the GM/);
  assert.doesNotMatch(
    await page.locator('.manual-roll-results').textContent(),
    /7 basic|Rolled \(/,
  );
  assert.equal(await page.locator('[data-action="review"]').isDisabled(), true);
  console.log('PASS: roll-only with no recipients and blind-player result privacy');

  await page.evaluate(() => {
    helpOn = false;
    help.hideAll();
  });
  await page.locator('[data-field="expression"]').focus();
  await page.waitForTimeout(550);
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await page.setViewportSize({ width: 440, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: optional keyboard tooltips, small-window layout, and no browser errors');
  await page.evaluate(() => {
    game.user.isGM = true;
    helpOn = true;
    mount(true, true);
  });
  await page.setViewportSize({ width: 1000, height: 1100 });
  assert.equal(await page.locator('[data-action="review"]').textContent(), 'Use rolled damage');
  assert.equal(await page.locator('[data-action="refreshRecipients"]').isVisible(), false);
  assert.equal(await page.locator('[data-field="hitlocation"]').isDisabled(), true);
  await page.locator('[data-action="roll"]').click();
  await page.waitForFunction(() => app.batch?.messageId);
  await page.locator('[data-action="review"]').focus();
  await page.getByRole('tooltip').waitFor();
  assert.match(await page.getByRole('tooltip').textContent(), /existing ADD/);
  await page.keyboard.press('Escape');
  await page.screenshot({
    path: path.join(root, 'test-output/optional-roller-preview.png'),
    fullPage: true,
  });
  await page.locator('[data-action="review"]').click();
  await page.waitForFunction(() => app.closed);
  assert.deepEqual(await page.evaluate(() => returned.map((s) => s.damage)), [7, 7]);
  assert.equal(await page.evaluate(() => queues.length), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: optional roller returns once to the existing ADD, closes, and opens no new queue',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
