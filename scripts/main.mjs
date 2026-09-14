import * as log from './log.mjs';
import { ID, parseCommand, validateSeed, collectRecipients } from './core.mjs';
import { createManualDialogClass, RecipientSession } from './dialog.mjs';
import { registerHudIntegration } from './hud.mjs';
import { createWorkbenchClass } from './workbench.mjs';

let active = null,
  DialogClass = null,
  workbench = null,
  initialising = false;
const HELP =
  '/add opens the ADD; its Roll damage button opens an optional roller. /add 12 cut prefills fixed damage; /add 3d+2 cut prepares a standalone roll. Optional location="Left Arm", divisor=2, and rolls=shared or rolls=separate. /add roll opens the roller without requiring recipients. /madd is an alias. Rolling never applies injury.';

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

export function assertEnabled() {
  if (!setting('enabled')) throw new Error('Manual damage is disabled in module settings.');
  if (game.system.id !== 'gurps' || !/^0\.18\./.test(game.system.version))
    throw new Error('Manual damage requires GGA 0.18.x.');
}

export function readRecipients(options = {}, notify = false) {
  const supplied = options.tokens ?? (globalThis.canvas?.ready ? canvas.tokens.controlled : []);
  const tokens = Array.from(supplied, (token) =>
    typeof token === 'string' ? globalThis.canvas?.tokens?.get(token) : token,
  ).filter(Boolean);
  const { recipients, skipped, duplicates } = collectRecipients(
    tokens,
    game.user,
    game.settings.get('gurps', 'only-gms-open-add'),
  );
  if (notify && skipped.length)
    ui.notifications.warn(`Manual damage skipped ${skipped.length} token(s) without permission.`);
  if (notify && duplicates.length)
    ui.notifications.info(
      `Manual damage: ${duplicates.length} duplicate linked token(s) omitted; each shared actor is included once.`,
    );
  return recipients;
}

export async function startQueue(recipients, seed, rollSeeds = null) {
  assertEnabled();
  if (active || initialising) {
    active?.dialog?.bringToTop?.();
    throw new Error('Finish or cancel the current manual-damage queue first.');
  }
  if (!recipients.length) throw new Error('Select permitted recipient tokens first.');
  const current = readRecipients({ tokens: recipients.map((r) => r.token) });
  if (current.length !== recipients.length || current.some((r, i) => r.key !== recipients[i].key))
    throw new Error('Recipient permissions or identities changed. Refresh your selection.');
  if (
    recipients.some(
      (r) => r.document.parent?.tokens?.get && !r.document.parent.tokens.get(r.document.id),
    )
  )
    throw new Error('A recipient token was deleted. Refresh your selection.');
  initialising = true;
  try {
    await initialiseDialog();
    const session = new RecipientSession(
      DialogClass,
      recipients,
      seed,
      () => {
        active = null;
      },
      rollSeeds,
    );
    active = session;
    session.openRoller = (dialog) => {
      const target = session.rollTarget(dialog);
      const Workbench = createWorkbenchClass();
      const calculator = dialog._calculator;
      const roller = new Workbench(
        {
          roll: true,
          damageType: calculator.damageType,
          armorDivisor: calculator.armorDivisor,
          hitlocation: calculator.hitLocation,
        },
        {
          initialRecipients: target.recipients,
          readRecipients: () => target.recipients,
          assertEnabled: () => {
            assertEnabled();
            target.assertCurrent();
          },
          receiveRolls: (_recipients, seeds) => target.accept(seeds),
          returnTargetName: dialog.recipient.name,
        },
      );
      roller.options.id = `manual-damage-roller-${foundry.utils.randomID()}`;
      roller.options.title = `Roll damage: ${dialog.recipient.name}`;
      roller.render(true);
      return roller;
    };
    if (!session.show()) throw session.error ?? new Error('The ADD could not be opened.');
    return session;
  } finally {
    initialising = false;
  }
}

export async function open(options = {}) {
  try {
    assertEnabled();
    // Empty/numeric invocations open the ADD. Only explicit dice requests
    // open the standalone roller; neither entry point rolls on launch.
    if (options.expression || options.roll) {
      if (workbench?.rendered) {
        workbench.bringToTop();
        if (options.expression || options.roll)
          ui.notifications.info(
            'The existing damage workbench is still open. Edit it or close it before preparing a different command.',
          );
        return true;
      }
      const Workbench = createWorkbenchClass();
      workbench = new Workbench(options, {
        assertEnabled,
        initialRecipients: readRecipients(options, true),
        readRecipients: () => readRecipients({}, true),
        startQueue,
      });
      workbench.render(true);
      return true;
    }
    const seed = validateSeed(options, GURPS.DamageTables.woundModifiers);
    const session = await startQueue(readRecipients(options, true), seed);
    return await session.completion;
  } catch (error) {
    log.error(error);
    ui.notifications.error(`Manual damage: ${error.message}`);
    return false;
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
    hint: 'Allow fixed damage and damage rolls, with a separate ADD review. GGA’s application permissions still apply.',
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
        aliases.length ? `/${aliases[0]} [damage or dice] [type] – open Manual Damage` : null,
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
