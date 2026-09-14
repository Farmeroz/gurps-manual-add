import test from 'node:test';
import assert from 'node:assert/strict';

let dialogs = [],
  windows = [],
  notices = [];
const settings = new Map([
  ['enabled', true],
  ['only-gms-open-add', false],
]);
globalThis.Hooks = { once: () => {} };
globalThis.game = {
  system: { id: 'gurps', version: '0.18.23' },
  user: { id: 'gm', isGM: true },
  users: [{ isGM: true, active: true }],
  settings: { get: (_id, key) => settings.get(key) },
};
globalThis.ui = {
  notifications: {
    error: (s) => notices.push(s),
    warn: (s) => notices.push(s),
    info: (s) => notices.push(s),
  },
};
globalThis.foundry = { utils: { randomID: () => 'id', mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.Application = class {
  constructor() {
    this.options = {};
  }
  static get defaultOptions() {
    return {};
  }
  render() {
    this.rendered = true;
    windows.push(this);
    return this;
  }
  async close() {
    this.rendered = false;
  }
  bringToTop() {}
};
class Native {
  static get defaultOptions() {
    return { classes: [] };
  }
  constructor(actor, seed, options) {
    this.actor = actor;
    this.options = options;
    this._calculator = {
      basicDamage: seed.damage,
      damageType: seed.damageType,
      armorDivisor: seed.armorDivisor,
    };
  }
  render() {
    dialogs.push(this);
    return this;
  }
  async close() {}
  async getData() {
    return {};
  }
  activateListeners() {}
  async submitInjuryApply() {}
  async resolveInjury() {}
  async _renderTemplate() {}
}
globalThis.GURPS = {
  ApplyDamageDialog: Native,
  DamageTables: { woundModifiers: { cr: {}, cut: {}, imp: {} } },
};
const token = {
  actor: {
    id: 'a',
    uuid: 'Actor.a',
    isOwner: true,
    defaultHitLocation: 'Torso',
    hitLocationsWithDR: [{ where: 'Torso' }],
  },
  document: { id: 't', uuid: 'Scene.s.Token.t', name: 'A', actorLink: true, texture: {} },
};
globalThis.canvas = {
  ready: true,
  tokens: { controlled: [token], get: (id) => (id === 't' ? token : undefined) },
};
const { open, command, startQueue, readRecipients } = await import('../scripts/main.mjs');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('empty command and HUD-style token options open the ADD without an intermediate screen', async () => {
  const before = windows.length;
  for (const invocation of [() => command('/add'), () => open({ tokens: [token] })]) {
    const pending = invocation();
    await tick();
    assert.equal(dialogs.at(-1)._calculator.basicDamage, 0);
    assert.equal(windows.length, before);
    await dialogs.at(-1).close();
    assert.equal(await pending, false);
  }
});

test('dice commands launch an inert workbench with parsed type and divisor', async () => {
  const before = dialogs.length;
  assert.equal(await command('/add 2d(2) imp'), true);
  assert.equal(windows.at(-1).draft.expression, '2d(2) imp');
  assert.equal(windows.at(-1).batch, null);
  assert.equal(dialogs.length, before);
  await windows.at(-1).close();
});

test('numeric command keeps direct ADD and completion-promise behaviour', async () => {
  const pending = command('/add 12 cut');
  await tick();
  assert.equal(dialogs.at(-1)._calculator.basicDamage, 12);
  await dialogs.at(-1).close();
  assert.equal(await pending, false);
});

test('ADD button creates an attached roller prefilled from its calculator', async () => {
  const pending = open({ damage: 8, damageType: 'imp', armorDivisor: 2 });
  await tick();
  const d = dialogs.at(-1);
  assert.equal(d.openRoller(), true);
  const roller = windows.at(-1);
  assert.equal(roller.attached, true);
  assert.equal(roller.draft.damageType, 'imp');
  assert.equal(roller.draft.armorDivisor, '2');
  assert.equal(roller.draft.hitlocation, 'Torso');
  roller.services.receiveRolls(roller.recipients, [
    { damage: 15, damageType: 'cut', armorDivisor: 3 },
  ]);
  assert.equal(dialogs.at(-1), d);
  assert.equal(d._calculator.basicDamage, 15);
  await roller.close();
  await d.close();
  await pending;
});

test('roll-only can open without scene or GM while ADD access still requires permission', async () => {
  canvas.ready = false;
  game.user.isGM = false;
  game.users = [];
  settings.set('only-gms-open-add', true);
  assert.equal(await command('/add roll'), true);
  assert.equal(windows.at(-1).recipients.length, 0);
  await windows.at(-1).close();
  assert.equal(await command('/add 12 cut'), false);
  settings.set('only-gms-open-add', false);
  canvas.ready = true;
  game.user.isGM = true;
  game.users = [{ isGM: true, active: true }];
});

test('application hand-off rechecks ownership and deleted tokens before creating a queue', async () => {
  const recipients = readRecipients();
  game.user.isGM = false;
  token.actor.isOwner = false;
  await assert.rejects(
    startQueue(recipients, { damage: 6, damageType: 'cr', armorDivisor: 1 }),
    /permissions/,
  );
  token.actor.isOwner = true;
  game.user.isGM = true;
  token.document.parent = { tokens: new Map() };
  await assert.rejects(
    startQueue(recipients, { damage: 6, damageType: 'cr', armorDivisor: 1 }),
    /deleted/,
  );
  delete token.document.parent;
});

test('world disabled blocks both the roller and fixed-damage entrypoints', async () => {
  settings.set('enabled', false);
  const before = windows.length;
  assert.equal(await open({ expression: '2d cut' }), false);
  assert.equal(await open({ damage: 4 }), false);
  assert.equal(windows.length, before);
  settings.set('enabled', true);
});
