import { validateSeed } from './core.mjs';
import { parseExpression, escapeHTML } from './rolls.mjs';
export const PROFILE_VERSION = 1;
const modes = ['uniform', 'explosion', 'cone'];
const visibilities = ['public', 'gm', 'blind', 'self'];
const pick = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new Error(`Invalid ${label}.`);
  return value;
};
const finite = (value, min, max, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${label}.`);
  return n;
};
export function normalizeProfile(
  profile,
  types = globalThis.GURPS?.DamageTables?.woundModifiers ?? {},
) {
  if (profile?.version !== PROFILE_VERSION)
    throw new Error('This damage profile needs a compatible Manual Damage version.');
  const kind = pick(profile.kind, ['damage', 'roller', 'area', 'fragmentation'], 'profile kind');
  const d = profile.settings ?? {};
  const settings = {};
  if (kind === 'damage') {
    Object.assign(
      settings,
      validateSeed(
        {
          ...d,
          damageType: d.damageType === 'User Entered' ? 'cr' : d.damageType,
          hitlocation: d.hitlocation || undefined,
        },
        types,
      ),
    );
    if (d.damageType === 'User Entered') {
      settings.damageType = 'User Entered';
      settings.userEnteredWoundModifier = finite(
        d.userEnteredWoundModifier,
        0,
        1000000,
        'custom wounding multiplier',
      );
    }
    settings.damageModifier = String(d.damageModifier ?? '').slice(0, 100);
    settings.isExplosion = Boolean(d.isExplosion);
    settings.isRangedHalfDamage = !settings.isExplosion && Boolean(d.isRangedHalfDamage);
    settings.isShotgun =
      !settings.isExplosion && !settings.isRangedHalfDamage && Boolean(d.isShotgun);
    settings.shotgunRofMultiplier = finite(
      d.shotgunRofMultiplier ?? 1,
      1,
      1000000,
      'shotgun multiplier',
    );
    // Range and defender modifiers are deliberately not attack-profile data.
  } else if (kind === 'roller') {
    settings.mode = pick(d.mode ?? 'roll', ['roll', 'fixed'], 'damage source');
    if (settings.mode === 'roll')
      settings.expression = parseExpression(
        d.expression,
        { hitlocation: d.hitlocation || undefined },
        types,
      ).expression;
    else
      Object.assign(
        settings,
        validateSeed({ ...d, hitlocation: d.hitlocation || undefined }, types),
      );
    if (d.hitlocation) settings.hitlocation = String(d.hitlocation).slice(0, 100);
    settings.distribution = pick(
      d.distribution ?? 'shared',
      ['shared', 'separate'],
      'roll distribution',
    );
    settings.includeBucket = Boolean(d.includeBucket);
    settings.visibility = pick(d.visibility ?? 'public', visibilities, 'visibility');
  } else if (kind === 'area') {
    settings.mode = pick(d.mode, modes, 'area mode');
    settings.input = pick(d.input, ['fixed', 'dice'], 'damage source');
    if (settings.input === 'dice')
      settings.expression = parseExpression(d.expression, {}, types).expression;
    else Object.assign(settings, validateSeed(d, types));
    settings.distribution = pick(
      d.distribution ?? 'separate',
      ['shared', 'separate'],
      'roll distribution',
    );
    settings.visibility = pick(d.visibility ?? 'public', visibilities, 'visibility');
    settings.radius =
      settings.mode === 'explosion' && settings.input === 'fixed'
        ? String(finite(d.radius, 0.001, 1000000000, 'blast radius'))
        : '';
  } else {
    const spec = parseExpression(d.expression, {}, types);
    if (spec.damageType !== 'cut' || spec.armorDivisor !== 1)
      throw new Error('Fragmentation profiles require cutting damage without an armour divisor.');
    settings.expression = spec.expression;
    settings.airburst = Boolean(d.airburst);
    settings.visibility = pick(d.visibility ?? 'public', visibilities, 'visibility');
  }
  return { version: PROFILE_VERSION, kind, settings };
}
export function calculatorProfile(calc) {
  return normalizeProfile({
    version: 1,
    kind: 'damage',
    settings: {
      damage: calc.basicDamage,
      damageType: calc.damageType,
      armorDivisor: calc.armorDivisor,
      hitlocation: calc.hitLocation,
      damageModifier: calc.damageModifier,
      userEnteredWoundModifier: calc.userEnteredWoundModifier,
      isExplosion: calc.isExplosion,
      isRangedHalfDamage: calc.isRangedHalfDamage,
      isShotgun: calc.isShotgun,
      shotgunRofMultiplier: calc.shotgunRofMultiplier,
    },
  });
}
export function profileCommand(profile) {
  const data = JSON.stringify(normalizeProfile(profile));
  return `const module = game.modules.get('gurps-manual-add');\nif (!module?.active || !module.api?.openProfile) { ui.notifications.warn('Enable Manual Damage 0.5.0 or later to use this profile.'); } else { await module.api.openProfile(${data}); }`;
}
let saving = false;
export async function saveDamageProfile(profile) {
  if (saving) return null;
  saving = true;
  try {
    const normalized = normalizeProfile(profile);
    const MacroClass = globalThis.Macro ?? globalThis.foundry?.documents?.Macro;
    if (!MacroClass?.canUserCreate(game.user) || !game.user.can('MACRO_SCRIPT'))
      throw new Error('You need permission to create and use script macros. Ask the GM.');
    const suggested = {
      damage: 'Damage',
      roller: 'Damage roll',
      area: 'Area attack',
      fragmentation: 'Fragmentation',
    }[normalized.kind];
    const result = await foundry.applications.api.DialogV2.input({
      window: { title: 'Save damage profile as macro' },
      position: { width: 440 },
      content: `<label>Macro name<input name="name" maxlength="100" value="${escapeHTML(suggested)}" required></label><p>${normalized.kind === 'damage' ? 'Saves the current basic damage as a fixed value. To roll fresh dice on every use, save from Roll damage instead. ' : ''}Saves attack settings only. Recipients, distances, DR, target traits, armour overrides and rolled results are not saved. Running this macro opens review; it never applies injury automatically.</p>`,
      ok: { label: 'Save macro', icon: 'fa-solid fa-floppy-disk' },
    });
    if (!result) return null;
    const name = String(result.name ?? '').trim();
    if (!name) throw new Error('Enter a macro name.');
    const macro = await MacroClass.create({
      name: name.slice(0, 100),
      type: 'script',
      img: 'icons/svg/dice-target.svg',
      command: profileCommand(normalized),
      ownership: { default: 0, [game.user.id]: 3 },
      flags: { 'gurps-manual-add': { profile: normalized } },
    });
    if (!macro) throw new Error('Macro creation did not complete.');
    ui.notifications.info(`Saved “${name}” in Macros. Drag it to your hotbar for quick use.`);
    return macro;
  } catch (error) {
    ui.notifications.error(`Save profile: ${error.message}`);
    return null;
  } finally {
    saving = false;
  }
}
