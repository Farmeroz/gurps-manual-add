import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createWorkbenchClass } from '../scripts/workbench.mjs';
import { helpConfig } from '../scripts/help.mjs';

const types = { cr: {}, cut: {}, imp: {}, burn: {} };
globalThis.GURPS = {
  DamageTables: { woundModifiers: types },
  ModifierBucket: { modifierStack: { modifierList: [] } },
};
globalThis.game = { user: { id: 'gm', name: 'GM', isGM: true }, settings: { get: () => 'public' } };
globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }) } };
const Base = class {
  static get defaultOptions() {
    return {};
  }
  activateListeners() {}
  async close() {
    this.closed = true;
  }
};
const Workbench = createWorkbenchClass(Base);
const recipients = [
  { key: 'one', name: 'One', actor: { hitLocationsWithDR: [{ where: 'Torso' }] } },
  { key: 'two', name: 'Two', actor: { hitLocationsWithDR: [{ where: 'Torso' }] } },
];

function setup(options = { expression: '2d+1 cut' }, selected = recipients) {
  const { document, window } = parseHTML('<html><body></body></html>');
  // linkedom exposes select.value as getter-only; browsers implement both.
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() {
      return (
        [...this.options].find((o) => o.hasAttribute('selected'))?.value ??
        this.options[0]?.value ??
        ''
      );
    },
    set(value) {
      for (const option of this.options) {
        if (option.value === value) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      }
    },
  });
  globalThis.document = document;
  game.user.isGM = true;
  let rolls = 0,
    writes = 0,
    opened = [],
    finish;
  const services = {
    readRecipients: () => selected,
    assertEnabled: () => {},
    roller: async () => ({
      _getDiceData: () => ({}),
      _createDraggableSection: async () => ({
        damage: ++rolls + 5,
        target: 'Shared roll',
        roll: {},
        explainLineOne: 'Rolled (2,3) + 1 = 6.',
      }),
    }),
    createMessage: async () => {
      writes++;
      return { id: `chat-${writes}` };
    },
    startQueue: async (...args) => {
      opened.push(args);
      return {
        completion: new Promise((resolve) => {
          finish = resolve;
        }),
      };
    },
  };
  const app = new Workbench(options, services);
  document.body.innerHTML = app.markup();
  app.element = document.querySelector('form');
  app.activateListeners(app.element);
  return {
    app,
    services,
    document,
    window,
    count: () => ({ rolls, writes, opened }),
    finish: () => finish?.(true),
  };
}

test('opening a dice expression is inert and keeps its type/divisor in the roll', async () => {
  const f = setup({ expression: '2d(2)', damageType: 'imp' });
  assert.deepEqual(f.count(), { rolls: 0, writes: 0, opened: [] });
  assert.equal(f.app.draft.expression, '2d(2) imp');
  assert.equal(f.app.element.querySelector('[data-action="review"]').disabled, true);
  await f.app.rollDamage();
  assert.equal(f.app.batch.spec.damageType, 'imp');
  assert.equal(f.app.batch.spec.armorDivisor, 2);
  assert.equal(f.count().opened.length, 0);
});

test('roll-only works with no recipients; shared result can later use a selection', async () => {
  const f = setup({ expression: '1d cr' }, []);
  await f.app.rollDamage();
  assert.equal(f.count().rolls, 1);
  assert.equal(f.app.element.querySelector('[data-action="review"]').disabled, true);
  f.app.services.readRecipients = () => recipients;
  f.app.refreshRecipients();
  await f.app.review();
  assert.deepEqual(
    f.count().opened[0][2].map((s) => s.damage),
    [6, 6],
  );
});

test('simultaneous clicks roll once and open one queue; batch stays consumed after completion', async () => {
  const f = setup();
  await Promise.all([f.app.rollDamage(), f.app.rollDamage()]);
  assert.equal(f.count().rolls, 1);
  await Promise.all([f.app.review(), f.app.review()]);
  assert.equal(f.count().opened.length, 1);
  f.finish();
  await Promise.resolve();
  assert.equal(await f.app.review(), false);
  assert.equal(f.app.batch.used, true);
  await f.app.rollDamage();
  assert.equal(f.count().rolls, 2, 'explicit Roll again creates a fresh event');
});

test('failed queue opening does not consume the recorded batch', async () => {
  const f = setup();
  await f.app.rollDamage();
  f.app.services.startQueue = async () => {
    throw new Error('Permission changed');
  };
  assert.equal(await f.app.review(), false);
  assert.equal(f.app.batch.used, false);
  assert.equal(f.app.handedOff, false);
  assert.match(f.app.error, /Permission/);
});

test('separate selection refresh invalidates rolls, while fixed review rolls nothing', async () => {
  const f = setup({ expression: '1d cut', distribution: 'separate' });
  await f.app.rollDamage();
  assert.equal(f.count().rolls, 2);
  f.app.refreshRecipients();
  assert.equal(f.app.batch, null);
  const fixed = setup({ damage: 12, damageType: 'cut' });
  await fixed.app.review();
  assert.equal(fixed.count().rolls, 0);
  assert.equal(fixed.count().writes, 0);
  assert.equal(fixed.count().opened[0][1].damage, 12);
});

test('field edits invalidate a prior roll and update the expression without dropping invalid input', async () => {
  const f = setup();
  await f.app.rollDamage();
  const modifier = f.app.element.querySelector('[data-field="modifier"]');
  modifier.value = '-2';
  modifier.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.equal(f.app.draft.expression, '2d-2 cut');
  assert.equal(f.app.batch, null);
  modifier.value = '';
  modifier.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.match(f.app.parseError, /whole numbers/);
  assert.equal(await f.app.rollDamage(), false);
  assert.equal(f.count().rolls, 1);
});

test('malformed expressions cannot fall back to stale interpreted fields', async () => {
  const f = setup({ expression: '2d/3 cut' });
  assert.equal(await f.app.rollDamage(), false);
  assert.match(f.app.error, /complete damage expression/);
  assert.equal(f.count().rolls, 0);
});

test('chat failure offers retry with identical dice and blocks application meanwhile', async () => {
  const f = setup();
  f.app.services.createMessage = async () => {
    throw new Error('Chat unavailable');
  };
  assert.equal(await f.app.rollDamage(), false);
  assert.match(f.app.element.querySelector('[data-action="roll"]').textContent, /Retry/);
  assert.equal(await f.app.review(), false);
  f.app.services.createMessage = async () => ({ id: 'recovered' });
  await f.app.rollDamage();
  assert.equal(f.count().rolls, 1);
});

test('blind player UI contains no rolled total and cannot review locally', async () => {
  const f = setup();
  game.user.isGM = false;
  f.app.draft.visibility = 'blind';
  await f.app.rollDamage();
  assert.doesNotMatch(
    f.app.element.querySelector('.manual-roll-results').textContent,
    /6|Rolled \(/,
  );
  assert.match(
    f.app.element.querySelector('.manual-roll-results').textContent,
    /visible to the GM/,
  );
  assert.equal(await f.app.review(), false);
  assert.equal(f.count().opened.length, 0);
});

test('all new controls have explicit help and the HTML form is attached intact', () => {
  const f = setup();
  for (const node of f.app.element.querySelectorAll('[data-field]'))
    assert.ok(helpConfig.fields[node.dataset.field], node.dataset.field);
  for (const node of f.app.element.querySelectorAll('[data-action]'))
    assert.ok(helpConfig.actions[node.dataset.action], node.dataset.action);
  assert.match(f.app.element.querySelector('.manual-recipient-names').textContent, /One, Two/);
});
