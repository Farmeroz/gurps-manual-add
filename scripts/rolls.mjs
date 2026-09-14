import { ID, validateSeed } from './core.mjs';

export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Deliberately accept a complete, bounded damage expression, never a partial
// match or arbitrary Foundry formula. GGA owns the actual roll and minimums.
export function parseExpression(expression, defaults = {}, types = {}) {
  const text = String(expression).trim().replace(/−/g, '-');
  const match =
    /^(\d+)d(?:6)?([+-]\d+)?(?:[xX×*](\d+))?(?:\((-?\d+(?:\.\d+)?)\))?(?:\s+([a-z][a-z0-9+-]*))?$/i.exec(
      text,
    );
  if (!match)
    throw new Error(
      'Use a complete damage expression such as 3d+2 cut or 2d(2) imp. Only six-sided damage dice are supported.',
    );
  const dice = Number(match[1]),
    modifier = Number(match[2] ?? 0),
    multiplier = Number(match[3] ?? 1);
  if (!Number.isSafeInteger(dice) || dice < 1 || dice > 1000)
    throw new Error('Use between 1 and 1000 damage dice.');
  if (!Number.isSafeInteger(modifier) || Math.abs(modifier) > 1000000)
    throw new Error('Damage modifier is out of range.');
  if (!Number.isSafeInteger(multiplier) || multiplier < 1 || multiplier > 1000000)
    throw new Error('Use a whole-number multiplier from 1 to 1000000.');
  if (
    match[4] !== undefined &&
    defaults.armorDivisor !== undefined &&
    Number(match[4]) !== Number(defaults.armorDivisor)
  )
    throw new Error(
      'The expression and divisor option disagree. Specify the divisor in one place.',
    );
  if (
    match[5] &&
    defaults.damageType &&
    match[5].toLowerCase() !== String(defaults.damageType).toLowerCase()
  )
    throw new Error('The expression and damage-type option disagree.');
  const seed = validateSeed(
    {
      damage: 0,
      damageType: match[5] ?? defaults.damageType,
      armorDivisor: match[4] ?? defaults.armorDivisor,
      hitlocation: defaults.hitlocation,
    },
    types,
  );
  // Use × internally: GGA's legacy adds parser can absorb an ASCII x into
  // the preceding modifier (for example +2x3), losing the multiplier.
  const formula = `${dice}d${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''}${multiplier !== 1 ? `×${multiplier}` : ''}${seed.armorDivisor !== 1 ? `(${seed.armorDivisor})` : ''}`;
  return {
    ...seed,
    dice,
    modifier,
    multiplier,
    formula,
    expression: `${formula} ${seed.damageType}`,
  };
}

export function bucketSnapshot(include, bucket = globalThis.GURPS?.ModifierBucket) {
  if (!include) return [];
  const list = bucket?.modifierStack?.modifierList;
  if (!Array.isArray(list))
    throw new Error('The modifier bucket is unavailable. Untick its option to roll without it.');
  return list.map((entry) => {
    const modint = Number(entry.modint ?? entry.mod);
    if (!Number.isSafeInteger(modint))
      throw new Error('A bucket modifier is not a whole number. Review the bucket before rolling.');
    return { modint, mod: `${modint >= 0 ? '+' : ''}${modint}`, desc: String(entry.desc ?? '') };
  });
}

export function defaultVisibility() {
  try {
    const mode = game.settings.get('core', 'messageMode');
    if (['public', 'gm', 'blind', 'self'].includes(mode)) return mode;
  } catch {
    /* A missing setting should not prevent opening the editor. */
  }
  return 'public';
}

export async function nativeDamageRoller() {
  if (game.system.id !== 'gurps' || !/^0\.18\./.test(game.system.version))
    throw new Error('Manual damage rolling requires GGA 0.18.x.');
  const Native = (await import(foundry.utils.getRoute('systems/gurps/module/damage/damagechat.js')))
    .default;
  if (
    typeof Native?.prototype?._getDiceData !== 'function' ||
    typeof Native?.prototype?._createDraggableSection !== 'function'
  )
    throw new Error('GGA’s damage roller has changed. A compatibility update is needed.');
  return new Native();
}

export class DamageBatch {
  constructor({
    spec,
    recipients = [],
    distribution = 'shared',
    modifiers = [],
    visibility = 'public',
  }) {
    if (!['shared', 'separate'].includes(distribution))
      throw new Error('Choose shared or separate damage rolls.');
    if (!['public', 'gm', 'blind', 'self'].includes(visibility))
      throw new Error('Choose a valid roll visibility.');
    if (distribution === 'separate' && !recipients.length)
      throw new Error('Select recipients before rolling separately.');
    if (spec.dice * (distribution === 'separate' ? recipients.length : 1) > 10000)
      throw new Error('This batch would roll more than 10000 dice. Use fewer recipients or dice.');
    this.spec = Object.freeze({ ...spec });
    this.recipients = recipients.slice();
    this.distribution = distribution;
    this.modifiers = modifiers.map((m) => ({ ...m }));
    this.visibility = visibility;
    this.results = [];
    this.messageId = null;
    this.used = false;
    this.running = null;
    this.publishing = null;
  }

  get count() {
    return this.distribution === 'separate' ? this.recipients.length : 1;
  }
  get complete() {
    return this.results.length === this.count;
  }
  get hidden() {
    return this.visibility === 'blind' && !game.user.isGM;
  }

  async evaluate(roller) {
    if (this.running) return this.running;
    this.running = (async () => {
      // Successful earlier rolls survive a later failure. Retrying completes
      // the missing rolls rather than silently replacing recorded dice.
      while (this.results.length < this.count) {
        const target =
          this.distribution === 'separate'
            ? this.recipients[this.results.length].name
            : 'Shared roll';
        const dice = roller._getDiceData(
          this.spec.formula,
          this.spec.damageType,
          this.modifiers,
          null,
          null,
        );
        if (!dice) throw new Error('GGA could not interpret this damage expression.');
        const data = await roller._createDraggableSection(
          { id: null },
          dice,
          target,
          this.modifiers,
          this.spec.hitlocation,
        );
        if (!Number.isSafeInteger(data.damage) || data.damage < 0)
          throw new Error('GGA returned an invalid damage total.');
        this.results.push(data);
      }
      return this;
    })();
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  async publish(create = (data, options) => ChatMessage.create(data, options)) {
    if (this.messageId) return this.messageId;
    if (this.publishing) return this.publishing;
    if (!this.complete) throw new Error('Complete the damage rolls before recording the result.');
    this.publishing = (async () => {
      const lines = this.results
        .map(
          (r) =>
            `<li><strong>${escapeHTML(r.target)}: ${r.damage} basic damage</strong><br>${escapeHTML([r.explainLineOne, r.explainLineTwo].filter(Boolean).join(' '))}${r.isB378 ? ' (GGA minimum damage applied.)' : ''}</li>`,
        )
        .join('');
      const mods = this.modifiers.length
        ? `<p>Bucket numbers: ${this.modifiers.map((m) => `${m.mod} ${escapeHTML(m.desc)}`).join('; ')}. Effects and costs were not executed.</p>`
        : '';
      const message = await create(
        {
          user: game.user.id,
          speaker: { alias: `${game.user.name} – Manual damage` },
          content: `<section class="manual-add-roll-result"><h3>Manual damage: ${escapeHTML(this.spec.expression)}</h3><ol>${lines}</ol>${mods}<p>Damage rolled only. Injury has not been applied.</p></section>`,
          rolls: this.results.map((r) => r.roll),
          flags: {
            [ID]: {
              damageRoll: true,
              expression: this.spec.expression,
              distribution: this.distribution,
            },
          },
          sound: globalThis.CONFIG?.sounds?.dice,
        },
        { messageMode: this.visibility },
      );
      if (!message?.id)
        throw new Error(
          'The roll could not be recorded in chat. Use Retry to record the same dice.',
        );
      this.messageId = message.id;
      return this.messageId;
    })();
    try {
      return await this.publishing;
    } finally {
      this.publishing = null;
    }
  }

  seedsFor(recipients) {
    if (!this.complete || !this.messageId || this.used)
      throw new Error('Roll and record fresh damage before opening another application queue.');
    if (this.hidden)
      throw new Error(
        'Blind damage results are for the GM. Ask the GM to review and apply the damage.',
      );
    if (
      this.distribution === 'separate' &&
      (recipients.length !== this.recipients.length ||
        recipients.some((r, i) => r.key !== this.recipients[i].key))
    )
      throw new Error('The recipients changed. Roll again for the new selection.');
    return recipients.map((_r, i) => {
      const result = this.results[this.distribution === 'separate' ? i : 0];
      return {
        damage: result.damage,
        damageType: this.spec.damageType,
        armorDivisor: this.spec.armorDivisor,
        hitlocation: this.spec.hitlocation,
        rollInfo: `${this.spec.expression}: ${result.damage} basic damage. Roll recorded in chat.`,
      };
    });
  }
}
