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
  await page.evaluate(async () => {
    help.hideAll();
    game.users = [{ isGM: true, active: true }];
    foundry.utils.randomID = () => 'test';
    globalThis.fragmentOpened = false;
    globalThis.ui = {
      notifications: {
        error: (message) => {
          throw new Error(message);
        },
      },
    };
    const { createManualDialogClass } = await import('/scripts/dialog.mjs');
    const Native = class {
      static get defaultOptions() {
        return { classes: [] };
      }
      constructor(actor, seed, options) {
        this.actor = actor;
        this.options = options;
        this._calculator = { ...seed, basicDamage: seed.damage, hitLocation: seed.hitlocation };
      }
      async getData() {
        return {};
      }
      activateListeners(html) {
        // Model an ancestor cancelling native disclosure default actions.
        html.addEventListener('click', (event) => event.preventDefault());
      }
      render() {
        this.element.innerHTML = '<div class="gga-app"></div>';
        this.activateListeners(this.element);
      }
    };
    const recipient = {
      name: 'Recipient',
      actor: { defaultHitLocation: 'Torso', hitLocationsWithDR: [{ where: 'Torso' }] },
      document: { texture: {} },
    };
    const session = {
      index: 0,
      recipients: [recipient],
      openFragmentation: async () => {
        fragmentOpened = true;
      },
    };
    const Manual = createManualDialogClass(Native);
    globalThis.manual = new Manual(session, recipient, {
      damage: 0,
      damageType: 'cr',
      armorDivisor: 1,
    });
    const host = document.querySelector('.window-content');
    host.innerHTML = '<div class="gga-app"></div>';
    manual.element = host;
    manual.activateListeners(host);
  });
  const attackToggle = page.locator('.manual-attack-options-toggle');
  assert.equal(await attackToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('[data-attack-area]').isVisible(), false);
  await attackToggle.click();
  assert.equal(await attackToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('[data-attack-area]').isVisible(), true);
  await attackToggle.focus();
  await page.keyboard.press('Enter');
  assert.equal(await attackToggle.getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Space');
  assert.equal(await attackToggle.getAttribute('aria-expanded'), 'true');
  await page.locator('[data-attack-area]').selectOption('large');
  assert.equal(await page.evaluate(() => manual._calculator.hitLocation), 'Large-Area');
  assert.equal(await attackToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('[data-attack-area]').isVisible(), true);
  await page.locator('[data-attack-area]').selectOption('explosion');
  assert.equal(await page.evaluate(() => manual._calculator.isExplosion), true);
  await page.locator('[data-attack-area]').selectOption('normal');
  assert.equal(await page.evaluate(() => manual._calculator.hitLocation), 'Torso');
  assert.equal(await page.evaluate(() => manual._calculator.isExplosion), false);
  await page.locator('[data-action="openFragmentation"]').click();
  assert.equal(await page.evaluate(() => fragmentOpened), true);
  assert.deepEqual(errors, []);
  console.log('PASS: plain ADD exposes attack options and fragmentation without initial damage');
  await page.evaluate(() => {
    const r = { ...manual.recipient, actor: { ...manual.actor, hitLocationsWithDR: [] } };
    manual = new manual.constructor(manual.session, r, {
      damage: 9,
      damageType: 'cr',
      armorDivisor: 1,
    });
    const host = document.querySelector('.window-content');
    host.innerHTML = '<div class="gga-app"></div>';
    manual.element = host;
    manual.activateListeners(host);
  });
  assert.equal(await page.locator('[data-manual-dr]').inputValue(), '');
  await page.locator('[data-manual-dr]').fill('4');
  await page.locator('[data-manual-dr]').blur();
  assert.equal(await page.evaluate(() => manual.manualDR), '4');
  assert.equal(await page.evaluate(() => manual.actor.hitLocationsWithDR.length), 0);
  await attackToggle.click();
  assert.equal(await page.locator('[data-attack-area]').isEnabled(), true);
  for (const mode of ['large', 'explosion', 'normal']) {
    await page.locator('[data-attack-area]').selectOption(mode);
    assert.equal(await page.locator('[data-attack-area]').inputValue(), mode);
    assert.equal(await page.evaluate(() => manual._calculator.isExplosion), mode === 'explosion');
    assert.equal(
      await page.evaluate(() => manual._calculator.hitLocation),
      mode === 'normal' ? 'User Entered' : 'Large-Area',
    );
    assert.equal(await page.locator('[data-manual-dr]').inputValue(), '4');
  }
  await page.locator('[data-attack-area]').selectOption('explosion');
  await page.screenshot({
    path: path.join(root, 'test-output/manual-area-review.png'),
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => manual.actor.hitLocationsWithDR.length), 0);
  console.log('PASS: no-location NPC can switch area modes and keep reviewed DR through rerenders');
  console.log(
    'PASS: incomplete NPC opens with blank explicit DR and leaves actor locations unchanged',
  );

  await page.evaluate(async () => {
    const { createFragmentationWorkbenchClass } =
      await import('/scripts/fragmentation-workbench.mjs');
    GURPS.SSRT = { getModifier: () => 0 };
    globalThis.Roll = {
      create: (formula) => {
        if (formula !== '3d6') throw new Error('Unresolved StringTerm');
        return { total: 14, evaluate: async () => {} };
      },
    };
    globalThis.canvas = {
      ready: true,
      scene: { id: 's', grid: { units: 'yards' } },
      grid: { measurePath: ([a, b]) => ({ euclidean: Math.abs(a.x - b.x) }) },
    };
    const recipients = ['One', 'Two', 'Three'].map((name, i) => ({
      key: name,
      name,
      document: { parent: { id: 's' } },
      token: { center: { x: i * 3, y: 0 } },
      actor: { hitLocationsWithDR: [{ where: 'Torso', roll: [14] }] },
    }));
    const Base = class {
      static get defaultOptions() {
        return {};
      }
      activateListeners() {}
    };
    const Fragmentation = createFragmentationWorkbenchClass(Base);
    globalThis.frag = new Fragmentation(recipients, {
      roller: async () => ({
        _getDiceData: () => ({}),
        _createDraggableSection: async () => ({ damage: 7 }),
      }),
      createMessage: async () => ({ id: 'frag' }),
    });
    const host = document.querySelector('.window-content');
    host.innerHTML = frag.markup();
    frag.element = host.querySelector('form');
    frag.activateListeners(frag.element);
  });
  await page.locator('[data-recipient="Three"] [data-frag-field="distance"]').fill('8');
  await page.locator('[data-recipient="One"] [data-frag-field="distance"]').fill('0');
  assert.equal(
    await page.locator('[data-recipient="Two"] [data-frag-field="distance"]').inputValue(),
    '3',
  );
  assert.equal(
    await page.locator('[data-recipient="Three"] [data-frag-field="distance"]').inputValue(),
    '8',
  );
  await page.locator('[data-action="resolveFragments"]').click();
  await page.waitForFunction(() => frag.events?.length === 3);
  assert.equal(await page.locator('.manual-workbench-error').textContent(), '');
  await page.locator('[data-recipient="Two"] [data-frag-field="distance"]').fill('9');
  assert.equal(await page.locator('.manual-discard-warning').isVisible(), true);
  assert.equal(
    await page.locator('[data-recipient="Two"] [data-frag-field="distance"]').inputValue(),
    '3',
  );
  await page.locator('[data-action="keepFragments"]').click();
  assert.equal(await page.evaluate(() => frag.events.length), 3);
  await page.locator('[data-action="resolveFragments"]').click();
  assert.equal(
    await page.locator('[data-action="discardFragments"]').textContent(),
    'Discard hits and roll again',
  );
  await page.locator('[data-action="discardFragments"]').click();
  await page.waitForFunction(() => frag.events?.length === 3 && !frag.busy);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: path.join(root, 'test-output/fragmentation-preview.png'),
    fullPage: true,
  });
  console.log(
    'PASS: multiple fragmentation recipients, explicit d6 rolls, automatic distances and manual overrides',
  );
  await page.locator('[data-action="close"]').click();
  assert.equal(await page.locator('.manual-discard-warning').isVisible(), true);
  assert.equal(await page.locator('[data-action="reviewFragments"]').isDisabled(), true);
  await page.locator('[data-action="keepFragments"]').click();
  assert.equal(await page.evaluate(() => frag.events.length), 3);
  assert.equal(await page.locator('[data-action="reviewFragments"]').isDisabled(), false);
  await page.locator('[data-action="resetDistances"]').click();
  assert.equal(
    await page.locator('[data-action="discardFragments"]').textContent(),
    'Discard hits and reset distances',
  );
  await page.locator('[data-action="discardFragments"]').click();
  assert.equal(await page.evaluate(() => frag.events), null);
  await page.locator('[data-recipient="Three"] [data-frag-field="distance"]').fill('0');
  assert.equal(await page.locator('[data-origin]').inputValue(), 'Three');
  assert.equal(
    await page.locator('[data-recipient="One"] [data-frag-field="distance"]').inputValue(),
    '6',
  );
  assert.deepEqual(errors, []);
  console.log('PASS: close warning preserves pending hits; confirmed reset allows a new centre');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
