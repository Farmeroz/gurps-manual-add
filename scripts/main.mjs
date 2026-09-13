import { ID, parseCommand, validateSeed, collectRecipients } from './core.mjs';
import { createManualDialogClass, RecipientSession } from './dialog.mjs';
import { registerHudIntegration } from './hud.mjs';

let active = null,
  DialogClass = null,
  initialising = false;
const HELP =
  '/add [damage] [type] [location="Left Arm"] [divisor=2]. Select recipient tokens first. Example: /add 12 cut location="Left Arm" divisor=2. /madd is an alias. No dice are rolled.';

function setting(key) {
  return game.settings.get(ID, key);
}

async function initialiseDialog() {
  if (DialogClass) return;
  if (game.system.id !== 'gurps' || !/^0\.18\./.test(game.system.version)) {
    throw new Error(
      'This release supports GGA 0.18.x. A changed GGA API needs a compatibility review.',
    );
  }
  const NativeADD =
    globalThis.GURPS?.ApplyDamageDialog ??
    (await import(foundry.utils.getRoute('systems/gurps/module/damage/applydamage.js'))).default;
  for (const method of [
    'getData',
    'activateListeners',
    'submitInjuryApply',
    'resolveInjury',
    '_renderTemplate',
  ]) {
    if (typeof NativeADD?.prototype?.[method] !== 'function')
      throw new Error(`GGA ADD is missing ${method}.`);
  }
  DialogClass = createManualDialogClass(NativeADD);
}

export async function open(options = {}) {
  if (active) {
    active.dialog?.bringToTop?.();
    ui.notifications.warn('Finish or cancel the current manual-damage queue first.');
    return false;
  }
  if (initialising) return false;
  initialising = true;
  try {
    if (!setting('enabled')) throw new Error('Manual damage is disabled in module settings.');
    if (!canvas?.ready) throw new Error('Open a scene and select recipient tokens first.');
    const gmOnly = game.settings.get('gurps', 'only-gms-open-add');
    if (gmOnly && !game.user.isGM)
      throw new Error('GGA is configured to allow only GMs to open the ADD.');
    const seed = validateSeed(options, GURPS.DamageTables.woundModifiers);
    const supplied = options.tokens ?? canvas.tokens.controlled;
    const tokens = Array.from(supplied, (token) =>
      typeof token === 'string' ? canvas.tokens.get(token) : token,
    ).filter(Boolean);
    if (!tokens.length) throw new Error('Select at least one recipient token first.');
    const { recipients, skipped, duplicates } = collectRecipients(tokens, game.user, gmOnly);
    if (skipped.length)
      ui.notifications.warn(
        `Manual damage skipped ${skipped.length} token(s) without an owned actor or permission.`,
      );
    if (duplicates.length)
      ui.notifications.info(
        `Manual damage: ${duplicates.length} duplicate linked token(s) omitted; each shared actor is included once.`,
      );
    if (!recipients.length) throw new Error('No permitted recipient actors were selected.');
    await initialiseDialog();
    const session = new RecipientSession(DialogClass, recipients, seed, () => {
      active = null;
    });
    active = session;
    initialising = false;
    session.show();
    return await session.completion;
  } catch (error) {
    console.error(`${ID} |`, error);
    ui.notifications.error(`Manual damage: ${error.message}`);
    return false;
  } finally {
    initialising = false;
  }
}

export async function command(line) {
  try {
    const options = parseCommand(line);
    if (options.help) {
      ui.notifications.info(HELP, { permanent: true });
      return true;
    }
    return await open(options);
  } catch (error) {
    ui.notifications.error(`Manual damage: ${error.message}`);
    return false;
  }
}

Hooks.once('init', () => {
  game.settings.register(ID, 'enabled', {
    name: 'Enable manual damage',
    hint: 'Allow opening GGA’s full ADD without a damage roll. GGA’s ADD permissions still apply.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
  });
  game.settings.register(ID, 'hudButton', {
    name: 'Show Manual Damage on token HUD',
    hint: 'Add a calculator button and a Manual Damage entry to supported token context menus.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });
});

Hooks.once('ready', () => {
  if (game.system.id !== 'gurps') return;
  game.modules.get(ID).api = Object.freeze({ open, command });
  const registry = globalThis.GURPS?.ChatProcessors;
  if (typeof registry?.registerProcessor === 'function') {
    // Register with GGA itself so chat macros and OtF use the same processor.
    // Do not intercept chat separately, which would miss OtF or handle it twice.
    const existing = [...registry.processorsForAll(), ...registry.processorsForGMOnly()];
    const aliases = ['add', 'madd'].filter((alias) => {
      const conflict = existing.some(
        (p) => p.matches(`/${alias}`) || p.matches(`/${alias} 12 cut`),
      );
      if (conflict)
        ui.notifications.warn(
          `Manual damage: /${alias} is already registered; use the other alias or module API.`,
        );
      return !conflict;
    });
    const processor = {
      registry: null,
      matches: (line) =>
        aliases.some((alias) => new RegExp(`^/${alias}(?:\\s|$)`, 'i').test(line.trim())),
      usagematches: () => false,
      help: () =>
        aliases.length
          ? `/${aliases[0]} [damage] [type] – open Manual Damage for selected tokens`
          : null,
      isGMOnly: () => false,
      process: (line) => command(line),
    };
    if (aliases.length) registry.registerProcessor(processor);
  } else {
    ui.notifications.warn(
      'Manual damage: GGA chat integration is unavailable. Use the HUD or JavaScript API.',
    );
  }
  registerHudIntegration(open);
});
