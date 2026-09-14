// Run with GGA_SOURCE pointing to an installed GGA 0.18 source directory.
// Real GGA calculator and ADD resolution code; Foundry documents/UI are mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { createManualDialogClass, RecipientSession } from '../scripts/dialog.mjs';
import { collectRecipients } from '../scripts/core.mjs';
const source = process.env.GGA_SOURCE;
if (!source) {
  test('native GGA integration (set GGA_SOURCE to enable)', { skip: true }, () => {});
} else {
  const settingsText = fs.readFileSync(path.join(source, 'lib/miscellaneous-settings.js'), 'utf8');
  globalThis.Settings = Object.fromEntries(
    [...settingsText.matchAll(/export const (\w+) = '([^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  let updates = [],
    messages = [],
    errors = [],
    rolls = 0,
    failUpdateAt = 0;
  const settings = new Map();
  function reset() {
    updates = [];
    messages = [];
    errors = [];
    rolls = 0;
    failUpdateAt = 0;
    settings.clear();
    for (const key of [
      'SETTING_BLUNT_TRAUMA',
      'SETTING_LOCATION_MODIFIERS',
      'SETTING_APPLY_DIVISOR',
    ])
      settings.set(Settings[key], true);
    settings.set('enabled', true);
    settings.set(Settings.SETTING_DEFAULT_ADD_ACTION, 'apply');
    settings.set(Settings.SETTING_SIMPLE_DAMAGE, true); // Must still open full ADD.
    game.user = { id: 'gm', name: 'GM', isGM: true };
    game.users = [{ id: 'gm', name: 'GM', isGM: true, active: true, avatar: 'gm.png' }];
    GURPS.lastInjuryRolls = {};
  }
  globalThis.game = {
    user: {},
    users: [],
    version: '14.367',
    actors: new Map(),
    settings: { get: (_scope, key) => settings.get(key) },
    i18n: { localize: (key) => key },
  };
  globalThis.canvas = { tokens: { placeables: [] } };
  globalThis.ui = {
    notifications: { warn: (x) => errors.push(x), error: (x) => errors.push(x), info: () => {} },
  };
  globalThis.foundry = {
    utils: {
      mergeObject: (a, b) => ({ ...a, ...b }),
      randomID: () => Math.random().toString(36).slice(2),
      isNewerVersion: () => false,
    },
  };
  globalThis.Application = class {
    static get defaultOptions() {
      return { classes: [] };
    }
    constructor(options = {}) {
      this.options = { ...this.constructor.defaultOptions, ...options };
    }
    render() {
      this.rendered = true;
      return this;
    }
    async close() {
      this.rendered = false;
    }
    async getData() {
      return {};
    }
    activateListeners() {}
  };
  globalThis.objectToArray = (x) => Object.values(x ?? {});
  globalThis.zeroFill = (n, w) => String(n).padStart(w, '0');
  globalThis.generateUniqueId = () => Math.random().toString(36).slice(2);
  globalThis.isNiceDiceEnabled = () => false;
  globalThis.TokenActions = { fromToken: async () => null, fromActor: async () => null };
  globalThis.hitlocation = { LIMB: 'limb', EXTREMITY: 'extremity', CHEST: 'chest', GROIN: 'groin' };
  globalThis.HitLocationEntry = {
    findLocation: (entries, name) => entries.find((x) => x.where === name),
    getLargeAreaDR: (entries) => entries[0].getDR(),
  };
  globalThis.GURPS = {
    DamageTables: {
      woundModifiers: Object.fromEntries(
        Object.entries({
          cr: 1,
          cut: 1.5,
          imp: 2,
          burn: 1,
          tox: 1,
          fat: 1,
          'pi-': 0.5,
          pi: 1,
          'pi+': 1.5,
          'pi++': 2,
        }).map(([k, multiplier]) => [k, { multiplier }]),
      ),
      translate: (x) => x,
    },
    lastInjuryRolls: {},
  };
  globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } };
  globalThis.ChatMessage = {
    getSpeaker: () => ({ alias: 'GM' }),
    create: async (data) => {
      const message = { id: String(messages.length), ...data };
      messages.push(message);
      return message;
    },
  };
  globalThis.renderTemplate = async (name, data) =>
    name.endsWith('chat-damage-results.hbs')
      ? JSON.stringify(data)
      : `<div class="results-table">${data.CALC?.pointsToApply}</div>`;
  globalThis.$ = (html) => ({ find: () => ({ clone: () => ({ html: () => html }) }) });
  globalThis.Roll = {
    create: () => ({
      total: 1,
      evaluate: async () => {
        rolls++;
      },
      toMessage: async () => {},
    }),
  };
  function load(file, className) {
    let code = fs.readFileSync(path.join(source, file), 'utf8');
    code = code.replace(/^import [\s\S]*? from ['"][^'"]+['"]\s*;?\s*$/gm, '');
    code = code.replace(/export default class /, 'class ').replace(/export class /g, 'class ');
    return vm.runInThisContext(`(function(){${code}\nreturn ${className};})()`, { filename: file });
  }
  globalThis.CompositeDamageCalculator = load(
    'module/damage/damagecalculator.js',
    'CompositeDamageCalculator',
  );
  const NativeADD = load('module/damage/applydamage.js', 'ApplyDamageDialog');
  const Manual = createManualDialogClass(NativeADD);
  function actor(id, dr = 4) {
    const a = {
      id,
      uuid: `Actor.${id}`,
      name: id,
      img: 'npc.png',
      isOwner: true,
      hasPlayerOwner: true,
      defaultHitLocation: 'Torso',
      effects: [],
      system: {
        HP: { value: 30, max: 10 },
        FP: { value: 10, max: 10 },
        attributes: { ST: { value: 10 } },
        ads: {},
        hitlocations: {},
        additionalresources: { tracker: {} },
      },
      _additionalResources: { tracker: {} },
      _hitLocationRolls: {
        Torso: { role: 'chest' },
        Vitals: { role: 'chest' },
        'Left Arm': { role: 'limb' },
      },
    };
    a.hitLocationsWithDR = ['Torso', 'Vitals', 'Left Arm'].map((where) => ({
      where,
      dr,
      getDR: () => dr,
    }));
    a.system.hitlocations = Object.fromEntries(
      a.hitLocationsWithDR.map((v, i) => [i, { where: v.where, dr: String(dr) }]),
    );
    a.getOwners = () => [{ id: 'gm' }];
    a.update = async (changes) => {
      if (failUpdateAt && updates.length + 1 === failUpdateAt)
        throw new Error('Simulated document update failure');
      updates.push({ id, changes });
      for (const [key, value] of Object.entries(changes)) {
        const parts = key.split('.');
        let target = a;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      }
    };
    return a;
  }
  function recipient(a, id = a.id, linked = false) {
    const doc = {
      id,
      name: id,
      uuid: `Scene.s.Token.${id}`,
      actorLink: linked,
      texture: { src: 'token.png' },
    };
    const token = { actor: a, document: doc };
    return collectRecipients([token], game.user, false).recipients[0];
  }
  function session(actors, seed = { damage: 12, damageType: 'cut', armorDivisor: 1 }) {
    const s = new RecipientSession(
      Manual,
      actors.map((a) => recipient(a)),
      seed,
      () => {},
    );
    s.show();
    return s;
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  test('opens full native ADD, reads DR and actor, creates no roll/update/message', async () => {
    reset();
    const a = actor('one', 4);
    a.defaultHitLocation = 'Random';
    const s = session([a]);
    assert.ok(s.dialog instanceof NativeADD);
    assert.equal(s.dialog.actor, a);
    assert.equal(s.dialog._calculator.DR, 4);
    assert.equal(s.dialog.isSimpleDialog, false);
    assert.equal(s.dialog._calculator.attacker, null);
    assert.equal(s.dialog._calculator.hitLocation, 'Torso');
    await tick();
    assert.equal(rolls, 0);
    assert.equal(updates.length, 0);
    assert.equal(messages.length, 0);
  });
  test('real native calculation: 12 cutting, DR 4 => 12 injury and native result card', async () => {
    reset();
    const a = actor('one', 4);
    const s = session([a]);
    assert.equal(await s.dialog.submitInjuryApply({}, false, true), true);
    await tick();
    assert.equal(a.system.HP.value, 18);
    assert.equal(updates.length, 1);
    assert.equal(messages.length, 1);
    assert.match(messages[0].content, /Manual damage/);
    assert.match(messages[0].content, /"injury":12/);
    assert.equal(await s.completion, true);
  });
  test('second recipient reads its own DR and does not inherit first DR override', async () => {
    reset();
    const a = actor('one', 4),
      b = actor('two', 8);
    const s = session([a, b]);
    s.dialog._calculator.userEnteredDR = 0;
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(a.system.HP.value, 12);
    assert.equal(s.dialog.actor, b);
    assert.equal(s.dialog._calculator.DR, 8);
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(b.system.HP.value, 24);
  });
  test('native armour divisor, damage type, and location mechanics remain active', async () => {
    reset();
    let a = actor('one', 8);
    let s = session([a], { damage: 12, damageType: 'cut', armorDivisor: 2 });
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(a.system.HP.value, 18);
    reset();
    a = actor('two', 4);
    s = session([a], { damage: 12, damageType: 'imp', armorDivisor: 1, hitlocation: 'Vitals' });
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(a.system.HP.value, 6);
  });
  test('native injury tolerance auto-detection is retained', async () => {
    reset();
    const a = actor('one', 0);
    a.system.ads = { a: { name: 'Injury Tolerance (Unliving)', notes: '', contains: {} } };
    const s = session([a], { damage: 12, damageType: 'pi', armorDivisor: 1 });
    assert.equal(s.dialog._calculator.isInjuryTolerance, true);
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(a.system.HP.value, 26);
  });
  test('fatigue uses native FP destination and quiet result visibility', async () => {
    reset();
    const a = actor('one', 0);
    const s = session([a], { damage: 3, damageType: 'fat', armorDivisor: 1 });
    await s.dialog.submitInjuryApply({}, false, false);
    await tick();
    assert.equal(a.system.FP.value, 7);
    assert.equal(a.system.HP.value, 30);
    assert.deepEqual(messages[0].whisper, ['gm']);
  });
  test('two quick Apply calls commit only once; keep-open still allows next', async () => {
    reset();
    const a = actor('one');
    const s = session([a]);
    const d = s.dialog;
    await Promise.all([d.submitInjuryApply({}, true, true), d.submitInjuryApply({}, true, true)]);
    await d.submitInjuryApply({}, true, true);
    assert.equal(updates.length, 1);
    assert.equal(s.done, false);
    await d.advance();
    assert.equal(s.done, true);
  });
  test('Apply Multiple completes before queue advances', async () => {
    reset();
    const a = actor('one'),
      b = actor('two');
    const s = session([a, b]);
    s.dialog.timesToApply = 2;
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(updates.length, 2);
    assert.equal(a.system.HP.value, 6);
    assert.equal(s.dialog.actor, b);
  });
  test('ownership revoked after opening prevents application', async () => {
    reset();
    const a = actor('one');
    const s = session([a]);
    game.user.isGM = false;
    a.isOwner = false;
    assert.equal(await s.dialog.submitInjuryApply({}, false, true), false);
    assert.equal(updates.length, 0);
    assert.ok(errors.length);
  });
  test('cancel closes queue without applying remaining recipients', async () => {
    reset();
    const s = session([actor('one'), actor('two')]);
    await s.dialog.close();
    assert.equal(await s.completion, false);
    assert.equal(updates.length, 0);
  });
  test('partial application failure prevents replaying the successful first hit', async () => {
    reset();
    const s = session([actor('one')]);
    s.dialog.timesToApply = 2;
    failUpdateAt = 2;
    await s.dialog.submitInjuryApply({}, true, true);
    failUpdateAt = 0;
    await s.dialog.submitInjuryApply({}, true, true);
    assert.equal(updates.length, 1);
    assert.equal(s.done, false);
  });
  test('optional Body Hits roll is deferred to application and not copied to next target', async () => {
    reset();
    settings.set(Settings.SETTING_BODY_HITS, true);
    const s = session([actor('one', 0), actor('two', 0)], {
      damage: 3,
      damageType: 'imp',
      armorDivisor: 1,
    });
    assert.equal(rolls, 0);
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(rolls, 1);
    assert.equal(s.dialog._calculator.hitLocation, 'Torso');
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(rolls, 2);
  });
  test('custom native wounding multiplier carries with the custom damage type', async () => {
    reset();
    const a = actor('one', 4),
      b = actor('two', 4);
    const s = session([a, b]);
    s.dialog._calculator.damageType = 'User Entered';
    s.dialog._calculator.userEnteredWoundModifier = 3;
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(s.dialog._calculator.damageType, 'User Entered');
    assert.equal(s.dialog._calculator.userEnteredWoundModifier, 3);
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(a.system.HP.value, 6);
    assert.equal(b.system.HP.value, 6);
  });
  test('native direct Apply deliberately bypasses DR, unlike calculated injury', async () => {
    reset();
    const a = actor('one', 20);
    const s = session([a]);
    await s.dialog.submitDirectApply(false, true);
    assert.equal(a.system.HP.value, 18);
    assert.equal(updates.length, 1);
  });

  test('rolled queue uses the original per-recipient seeds despite edits to the first ADD', async () => {
    reset();
    const a = actor('one', 4),
      b = actor('two', 8);
    const seed = {
      damage: 12,
      damageType: 'cut',
      armorDivisor: 1,
      rollInfo: '3d cut: 12 basic damage',
    };
    const s = new RecipientSession(Manual, [recipient(a), recipient(b)], seed, () => {}, [
      seed,
      seed,
    ]);
    s.show();
    s.dialog._calculator.basicDamage = 5;
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(s.dialog._calculator.basicDamage, 12);
    assert.equal(s.dialog._calculator.DR, 8);
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(a.system.HP.value, 29);
    assert.equal(b.system.HP.value, 24);
    assert.equal(rolls, 0, 'opening and applying recorded results never rerolls damage');
  });

  test('rolled separate results use current Layered Armour with per-layer Hardened and native injury', async () => {
    reset();
    globalThis.document = parseHTML('<html><body></body></html>').document;
    const dir = process.env.LAYERED_SOURCE;
    const { patchADD } = await import(pathToFileURL(path.join(dir, 'scripts/integration.mjs')));
    const { newLayer } = await import(pathToFileURL(path.join(dir, 'scripts/core.mjs')));
    patchADD(NativeADD, async () => {});
    const a = actor('layered-one', 99),
      b = actor('layered-two', 99);
    a.getFlag = (_id, key) =>
      key === 'profile'
        ? {
            schema: 1,
            enabled: true,
            layers: [
              { ...newLayer(['Torso']), dr: 12, hardened: 1 },
              { ...newLayer(['Torso']), dr: 6 },
            ],
          }
        : undefined;
    b.getFlag = (_id, key) =>
      key === 'profile'
        ? { schema: 1, enabled: true, layers: [{ ...newLayer(['Torso']), dr: 3 }] }
        : undefined;
    const seeds = [20, 10].map((damage) => ({
      damage,
      damageType: 'imp',
      armorDivisor: 3,
      hitlocation: 'Torso',
      rollInfo: 'Separate damage roll',
    }));
    const s = new RecipientSession(Manual, [recipient(a), recipient(b)], seeds[0], () => {}, seeds);
    s.show();
    await s.dialog.getData();
    assert.equal(s.dialog._calculator.effectiveDR, 8);
    await s.dialog.submitInjuryApply({}, false, true);
    await s.dialog.getData();
    assert.equal(s.dialog._calculator.basicDamage, 10);
    assert.equal(s.dialog._calculator.effectiveDR, 1);
    await s.dialog.submitInjuryApply({}, false, true);
    assert.equal(a.system.HP.value, 6);
    assert.equal(b.system.HP.value, 12);
    assert.equal(updates.length, 2);
    assert.equal(rolls, 0);
  });
}
