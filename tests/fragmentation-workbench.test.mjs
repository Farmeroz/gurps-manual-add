import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  createFragmentationWorkbenchClass,
  distanceInYards,
} from '../scripts/fragmentation-workbench.mjs';

const types = { cr: {}, cut: {}, imp: {}, burn: {} };
globalThis.GURPS = {
  DamageTables: { woundModifiers: types },
  SSRT: { getModifier: (yards) => (yards <= 2 ? 0 : yards <= 3 ? -1 : yards <= 5 ? -2 : -3) },
};
globalThis.game = { user: { id: 'gm', name: 'GM', isGM: true } };
globalThis.foundry = { utils: { mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.CONFIG = { sounds: { dice: 'dice.wav' } };

const totals = [];
globalThis.Roll = {
  create: (formula) => {
    assert.equal(formula, '3d6', 'Foundry requires explicit die faces, not GURPS shorthand 3d');
    return {
      total: null,
      async evaluate() {
        this.total = totals.shift();
        return this;
      },
    };
  },
};

const Base = class {
  static get defaultOptions() {
    return {};
  }
  activateListeners() {}
  async close() {
    this.closed = true;
  }
};

const Fragmentation = createFragmentationWorkbenchClass(Base);

function recipient(key, name, sm = 0) {
  return {
    key,
    name,
    token: { id: key },
    actor: {
      name,
      system: { traits: { sizemod: String(sm) } },
      hitLocationsWithDR: [
        { where: 'Torso', roll: [9, 10, 11] },
        { where: 'Left Arm', roll: [8] },
        { where: 'Right Arm', roll: [12] },
        { where: 'Left Leg', roll: [6, 7] },
        { where: 'Right Leg', roll: [13, 14] },
        { where: 'Skull', roll: [3, 4] },
        { where: 'Face', roll: [5] },
        { where: 'Vitals', roll: [15] },
        { where: 'Hand', roll: [16] },
        { where: 'Foot', roll: [17, 18] },
      ],
    },
  };
}

function setup(recipients = [recipient('one', 'One')], overrides = {}) {
  const { document, window } = parseHTML('<html><body></body></html>');
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
  let damage = 0,
    messages = 0,
    started = null;
  const services = {
    assertEnabled: () => {},
    roller: async () => ({
      _getDiceData: () => ({}),
      _createDraggableSection: async () => ({
        damage: ++damage + 5,
        roll: { total: damage + 5 },
      }),
    }),
    createMessage: async () => ({ id: `msg-${++messages}` }),
    startEvents: async (events) => {
      started = events;
      return { completion: Promise.resolve(true) };
    },
    ...overrides,
  };
  const app = new Fragmentation(recipients, services);
  document.body.innerHTML = app.markup();
  app.element = document.querySelector('form');
  app.activateListeners(app.element);
  return { app, document, window, started: () => started, messages: () => messages };
}

test('fragment helper is inert until resolve is chosen', () => {
  totals.length = 0;
  const f = setup();
  assert.equal(f.app.events, null);
  assert.equal(f.messages(), 0);
  assert.equal(f.app.element.querySelector('[data-action="reviewFragments"]').disabled, true);
});

test('B415 attack roll creates multiple random-location fragment events', async () => {
  totals.splice(0, totals.length, 11, 8, 12);
  const f = setup();
  f.app.rows.one.distance = '3';
  assert.equal(await f.app.resolveFragments(), true);
  assert.equal(f.app.events.length, 2);
  assert.deepEqual(
    f.app.events.map((event) => [
      event.seed.damageType,
      event.seed.armorDivisor,
      event.seed.hitlocation,
    ]),
    [
      ['cut', 1, 'Left Arm'],
      ['cut', 1, 'Right Arm'],
    ],
  );
  assert.equal(f.messages(), 1);
});

test('direct hit guarantees exactly one fragment hit and still randomises location', async () => {
  totals.splice(0, totals.length, 15);
  const f = setup();
  f.app.rows.one.directHit = true;
  f.app.rows.one.distance = '999';
  assert.equal(await f.app.resolveFragments(), true);
  assert.equal(f.app.events.length, 1);
  assert.equal(f.app.events[0].seed.hitlocation, 'Vitals');
});

test('out-of-range target produces no event', async () => {
  totals.length = 0;
  const f = setup();
  f.app.rows.one.distance = '11';
  assert.equal(await f.app.resolveFragments(), true);
  assert.equal(f.app.events.length, 0);
  assert.match(f.app.summary[0], /outside 10-yard/);
});

test('resolved hits hand off to the normal ADD event queue', async () => {
  totals.splice(0, totals.length, 14, 9);
  const f = setup();
  await f.app.resolveFragments();
  assert.equal(f.app.events.length, 1);
  assert.equal(await f.app.reviewFragments(), true);
  assert.equal(f.started().length, 1);
  assert.equal(f.started()[0].seed.damageType, 'cut');
});

test('blind player sees no rolled fragment detail and cannot apply locally', async () => {
  totals.splice(0, totals.length, 14, 9);
  const f = setup();
  game.user.isGM = false;
  f.app.draft.visibility = 'blind';
  await f.app.resolveFragments();
  const text = f.app.element.querySelector('.manual-roll-results').textContent;
  assert.match(text, /visible to the GM/);
  assert.doesNotMatch(text, /Torso|cut|6/);
  assert.equal(f.app.element.querySelector('[data-action="reviewFragments"]').disabled, true);
});

test('distance estimates convert scene units and include elevation; unsafe contexts stay manual', () => {
  const a = { token: { center: { x: 0, y: 0 } }, document: { parent: { id: 's' }, elevation: 0 } };
  const b = { token: { center: { x: 3, y: 4 } }, document: { parent: { id: 's' }, elevation: 12 } };
  const canvas = {
    ready: true,
    scene: { id: 's', grid: { units: 'feet' } },
    grid: { measurePath: () => ({ euclidean: 5 }) },
  };
  assert.equal(distanceInYards(a, b, canvas), 4.33);
  canvas.scene.grid.units = 'metres';
  assert.equal(distanceInYards(a, b, canvas), 14.22);
  canvas.scene.grid.units = 'squares';
  assert.equal(distanceInYards(a, b, canvas), null);
  canvas.scene.grid.units = 'yards';
  b.document.parent.id = 'other';
  assert.equal(distanceInYards(a, b, canvas), null);
});

test('zero distance seeds centre and other distances, preserving overrides and airburst entry', () => {
  const recipients = ['a', 'b', 'c'].map((key, i) => ({
    ...recipient(key, key),
    document: { parent: { id: 's' } },
    token: { center: { x: i * 4, y: 0 } },
  }));
  globalThis.canvas = {
    ready: true,
    scene: { id: 's', grid: { units: 'yards' } },
    grid: { measurePath: ([a, b]) => ({ euclidean: Math.abs(b.x - a.x) }) },
  };
  const f = setup(recipients);
  const edit = (key, value) => {
    const input = f.app.element.querySelector(
      `[data-recipient="${key}"] [data-frag-field="distance"]`,
    );
    input.value = value;
    input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  };
  edit('c', '20');
  edit('a', '0');
  assert.equal(f.app.originKey, 'a');
  assert.equal(f.app.rows.a.directHit, false);
  assert.equal(f.app.rows.b.distance, '4');
  assert.equal(f.app.rows.c.distance, '20');
  f.app.draft.airburst = true;
  recipients[1].token.center.x = 7;
  f.app.estimateDistances();
  assert.equal(f.app.rows.b.distance, '4');
  f.app.draft.airburst = false;
  edit('b', '9');
  f.app.estimateDistances();
  assert.equal(f.app.rows.b.distance, '9');
  delete globalThis.canvas;
});

test('direct-hit entry suggests centre without changing other direct-hit flags', () => {
  const f = setup([recipient('a', 'A'), recipient('b', 'B')]);
  const input = f.app.element.querySelector('[data-recipient="b"] [data-frag-field="directHit"]');
  input.checked = true;
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.equal(f.app.originKey, 'b');
  assert.equal(f.app.rows.a.directHit, false);
  assert.equal(f.app.rows.a.distance, '1');
});

test('closing pending hits warns, keep preserves them, discard closes; misses need no warning', async () => {
  const f = setup();
  totals.splice(0, totals.length, 14, 9);
  await f.app.resolveFragments();
  const events = f.app.events;
  await f.app.close();
  assert.equal(f.app.closed, undefined);
  assert.equal(f.app.pendingDiscard, 'close');
  assert.equal(f.app.element.querySelector('.manual-discard-warning').hidden, false);
  f.app.element.querySelector('[data-action="keepFragments"]').click();
  assert.equal(f.app.events, events);
  assert.equal(f.app.pendingDiscard, null);
  await f.app.close();
  f.app.element.querySelector('[data-action="discardFragments"]').click();
  assert.equal(f.app.closed, true);
  const misses = setup();
  misses.app.events = [];
  await misses.app.close();
  assert.equal(misses.app.closed, true);
  assert.equal(misses.app.pendingDiscard, null);
});

test('reset clears overrides and direct hits so a new zero-range centre recalculates', () => {
  const recipients = ['a', 'b'].map((key, i) => ({
    ...recipient(key, key),
    document: { parent: { id: 's' } },
    token: { center: { x: i * 4, y: 0 } },
  }));
  globalThis.canvas = {
    ready: true,
    scene: { id: 's', grid: { units: 'yards' } },
    grid: { measurePath: ([a, b]) => ({ euclidean: Math.abs(b.x - a.x) }) },
  };
  const f = setup(recipients);
  f.app.originKey = 'a';
  f.app.originChosen = true;
  f.app.rows.a.directHit = true;
  f.app.rows.b.distanceEdited = true;
  f.app.rows.b.distance = '99';
  f.app.rows.b.posture = 'kneeling';
  f.app.resetDistances();
  assert.equal(f.app.rows.a.directHit, false);
  assert.equal(f.app.rows.b.distanceEdited, false);
  assert.equal(f.app.rows.b.posture, 'kneeling');
  const input = f.app.element.querySelector('[data-recipient="b"] [data-frag-field="distance"]');
  input.value = '0';
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  assert.equal(f.app.originKey, 'b');
  assert.equal(f.app.rows.a.distance, '4');
  delete globalThis.canvas;
});

test('reset warns before discarding pending hits and handed-off results close without warning', async () => {
  const f = setup();
  f.app.events = [{}];
  f.app.originKey = 'one';
  f.app.resetDistances();
  assert.equal(f.app.pendingDiscard, 'reset');
  assert.equal(f.app.originKey, 'one');
  f.app.element.querySelector('[data-action="discardFragments"]').click();
  assert.equal(f.app.originKey, '');
  assert.equal(f.app.events, null);
  assert.equal(f.app.closed, undefined);
  f.app.events = [{}];
  f.app.handedOff = true;
  await f.app.close();
  assert.equal(f.app.closed, true);
  assert.equal(f.app.pendingDiscard, null);
});
