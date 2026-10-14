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
const {
  open,
  command,
  startQueue,
  startEventQueue,
  readRecipients,
  openFragmentation,
  openProfile,
} = await import('../scripts/main.mjs');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('ADD readiness reports asynchronous opening failures instead of successful hand-off', async () => {
  const { createManualDialogClass } = await import('../scripts/dialog.mjs');
  class RenderingNative extends Native {
    async _render() {
      throw new Error('Template failed');
    }
  }
  const Manual = createManualDialogClass(RenderingNative);
  let finished = false;
  const recipient = readRecipients()[0];
  const d = new Manual(
    {
      index: 0,
      recipients: [recipient],
      finish: () => {
        finished = true;
      },
    },
    recipient,
    { damage: 9, damageType: 'cr', armorDivisor: 1 },
  );
  const rejected = assert.rejects(d.ready, /Template failed/);
  await d._render(true);
  await rejected;
  assert.equal(finished, true);
});

test('missing locations in a later recipient open temporary review without losing the queue', async () => {
  const missing = {
    ...token,
    actor: {
      ...token.actor,
      id: 'missing',
      uuid: 'Actor.missing',
      name: 'Missing',
      hitLocationsWithDR: [],
    },
    document: { ...token.document, id: 'missing', uuid: 'Scene.s.Token.missing' },
  };
  const recipients = readRecipients({ tokens: [token, missing] });
  const count = dialogs.length;
  const session = await startQueue(recipients, { damage: 9, damageType: 'cr', armorDivisor: 1 });
  assert.equal(dialogs.length, count + 1);
  session.next();
  assert.equal(session.dialog.manualLocation, true);
  assert.equal(session.dialog._calculator.basicDamage, 9);
  assert.equal(session.dialog._calculator.hitLocation, 'User Entered');
  session.finish(false);
});

test('declining fragmentation close keeps the registered helper and pending hits', async () => {
  const helper = await openFragmentation();
  helper.events = [{}];
  await helper.close();
  assert.equal(helper.rendered, true);
  assert.equal(await openFragmentation(), helper);
  assert.equal(helper.events.length, 1);
  helper.discardApproved = true;
  await helper.close();
  const replacement = await openFragmentation();
  assert.notEqual(replacement, helper);
  await replacement.close();
});

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

test('fragment event queue can review multiple hits on the same recipient and keeps audit text', async () => {
  const recipient = readRecipients()[0];
  const session = await startEventQueue([
    {
      recipient,
      seed: {
        damage: 6,
        damageType: 'cut',
        armorDivisor: 1,
        hitlocation: 'Torso',
        rollInfo: 'Fragment 1 audit',
      },
    },
    {
      recipient,
      seed: {
        damage: 9,
        damageType: 'cut',
        armorDivisor: 1,
        hitlocation: 'Torso',
        rollInfo: 'Fragment 2 audit',
      },
    },
  ]);
  assert.equal(session.dialog._calculator.basicDamage, 6);
  assert.equal(session.dialog.rollInfo, 'Fragment 1 audit');
  session.next();
  assert.equal(session.dialog._calculator.basicDamage, 9);
  assert.equal(session.dialog.rollInfo, 'Fragment 2 audit');
  session.finish(true);
  assert.equal(await session.completion, true);
});

test('plain ADD opens fragmentation and review replaces its queue without applying base damage', async () => {
  const session = await startQueue(readRecipients(), {
    damage: 0,
    damageType: 'cr',
    armorDivisor: 1,
  });
  const helper = await session.openFragmentation(session.dialog);
  assert.equal(helper.services.replacesQueue, true);
  assert.equal(session.done, false);
  const fragments = await helper.services.startEvents([
    {
      recipient: readRecipients()[0],
      seed: { damage: 7, damageType: 'cut', armorDivisor: 1, hitlocation: 'Torso' },
    },
  ]);
  assert.equal(session.done, true);
  assert.equal(await session.completion, false);
  assert.equal(fragments.dialog._calculator.basicDamage, 7);
  await assert.rejects(helper.services.startEvents([]), /changed or finished/);
  fragments.finish(true);
  await helper.close();
});

test('saved helpers reopen with chosen settings and fresh recipients, without rolling or applying', async () => {
  const previous = canvas.tokens.controlled;
  const fresh = {
    ...token,
    actor: { ...token.actor, uuid: 'Actor.fresh', id: 'fresh' },
    document: { ...token.document, id: 'fresh', uuid: 'Scene.s.Token.fresh', name: 'Fresh' },
  };
  canvas.tokens.controlled = [fresh];
  for (const [kind, settings] of [
    [
      'roller',
      {
        mode: 'roll',
        expression: '4d+2 cut',
        distribution: 'separate',
        visibility: 'blind',
        includeBucket: true,
      },
    ],
    [
      'area',
      {
        mode: 'explosion',
        input: 'fixed',
        damage: 30,
        damageType: 'cr',
        radius: 12,
        visibility: 'gm',
      },
    ],
    ['fragmentation', { expression: '3d cut', airburst: true, visibility: 'self' }],
  ]) {
    const before = dialogs.length;
    const p = { version: 1, kind, settings };
    const app = await openProfile(p);
    assert.ok(app);
    assert.equal(app.recipients[0].actor.id, 'fresh');
    assert.equal(app.draft.visibility, settings.visibility);
    assert.equal(app.batch ?? null, null);
    assert.equal(app.events ?? null, null);
    assert.equal(dialogs.length, before);
    if (kind === 'roller') {
      assert.equal(app.draft.includeBucket, true);
      assert.equal(app.draft.distribution, 'separate');
      assert.equal(app.draft.expression, '4d+2 cut');
      assert.equal(await openProfile(p), false);
    }
    if (kind === 'area') {
      assert.equal(app.template, null);
      assert.equal(app.draft.radius, '12');
      assert.equal(Object.values(app.rows)[0].distance, '');
      const snapshot = { signature: 'fresh-template' };
      app.template = snapshot;
      const originalRows = app.rows;
      assert.equal(await openProfile(p), app);
      assert.equal(app.template, snapshot);
      assert.equal(app.rows, originalRows);
      app.prepared = true;
      assert.equal(await openProfile(p), false);
      app.prepared = false;
    }
    if (kind === 'fragmentation') assert.equal(app.draft.airburst, true);
    app.draft.visibility = 'public';
    assert.equal(settings.visibility === 'public', false);
    await app.close();
  }
  const s = await openProfile({
    version: 1,
    kind: 'damage',
    settings: { damage: 12, damageType: 'cut', isShotgun: true, shotgunRofMultiplier: 4 },
  });
  assert.equal(s.dialog.recipient.actor.id, 'fresh');
  assert.equal(s.dialog._calculator.isShotgun, true);
  assert.equal(s.dialog._calculator.shotgunRofMultiplier, 4);
  assert.equal(s.done, false);
  s.finish(false);
  canvas.tokens.controlled = previous;
});

test('area commands and ADD button open the area helper without rolling or replacing anything yet', async () => {
  const app = await command('/add aoe');
  assert.equal(app.draft.mode, 'uniform');
  assert.equal(app.prepared, false);
  await app.close();
  const blast = await command('/add explosion');
  assert.equal(blast.draft.mode, 'explosion');
  await blast.close();
  const session = await startQueue(readRecipients(), {
    damage: 24,
    damageType: 'cr',
    armorDivisor: 1,
  });
  const helper = await session.openArea(session.dialog);
  assert.equal(helper.draft.damage, '24');
  assert.equal(helper.acknowledged, false);
  assert.equal(session.done, false);
  const events = [
    {
      recipient: readRecipients()[0],
      seed: {
        damage: 24,
        damageType: 'cr',
        armorDivisor: 1,
        hitlocation: 'Large-Area',
        isExplosion: true,
        hexesFromExplosion: 2,
      },
    },
  ];
  // Failed validation after detaching must allow the original prepared batch to retry.
  await assert.rejects(helper.services.startEvents([]), /No damage events/);
  const areaSession = await helper.services.startEvents(events);
  assert.equal(areaSession.dialog._calculator.hexesFromExplosion, 2);
  areaSession.finish(true);
  await helper.close();
});
