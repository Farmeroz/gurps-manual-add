import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, validateSeed, collectRecipients, locationFor } from '../scripts/core.mjs';
const types = { cr: {}, cut: {}, imp: {}, burn: {}, fat: {}, 'pi++': {} };

test('empty and prefilled commands, quoted locations, and aliases', () => {
  assert.deepEqual(validateSeed(parseCommand('/add'), types), {
    damage: 0,
    damageType: 'cr',
    armorDivisor: 1,
    hitlocation: undefined,
  });
  assert.deepEqual(
    validateSeed(parseCommand('/madd 12 cut location="Left Arm" divisor=2'), types),
    { damage: 12, damageType: 'cut', armorDivisor: 2, hitlocation: 'Left Arm' },
  );
  assert.equal(validateSeed(parseCommand('/add 15 pi++ divisor=0.5'), types).armorDivisor, 0.5);
  assert.equal(validateSeed(parseCommand('/add 15 burn divisor=-1'), types).armorDivisor, -1);
});

test('invalid damage, dice, types, options and quotes are rejected', () => {
  for (const command of [
    '/add 2d cut',
    '/add -3 cr',
    '/add 1.5 cr',
    '/add 4 huh',
    '/add 5 cr divisor=0',
    '/add 5 cr divisor=Infinity',
    '/add 5 cr loc=arm',
    '/add 5 cr location="Left Arm',
    '/add 9007199254740992 cr',
    '/add 5 cr divisor=2 divisor=3',
  ]) {
    assert.throws(() => validateSeed(parseCommand(command), types), command);
  }
});

function token(id, actor, linked = false) {
  return {
    actor,
    document: { id, uuid: `Scene.s.Token.${id}`, actorLink: linked, name: id, parent: { id: 's' } },
  };
}
test('linked actors deduplicate; independent NPC copies remain separate', () => {
  const actor = { id: 'a', uuid: 'Actor.a', isOwner: true };
  const result = collectRecipients(
    [token('a', actor, true), token('b', actor, true), token('c', actor), token('d', actor)],
    { isGM: true },
    true,
  );
  assert.equal(result.recipients.length, 3);
  assert.deepEqual(result.duplicates, ['b']);
});

test('GM-only and ownership enforced for each selected recipient', () => {
  const owned = token('a', { id: 'a', isOwner: true });
  const other = token('b', { id: 'b', isOwner: false });
  assert.equal(collectRecipients([owned, other], { isGM: false }, true).recipients.length, 0);
  assert.equal(collectRecipients([owned, other], { isGM: false }, false).recipients.length, 1);
  assert.equal(collectRecipients([owned, other], { isGM: true }, true).recipients.length, 2);
});

test('recipient body plan is respected and Random does not roll on opening', () => {
  const actor = {
    name: 'NPC',
    defaultHitLocation: 'Random',
    hitLocationsWithDR: [{ where: 'Torso' }, { where: 'Left Arm' }],
  };
  assert.deepEqual(locationFor(actor), { location: 'Torso', fallback: false });
  assert.deepEqual(locationFor(actor, 'left arm'), { location: 'Left Arm', fallback: false });
  assert.deepEqual(locationFor(actor, 'Tail'), { location: 'Torso', fallback: true });
  assert.equal(locationFor(actor, 'Large-Area').location, 'Large-Area');
});
