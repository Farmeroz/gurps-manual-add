import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProfile,
  calculatorProfile,
  profileCommand,
  saveDamageProfile,
} from '../scripts/profiles.mjs';
const types = { cr: {}, cut: {}, imp: {}, burn: {} };
globalThis.GURPS = { DamageTables: { woundModifiers: types } };
const profile = (kind, settings) => ({ version: 1, kind, settings });
const fixed = profile('damage', {
  damage: 12,
  damageType: 'imp',
  armorDivisor: 2,
  hitlocation: 'Torso',
  damageModifier: 'tight-beam',
  isShotgun: true,
  shotgunRofMultiplier: 3,
});
test('attack profile roundtrip retains advanced attack fields and discards defender state', () => {
  const normalized = normalizeProfile({
    ...fixed,
    recipients: ['old'],
    settings: {
      ...fixed.settings,
      DR: 44,
      userEnteredDR: 12,
      hexesFromExplosion: 4,
      rollInfo: {},
      target: 'old',
      isInjuryTolerance: true,
    },
  });
  assert.deepEqual(normalized, normalizeProfile(fixed));
  assert.equal(normalized.settings.isShotgun, true);
  assert.equal(normalized.settings.shotgunRofMultiplier, 3);
  assert.deepEqual(normalizeProfile(JSON.parse(JSON.stringify(normalized))), normalized);
  const explosion = normalizeProfile(
    profile('damage', { ...fixed.settings, isExplosion: true, isRangedHalfDamage: true }),
  );
  assert.equal(explosion.settings.isShotgun, false);
  assert.equal(explosion.settings.isRangedHalfDamage, false);
});
test('calculator profiles keep a custom attack multiplier but not target injury modifiers', () => {
  const p = calculatorProfile({
    basicDamage: 9,
    damageType: 'User Entered',
    userEnteredWoundModifier: 1.75,
    armorDivisor: 1,
    hitLocation: 'Large-Area',
    additionalWoundModifier: 5,
    isInjuryTolerance: true,
  });
  assert.equal(p.settings.userEnteredWoundModifier, 1.75);
  assert.equal(p.settings.damageType, 'User Entered');
  assert.equal(p.settings.hitlocation, 'Large-Area');
  assert.equal(p.settings.additionalWoundModifier, undefined);
});
test('roller supports blank default location and retains dice, distribution, bucket choice and visibility', () => {
  const p = normalizeProfile(
    profile('roller', {
      mode: 'roll',
      expression: '3d+2(2) cut',
      hitlocation: '',
      distribution: 'separate',
      includeBucket: true,
      visibility: 'blind',
      results: [99],
    }),
  );
  assert.match(p.settings.expression, /3d/);
  assert.equal(p.settings.includeBucket, true);
  assert.equal(p.settings.visibility, 'blind');
  assert.equal(p.settings.results, undefined);
  assert.equal(
    normalizeProfile(profile('roller', { mode: 'fixed', damage: 5, hitlocation: '' })).settings
      .damage,
    5,
  );
});
test('area and fragmentation profiles exclude resolved hits, origin, distances and template references', () => {
  const p = normalizeProfile(
    profile('area', {
      mode: 'explosion',
      input: 'fixed',
      damage: 30,
      damageType: 'cr',
      radius: 60,
      distribution: 'shared',
      visibility: 'gm',
      rows: { old: { distance: 2 } },
      origin: {},
      template: {},
      events: [{}],
    }),
  );
  assert.equal(p.settings.radius, '60');
  assert.equal(p.settings.distribution, 'shared');
  assert.equal(p.settings.origin, undefined);
  assert.equal(p.settings.rows, undefined);
  const f = normalizeProfile(
    profile('fragmentation', {
      expression: '2d cut',
      airburst: true,
      visibility: 'self',
      events: [{}],
    }),
  );
  assert.deepEqual(f.settings, { expression: '2d cut', airburst: true, visibility: 'self' });
});
test('invalid profile versions and invalid attack inputs fail before saving or opening', () => {
  for (const bad of [
    { ...fixed, version: 2 },
    profile('unknown', {}),
    profile('damage', { damage: -1 }),
    profile('damage', { damageType: 'User Entered', userEnteredWoundModifier: NaN }),
    profile('area', { mode: 'explosion', input: 'fixed', damage: 8, radius: '' }),
    profile('fragmentation', { expression: '2d(2) cut' }),
    profile('fragmentation', { expression: '2d imp' }),
    profile('roller', { mode: 'roll', expression: 'not dice' }),
  ])
    assert.throws(() => normalizeProfile(bad));
});
test('generated command treats strings as data and checks the installed module', async () => {
  const weird = profile('damage', {
    ...fixed.settings,
    damageModifier: '`";globalThis.injected=true;//',
  });
  let received, warning;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('game', 'ui', profileCommand(weird));
  await run(
    {
      modules: new Map([
        [
          'gurps-manual-add',
          {
            active: true,
            api: {
              openProfile: async (p) => {
                received = p;
              },
            },
          },
        ],
      ]),
    },
    {},
  );
  assert.deepEqual(received, JSON.parse(JSON.stringify(normalizeProfile(weird))));
  assert.equal(globalThis.injected, undefined);
  await run(
    { modules: new Map() },
    {
      notifications: {
        warn: (x) => {
          warning = x;
        },
      },
    },
  );
  assert.match(warning, /Enable Manual Damage/);
});
test('save is cancellable, permission checked, private and creates independent macros', async () => {
  const macros = [],
    errors = [];
  let result = null,
    permitted = true;
  globalThis.game = { user: { id: 'gm', can: () => permitted } };
  globalThis.Macro = {
    canUserCreate: () => permitted,
    create: async (data) => {
      macros.push(data);
      return data;
    },
  };
  globalThis.foundry = { applications: { api: { DialogV2: { input: async () => result } } } };
  globalThis.ui = { notifications: { info() {}, error: (x) => errors.push(x) } };
  assert.equal(await saveDamageProfile(fixed), null);
  assert.equal(macros.length, 0);
  result = { name: 'My attack' };
  permitted = false;
  assert.equal(await saveDamageProfile(fixed), null);
  assert.match(errors[0], /permission/);
  permitted = true;
  await saveDamageProfile(fixed);
  await saveDamageProfile(fixed);
  assert.equal(macros.length, 2);
  assert.deepEqual(macros[0].ownership, { default: 0, gm: 3 });
  assert.equal(macros[0].type, 'script');
  assert.deepEqual(macros[0].flags['gurps-manual-add'].profile, normalizeProfile(fixed));
});
