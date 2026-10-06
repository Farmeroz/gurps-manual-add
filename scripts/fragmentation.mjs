export const FRAGMENT_SKILL = 15;

function whole(value, label, min = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min)
    throw new Error(`${label} must be a whole number of at least ${min}.`);
  return number;
}

export function fragmentRange(dice) {
  return whole(dice, 'Fragmentation dice', 1) * 5;
}

export function actorSizeModifier(actor) {
  const text = String(actor?.system?.traits?.sizemod ?? '0').trim();
  const match = /^[+-]?\d+$/.exec(text);
  return match ? Number(text) : 0;
}

export function fragmentAttackTarget({
  dice,
  distance,
  postureModifier = 0,
  sizeModifier = 0,
  airburst = false,
  rangeModifier,
}) {
  const maximum = fragmentRange(dice);
  const yards = Number(distance);
  if (!Number.isFinite(yards) || yards < 0)
    throw new Error('Fragment distance must be zero or more.');
  if (yards > maximum) return { inRange: false, maximum, target: null, rangeModifier: null };
  if (typeof rangeModifier !== 'function')
    throw new Error('A GURPS range-modifier service is required for fragmentation.');
  const range = Number(rangeModifier(Math.max(1, yards)));
  if (!Number.isFinite(range))
    throw new Error('Could not determine the fragmentation range modifier.');
  const posture = airburst ? 0 : Number(postureModifier);
  const sm = Number(sizeModifier);
  if (!Number.isFinite(posture) || !Number.isFinite(sm))
    throw new Error('Fragment posture and Size Modifier must be numbers.');
  return {
    inRange: true,
    maximum,
    target: FRAGMENT_SKILL + range + posture + sm,
    rangeModifier: range,
  };
}

export function fragmentHitCount({ directHit = false, attackRoll, target, inRange = true }) {
  if (!inRange) return 0;
  if (directHit) return 1;
  const roll = whole(attackRoll, 'Fragment attack roll', 3);
  if (roll > 18) throw new Error('Fragment attack roll cannot exceed 18.');
  if (!Number.isFinite(Number(target))) throw new Error('Fragment attack target is invalid.');
  // Ordinary GURPS success-roll limits still apply: 17-18 always fail,
  // while 3-4 always succeed even if modifiers drive effective skill lower.
  const effective = Number(target);
  const success = roll <= 4 || (roll <= 16 && roll <= effective);
  if (!success) return 0;
  return 1 + Math.max(0, Math.floor((effective - roll) / 3));
}

export function randomHitLocation(actor, roll) {
  const total = whole(roll, 'Hit-location roll', 3);
  if (total > 18) throw new Error('Hit-location roll cannot exceed 18.');
  const entries = actor?.hitLocationsWithDR ?? [];
  if (!entries.length) return 'User Entered'; // No invented anatomy; ADD requires manual DR review.
  const match = entries.find((entry) => Array.isArray(entry.roll) && entry.roll.includes(total));
  if (!match?.where)
    throw new Error(
      `${actor?.name ?? 'Recipient'} has no random hit location for a roll of ${total}.`,
    );
  return match.where;
}

export function fragmentSeed(damage, hitlocation, rollInfo = '') {
  const amount = whole(damage, 'Fragment damage');
  if (!String(hitlocation ?? '').trim()) throw new Error('Fragment hit location is required.');
  return {
    damage: amount,
    damageType: 'cut',
    armorDivisor: 1,
    hitlocation: String(hitlocation),
    damageModifier: '',
    ...(rollInfo ? { rollInfo } : {}),
  };
}
