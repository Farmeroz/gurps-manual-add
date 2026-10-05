import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAGMENT_SKILL,
  actorSizeModifier,
  fragmentAttackTarget,
  fragmentHitCount,
  fragmentRange,
  fragmentSeed,
  randomHitLocation,
} from '../scripts/fragmentation.mjs';

test('B415 fragmentation range is five yards per damage die', () => {
  assert.equal(fragmentRange(1), 5);
  assert.equal(fragmentRange(2), 10);
  assert.equal(fragmentRange(6), 30);
});

test('fragment attack target uses skill 15 plus only range, posture and SM', () => {
  const target = fragmentAttackTarget({
    dice: 2,
    distance: 7,
    postureModifier: -2,
    sizeModifier: 1,
    rangeModifier: () => -3,
  });
  assert.equal(FRAGMENT_SKILL, 15);
  assert.deepEqual(target, { inRange: true, maximum: 10, target: 11, rangeModifier: -3 });
});

test('airburst ignores posture but retains range and SM', () => {
  const target = fragmentAttackTarget({
    dice: 3,
    distance: 4,
    postureModifier: -4,
    sizeModifier: -1,
    airburst: true,
    rangeModifier: () => -2,
  });
  assert.equal(target.target, 12);
});

test('targets beyond fragmentation range cannot be hit', () => {
  const target = fragmentAttackTarget({
    dice: 2,
    distance: 11,
    rangeModifier: () => 0,
  });
  assert.equal(target.inRange, false);
  assert.equal(fragmentHitCount({ attackRoll: 3, target: 18, inRange: false }), 0);
});

test('B415 gives one hit plus another per full three points of success', () => {
  assert.equal(fragmentHitCount({ attackRoll: 12, target: 11 }), 0);
  assert.equal(fragmentHitCount({ attackRoll: 11, target: 11 }), 1);
  assert.equal(fragmentHitCount({ attackRoll: 8, target: 11 }), 2);
  assert.equal(fragmentHitCount({ attackRoll: 5, target: 11 }), 3);
});

test('direct explosive hit guarantees one fragment hit without an attack roll', () => {
  assert.equal(fragmentHitCount({ directHit: true, inRange: true }), 1);
});

test('actor SM parses normal GGA sizemod text conservatively', () => {
  assert.equal(actorSizeModifier({ system: { traits: { sizemod: '+2' } } }), 2);
  assert.equal(actorSizeModifier({ system: { traits: { sizemod: '-1' } } }), -1);
  assert.equal(actorSizeModifier({ system: { traits: { sizemod: 'odd' } } }), 0);
});

test('random location follows the actor hit-location table and fragment seeds are cutting AD 1', () => {
  const actor = {
    name: 'Target',
    hitLocationsWithDR: [
      { where: 'Torso', roll: [9, 10, 11] },
      { where: 'Left Arm', roll: [8] },
    ],
  };
  assert.equal(randomHitLocation(actor, 8), 'Left Arm');
  assert.deepEqual(fragmentSeed(7, 'Left Arm', 'Fragment [2d]'), {
    damage: 7,
    damageType: 'cut',
    armorDivisor: 1,
    hitlocation: 'Left Arm',
    damageModifier: '',
    rollInfo: 'Fragment [2d]',
  });
});
