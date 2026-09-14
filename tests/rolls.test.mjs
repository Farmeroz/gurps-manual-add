import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DamageBatch, bucketSnapshot, parseExpression } from '../scripts/rolls.mjs';
import { parseCommand } from '../scripts/core.mjs';

const types = { cr: {}, cut: {}, imp: {}, burn: {}, 'pi++': {} };
const spec = (text = '3d+2 cut') => parseExpression(text, {}, types);

test('commands distinguish fixed damage, dice, and the roll-only launcher', () => {
  assert.deepEqual(parseCommand('/add 3d+2 cut rolls=separate location="Left Arm"'), {
    expression: '3d+2',
    damageType: 'cut',
    distribution: 'separate',
    hitlocation: 'Left Arm',
  });
  assert.deepEqual(parseCommand('/madd roll'), { roll: true });
  assert.deepEqual(parseCommand('/add 12 cut'), { damage: '12', damageType: 'cut' });
  assert.throws(() => parseCommand('/add 12 cut rolls=separate'));
  assert.throws(() => parseCommand('/add 2d cr rolls=typo'));
});

test('damage expressions normalise d6, modifiers, multipliers, types and divisors', () => {
  const result = spec('2d6-1x5(0.5) pi++');
  assert.equal(result.formula, '2d-1×5(0.5)');
  assert.equal(result.damageType, 'pi++');
  assert.equal(result.modifier, -1);
  assert.equal(result.multiplier, 5);
  assert.equal(result.armorDivisor, 0.5);
  assert.equal(spec('2d(2) imp').armorDivisor, 2);
  assert.equal(spec('1d−2 cr').modifier, -2);
  assert.equal(
    parseExpression('3d', { damageType: 'cut', armorDivisor: 2 }, types).expression,
    '3d(2) cut',
  );
});

test('rejects partial matches, unknown terms, arbitrary code and conflicting options', () => {
  for (const text of [
    '2d junk',
    '2d+2 garbage trailing',
    '2d/2 cut',
    '2d8 cut',
    '0d cut',
    '1001d cut',
    '3d(0) imp',
    '2dx0 cr',
    '2dx1.5 cut',
    'sw+2 cut',
    '2d;alert(1)',
    '2d+@margin cut',
    '2d! cut',
    '2d+1000001 cr',
    '2d(2/3) imp',
  ])
    assert.throws(() => spec(text), text);
  assert.throws(() => parseExpression('2d(2) imp', { armorDivisor: 3 }, types));
  assert.throws(() => parseExpression('2d imp', { damageType: 'cut' }, types));
});

let values, evaluations, created;
globalThis.game = { user: { id: 'gm', name: 'GM', isGM: true } };
globalThis.ui = {
  notifications: {
    warn: (message) => {
      throw new Error(message);
    },
  },
};
globalThis.d6ify = (text) => text.replace(/d(?!\d)/, 'd6');
globalThis.generateUniqueId = () => `roll-${evaluations}`;
globalThis.Roll = {
  create: (formula) => {
    const dice = values.shift();
    assert.ok(dice, 'unexpected reroll');
    const match = /^(\d+)d6([+-]\d+)?\+(-?\d+)$/.exec(formula);
    assert.ok(match, formula);
    assert.equal(dice.length, Number(match[1]));
    const sum = dice.reduce((a, b) => a + b, 0);
    return {
      result: `${sum} ${match[2] ?? ''} + ${match[3]}`,
      total: sum + Number(match[2] ?? 0) + Number(match[3]),
      isLoaded: false,
      dice: [{ results: dice.map((result) => ({ result })) }],
      evaluate: async () => {
        evaluations++;
      },
    };
  },
};
const source = fs.readFileSync(
  path.join(process.env.GGA_SOURCE, 'module/damage/damagechat.js'),
  'utf8',
);
const code = source
  .replace(/^import [\s\S]*? from ['"][^'"]+['"]\s*;?\s*$/gm, '')
  .replace('export default class ', 'class ');
const Native = vm.runInThisContext(`(function(){${code}\nreturn DamageChat;})()`);
const roller = () => new Native();
const recipients = [
  { key: 'one', name: 'One' },
  { key: 'two', name: 'Two' },
];
const create = async (data, options) => {
  created.push({ data, options });
  return { id: `chat-${created.length}` };
};
function reset(dice) {
  values = dice;
  evaluations = 0;
  created = [];
  game.user.isGM = true;
}

test('native GGA roll is evaluated once, shared unchanged, and does not invoke attack effects', async () => {
  reset([[3, 4, 2]]);
  globalThis.GURPS = {
    ModifierBucket: {
      applyMods: () => {
        throw new Error('must not consume bucket');
      },
    },
    applyModifierDesc: () => {
      throw new Error('must not execute effects');
    },
  };
  const batch = new DamageBatch({ spec: spec(), recipients });
  await Promise.all([batch.evaluate(roller()), batch.evaluate(roller())]);
  await batch.publish(create);
  await batch.publish(create);
  assert.equal(evaluations, 1);
  assert.equal(created.length, 1);
  assert.equal(batch.results[0].damage, 11);
  assert.deepEqual(
    batch.seedsFor(recipients).map((s) => s.damage),
    [11, 11],
  );
  assert.equal(batch.results[0].attacker, null);
  assert.equal(
    created[0].data.flags.gurps,
    undefined,
    'audit card offers no second damage-application path',
  );
});

test('native GGA minimums and multiplier order are retained', async () => {
  for (const [text, expected] of [
    ['1d-5 cr', 0],
    ['1d-5 cut', 1],
    ['1d-5x3 imp', 3],
  ]) {
    reset([[1]]);
    const batch = new DamageBatch({ spec: spec(text) });
    await batch.evaluate(roller());
    assert.equal(batch.results[0].damage, expected, text);
  }
});

test('separate rolls stay paired with recipients and reject changed selections', async () => {
  reset([
    [2, 2],
    [5, 5],
  ]);
  const batch = new DamageBatch({ spec: spec('2d(2) imp'), recipients, distribution: 'separate' });
  await batch.evaluate(roller());
  await batch.publish(create);
  assert.deepEqual(
    batch.seedsFor(recipients).map((s) => [s.damage, s.armorDivisor]),
    [
      [4, 2],
      [10, 2],
    ],
  );
  assert.equal(created[0].data.rolls.length, 2);
  assert.throws(() => batch.seedsFor(recipients.toReversed()));
  batch.used = true;
  assert.throws(() => batch.seedsFor(recipients));
});

test('explicit numeric bucket snapshot does not consume or execute costs', async () => {
  reset([[3]]);
  const list = [{ modint: 2, mod: '+2', desc: '*Costs 1FP' }];
  const bucket = { modifierStack: { modifierList: list } };
  assert.deepEqual(bucketSnapshot(false, bucket), []);
  const modifiers = bucketSnapshot(true, bucket);
  const batch = new DamageBatch({ spec: spec('1dx2 cut'), modifiers });
  list[0].modint = 8;
  await batch.evaluate(roller());
  await batch.publish(create);
  assert.equal(batch.results[0].damage, 10);
  assert.equal(list.length, 1);
  assert.match(created[0].data.content, /Effects and costs were not executed/);
});

test('chat failure and retry keep already rolled dice and use explicit visibility', async () => {
  reset([[4]]);
  const batch = new DamageBatch({ spec: spec('1d cr'), visibility: 'self' });
  await batch.evaluate(roller());
  await assert.rejects(batch.publish(async () => null));
  assert.throws(() => batch.seedsFor(recipients));
  await batch.evaluate(roller());
  await batch.publish(create);
  assert.equal(evaluations, 1);
  assert.equal(created[0].options.messageMode, 'self');
});

test('partial batch retry preserves earlier successful recipient rolls', async () => {
  reset([[2], [5]]);
  const native = roller();
  let calls = 0;
  const flaky = {
    _getDiceData: (...args) => native._getDiceData(...args),
    _createDraggableSection: (...args) => {
      if (++calls === 2) throw new Error('interrupted');
      return native._createDraggableSection(...args);
    },
  };
  const batch = new DamageBatch({ spec: spec('1d cr'), distribution: 'separate', recipients });
  await assert.rejects(batch.evaluate(flaky));
  assert.equal(batch.results.length, 1);
  await batch.evaluate(flaky);
  assert.deepEqual(
    batch.results.map((r) => r.damage),
    [2, 5],
  );
  assert.equal(evaluations, 2);
});

test('blind player results cannot enter a local application queue; chat escapes names', async () => {
  reset([[3]]);
  game.user.isGM = false;
  const batch = new DamageBatch({
    spec: spec('1d cr'),
    distribution: 'separate',
    recipients: [{ key: 'bad', name: '<img src=x onerror=alert(1)>' }],
    visibility: 'blind',
  });
  await batch.evaluate(roller());
  await batch.publish(create);
  assert.equal(batch.hidden, true);
  assert.throws(() => batch.seedsFor(batch.recipients), /Blind/);
  assert.equal(created[0].options.messageMode, 'blind');
  assert.doesNotMatch(created[0].data.content, /<img/);
  assert.match(created[0].data.content, /&lt;img/);
});
