import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { areaEvents, explosionDivisor } from '../scripts/area.mjs';
import { createAreaWorkbenchClass } from '../scripts/area-workbench.mjs';
const types = { cr: {}, cut: {}, burn: {} };
globalThis.game = { user: { id: 'gm', name: 'GM', isGM: true }, settings: { get: () => 'public' } };
globalThis.GURPS = { DamageTables: { woundModifiers: types } };
globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }) } };
const recipients = ['A', 'B'].map((key) => ({
  key,
  name: key,
  token: {},
  document: {},
  actor: {},
}));
const rows = {
  A: { include: true, distance: '1', directHit: false },
  B: { include: true, distance: '3', directHit: false },
};
const seed = { damage: 30, damageType: 'cr', armorDivisor: 10 };
const Area = createAreaWorkbenchClass(
  class {
    // Foundry Application owns a getter-only HTML template property.
    get template() {
      return 'foundry-application-template';
    }
    static get defaultOptions() {
      return {};
    }
    activateListeners() {}
    render() {
      return this;
    }
    async close() {
      this.closed = true;
    }
  },
);
function make(options = {}) {
  let rolls = 0,
    messages = 0,
    queues = 0;
  const app = new Area(
    recipients,
    {
      readRecipients: () => recipients,
      roller: async () => ({
        _getDiceData: () => ({}),
        _createDraggableSection: async () => ({ damage: ++rolls === 1 ? 30 : 18, roll: {} }),
      }),
      createMessage: async () => ({ id: String(++messages) }),
      startEvents: async () => {
        queues++;
        return { completion: new Promise(() => {}) };
      },
    },
    options,
  );
  const { document, window } = parseHTML(`<main>${app.markup()}</main>`);
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
  app.element = document.querySelector('main');
  app.activateListeners(app.element);
  return {
    app,
    get rolls() {
      return rolls;
    },
    get messages() {
      return messages;
    },
    get queues() {
      return queues;
    },
  };
}
test('uniform and cone share full damage regardless of distance; exclusion and zero are explicit', () => {
  for (const mode of ['uniform', 'cone']) {
    const events = areaEvents(recipients, rows, seed, mode, types);
    assert.deepEqual(
      events.map((e) => e.effective),
      [30, 30],
    );
    assert.ok(events.every((e) => !e.seed.isExplosion && e.seed.hitlocation === 'Large-Area'));
  }
  assert.equal(
    areaEvents(recipients, { ...rows, B: { include: false } }, seed, 'uniform', types).length,
    1,
  );
  assert.equal(
    areaEvents(recipients, rows, { ...seed, damage: 0 }, 'uniform', types)[0].effective,
    0,
  );
});
test('blast falloff, radius, direct hit, and collateral divisor are distinct', () => {
  const events = areaEvents(recipients, rows, seed, 'explosion', types, 2);
  assert.equal(events[0].effective, 10);
  assert.equal(events[0].seed.armorDivisor, 1);
  assert.equal(events[1].inRange, false);
  const direct = areaEvents(
    recipients,
    { ...rows, A: { include: true, distance: '', directHit: true } },
    seed,
    'explosion',
    types,
    2,
  )[0];
  assert.equal(direct.effective, 30);
  assert.equal(direct.seed.armorDivisor, 10);
  assert.equal(direct.seed.isExplosion, false);
  assert.equal(explosionDivisor(0), 3);
  assert.equal(explosionDivisor(0.5), 3);
  assert.equal(explosionDivisor(2.5), 7.5);
  assert.throws(() => explosionDivisor(''));
  assert.throws(() => explosionDivisor(-1));
});
test('uniform UI hides distance and direct-hit fields and sends identical fixed seeds only on review', async () => {
  const state = make();
  const { app } = state;
  app.draft.damage = '17';
  app.refresh();
  assert.ok([...app.element.querySelectorAll('[data-blast]')].every((n) => n.hidden));
  assert.equal(await app.prepare(), true);
  assert.equal(state.rolls, 0);
  assert.equal(state.queues, 0);
  assert.deepEqual(
    app.events.map((e) => e.seed.damage),
    [17, 17],
  );
  assert.equal(await app.review(), true);
  assert.equal(await app.review(), false);
  assert.equal(state.queues, 1);
});
test('uniform dice rolls once; explosion defaults to separate rolls and derives B414 radius', async () => {
  const a = make();
  a.app.draft.input = 'dice';
  a.app.draft.expression = '3d cr';
  assert.equal(await a.app.prepare(), true);
  assert.equal(a.rolls, 1);
  assert.deepEqual(
    a.app.events.map((e) => e.effective),
    [30, 30],
  );
  const b = make({ mode: 'explosion' });
  b.app.draft.input = 'dice';
  b.app.draft.expression = '3d cr';
  b.app.rows.A.distance = '1';
  b.app.rows.B.distance = '3';
  assert.equal(await b.app.prepare(), true);
  assert.equal(b.rolls, 2);
  assert.deepEqual(
    b.app.events.map((e) => e.effective),
    [10, 2],
  );
});
test('chat failure and ADD opening failure preserve results for retry without rerolling', async () => {
  const state = make();
  const { app } = state;
  app.draft.input = 'dice';
  let calls = 0;
  app.services.createMessage = async () => (++calls === 1 ? null : { id: 'chat' });
  assert.equal(await app.prepare(), false);
  assert.equal(state.rolls, 1);
  assert.equal(await app.prepare(), true);
  assert.equal(state.rolls, 1);
  app.services.startEvents = async () => {
    throw new Error('Render failed');
  };
  assert.equal(await app.review(), false);
  assert.equal(app.handedOff, false);
  assert.equal(app.prepared, true);
});
test('close and reset require explicit discard; keeping results preserves the batch', async () => {
  const { app } = make();
  app.draft.damage = '10';
  await app.prepare();
  await app.close();
  assert.equal(app.closed, undefined);
  assert.equal(app.pendingDiscard, 'close');
  app.element.querySelector('[data-action="keep"]').click();
  assert.equal(app.pendingDiscard, null);
  assert.equal(app.prepared, true);
  await app.edit('reset');
  assert.equal(app.pendingDiscard, 'reset');
  app.element.querySelector('[data-action="discard"]').click();
  assert.equal(app.prepared, false);
  assert.equal(app.rows.A.distance, '');
});
test('changed template prevents prepare or handoff until refreshed; explicit refresh reloads recipients', async () => {
  const { app } = make({ template: { name: 'Circle', signature: 'old' }, origin: null });
  app.services.snapshot = () => ({ signature: 'new', tokens: [], origin: null });
  assert.equal(await app.prepare(), false);
  assert.match(app.error, /changed/);
  app.areaTemplateSnapshot.signature = 'new';
  app.draft.damage = '12';
  assert.equal(await app.prepare(), true);
  app.services.snapshot = () => ({ signature: 'newer' });
  assert.equal(await app.review(), false);
});

test('area snapshots leave Foundry template accessor intact on construction and refresh', async () => {
  const plain = make().app;
  assert.equal(plain.template, 'foundry-application-template');
  assert.equal(plain.areaTemplateSnapshot, null);
  assert.equal(plain.recipients.length, 2);
  const initial = { name: 'First circle', signature: 'old' };
  const { app } = make({ template: initial });
  assert.equal(app.areaTemplateSnapshot, initial);
  assert.match(app.markup(), /First circle/);
  const refreshed = { name: 'Moved circle', signature: 'new', origin: null, tokens: [] };
  app.services.snapshot = () => refreshed;
  app.services.readRecipients = () => [recipients[1]];
  await app.edit('refresh');
  assert.equal(app.template, 'foundry-application-template');
  assert.equal(app.areaTemplateSnapshot, refreshed);
  assert.deepEqual(app.recipients, [recipients[1]]);
  assert.match(app.markup(), /Moved circle/);
});
test('blind player results never display damage or hand off; fixed explosion requires radius and distances', async () => {
  const { app } = make({ mode: 'explosion' });
  app.draft.damage = '99';
  assert.equal(await app.prepare(), false);
  assert.match(app.error, /radius/);
  app.draft.radius = '10';
  assert.equal(await app.prepare(), false);
  assert.match(app.error, /distance/);
  app.rows.A.distance = '1';
  app.rows.B.distance = '2';
  app.draft.visibility = 'blind';
  game.user.isGM = false;
  try {
    assert.equal(await app.prepare(), true);
    assert.doesNotMatch(app.element.querySelector('[data-results]').textContent, /99|33/);
    assert.equal(await app.review(), false);
  } finally {
    game.user.isGM = true;
  }
});
test('replacement queue requires acknowledgement before even rolling', async () => {
  const { app } = make();
  app.acknowledged = false;
  assert.equal(await app.prepare(), false);
  assert.match(app.error, /Confirm replacement/);
});
