export const ID = 'gurps-manual-add';
export const COMMAND = /^\/(?:add|madd)(?:\s|$)/i;

export function parseCommand(line) {
  if (!COMMAND.test(line.trim())) throw new Error('Use /add or /madd.');
  const input = line.trim().replace(/^\/\S+\s*/, '');
  const words = [];
  let word = '',
    quote = null,
    started = false;
  for (const char of input) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote) throw new Error('Close the quotation marks around the location.');
  if (started) words.push(word);
  if (words.length === 1 && /^(?:help|--help|\?)$/i.test(words[0])) return { help: true };
  if (words.length === 1 && words[0].toLowerCase() === 'roll') return { roll: true };
  const result = {};
  if (words.length && !words[0].includes('=')) result.damage = words.shift();
  if (words.length && !words[0].includes('=')) result.damageType = words.shift();
  for (const entry of words) {
    const match = /^(location|divisor|rolls)=(.+)$/i.exec(entry);
    if (!match)
      throw new Error(
        'Use /add [damage or dice] [type] [location="Left Arm"] [divisor=2] [rolls=shared|separate].',
      );
    const key = { location: 'hitlocation', divisor: 'armorDivisor', rolls: 'distribution' }[
      match[1].toLowerCase()
    ];
    if (key in result) throw new Error(`Specify ${match[1]} only once.`);
    result[key] = match[2];
  }
  if (result.distribution && !['shared', 'separate'].includes(result.distribution))
    throw new Error('Use rolls=shared or rolls=separate.');
  if (result.damage && /d/i.test(result.damage)) {
    result.expression = result.damage;
    delete result.damage;
  } else if (result.distribution) throw new Error('The rolls option requires a dice expression.');
  return result;
}

export function validateSeed(input = {}, damageTypes = {}) {
  if (input.damage !== undefined && !/^\d+$/.test(String(input.damage))) {
    throw new Error('Basic damage must be a non-negative whole number, not a dice formula.');
  }
  const damage = Number(input.damage ?? 0);
  if (!Number.isSafeInteger(damage) || damage < 0) throw new Error('Basic damage is out of range.');
  const requestedType = String(input.damageType ?? 'cr').toLowerCase();
  const damageType =
    Object.keys(damageTypes).find((key) => key.toLowerCase() === requestedType) ?? requestedType;
  if (!Object.hasOwn(damageTypes, damageType) || damageTypes[damageType].nodisplay) {
    throw new Error(
      `Unknown damage type: ${damageType}. Use a GGA abbreviation such as cr, cut, imp, pi, burn, tox, or fat.`,
    );
  }
  const armorDivisor = Number(input.armorDivisor ?? 1);
  if (!Number.isFinite(armorDivisor) || (armorDivisor <= 0 && armorDivisor !== -1)) {
    throw new Error('Armour divisor must be positive, or -1 to ignore DR.');
  }
  const hitlocation =
    input.hitlocation === undefined ? undefined : String(input.hitlocation).trim();
  if (hitlocation !== undefined && !hitlocation) throw new Error('Hit location cannot be empty.');
  return { damage, damageType, armorDivisor, hitlocation };
}

export function canUse(actor, user, gmOnly) {
  return Boolean(actor && user && (user.isGM || (!gmOnly && actor.isOwner)));
}

// Linked tokens share an Actor document; unlinked tokens own distinct synthetic actors.
export function collectRecipients(tokens, user, gmOnly) {
  const seen = new Set(),
    recipients = [],
    skipped = [],
    duplicates = [];
  for (const token of tokens) {
    const doc = token.document ?? token;
    const actor = token.actor ?? doc.actor;
    const name = doc.name ?? actor?.name ?? 'Token';
    if (!canUse(actor, user, gmOnly)) {
      skipped.push(name);
      continue;
    }
    const key = doc.actorLink
      ? (actor.uuid ?? `Actor.${actor.id}`)
      : (doc.uuid ?? actor.uuid ?? `${doc.parent?.id}.${doc.id}`);
    if (seen.has(key)) {
      duplicates.push(name);
      continue;
    }
    seen.add(key);
    recipients.push({ token: token.object ?? token, document: doc, actor, key, name });
  }
  return { recipients, skipped, duplicates };
}

export function locationFor(actor, requested) {
  const locations = actor.hitLocationsWithDR ?? [];
  const names = locations.map((x) => x.where);
  const wanted = requested ?? actor.defaultHitLocation;
  if (wanted === 'Large-Area') return { location: wanted, fallback: false };
  const match = names.find((x) => x.toLowerCase() === String(wanted).toLowerCase());
  if (match) return { location: match, fallback: false };
  // Opening a manual calculator must not trigger a default Random location roll.
  const location = names.find((x) => x === 'Torso') ?? names[0];
  if (!location)
    throw new Error(`${actor.name} has no hit locations. Add them on the actor sheet first.`);
  return { location, fallback: requested !== undefined };
}

export function commonValues(calculator) {
  return {
    damage: calculator.basicDamage,
    damageType: calculator.damageType,
    armorDivisor: calculator.armorDivisor,
    hitlocation: calculator.hitLocation,
    damageModifier: calculator.damageModifier,
    userEnteredWoundModifier:
      calculator.damageType === 'User Entered' ? calculator.userEnteredWoundModifier : undefined,
  };
}
