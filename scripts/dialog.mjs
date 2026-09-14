import * as log from './log.mjs';
import { ID, canUse, commonValues, locationFor } from './core.mjs';

const rootOf = (element) => (element?.nodeType ? element : element?.[0]);

/** Extend only our own dialog. GGA still constructs the calculator, reads DR,
 * calculates injury, updates the actor, and creates its usual result cards. */
export function createManualDialogClass(NativeADD) {
  return class ManualDamageDialog extends NativeADD {
    constructor(session, recipient, seed) {
      const { location, fallback } = locationFor(recipient.actor, seed.hitlocation);
      // GGA 0.18.23 assumes an active GM exists when damage has no attacker.
      if (!game.users.find((u) => u.isGM && u.active)) {
        throw new Error(
          'Manual damage needs an active GM: GGA 0.18 currently assumes one exists for damage without an attacker.',
        );
      }
      super(
        recipient.actor,
        {
          attacker: null,
          dice: '',
          damage: seed.damage,
          damageType: seed.damageType,
          armorDivisor: seed.armorDivisor,
          damageModifier: seed.damageModifier ?? '',
          hitlocation: location,
          token: recipient.token,
        },
        {
          id: `${ID}-${foundry.utils.randomID()}`,
          classes: [...NativeADD.defaultOptions.classes, ID],
        },
      );
      this.rollInfo = seed.rollInfo;
      this.session = session;
      this.recipient = recipient;
      this.isSimpleDialog = false;
      this._calculator.hitLocation = location; // Includes GGA's Large-Area pseudo-location.
      if (seed.damageType === 'User Entered') {
        this._calculator.damageType = seed.damageType;
        this._calculator.userEnteredWoundModifier = seed.userEnteredWoundModifier;
      }
      this.sourceTokenName = 'Manual damage';
      this.sourceTokenImg = 'icons/svg/blood.svg';
      this.targetTokenName = recipient.name;
      this.targetTokenImg = recipient.document.texture?.src ?? recipient.actor.img;
      this.options.title = `Manual Damage: ${recipient.name} (${session.index + 1}/${session.recipients.length})`;
      this._manualReady = true;
      this._busy = false;
      this._applied = false;
      this._advancing = false;
      this._focusDamage = true;
      if (fallback)
        ui.notifications.warn(
          `${recipient.name}: "${seed.hitlocation}" is unavailable; review ${location} instead.`,
        );
    }

    // The native constructor may roll a random hit location or optional Body Hits
    // check. Defer constructor checks until explicitly requested in the ADD.
    async _adjustHitLocationIfNecessary() {
      if (!this._manualReady) return;
      return super._adjustHitLocationIfNecessary();
    }

    async getData(options) {
      const data = await super.getData(options);
      data.sourceTokenName = 'Manual damage';
      return data;
    }

    async _render(...args) {
      try {
        return await super._render(...args);
      } catch (error) {
        this.session?.finish(false);
        throw error;
      }
    }

    activateListeners(html) {
      super.activateListeners(html);
      const root = rootOf(html);
      const content = root.querySelector('.gga-app') ?? root;
      const panel = document.createElement('section');
      panel.className = 'manual-add-panel';
      const description = document.createElement('p');
      description.textContent = this._applied
        ? 'Applied. You can use the normal effect controls, then move to the next recipient.'
        : `Recipient ${this.session.index + 1} of ${this.session.recipients.length}: ${this.recipient.name}. Enter basic damage; calculated injury uses this actor’s DR and ADD options.`;
      panel.append(description);
      if (this.rollInfo) {
        const roll = document.createElement('p');
        roll.className = 'manual-roll-origin';
        roll.textContent = this.rollInfo + ' Changes in this ADD affect this recipient only.';
        panel.append(roll);
      }
      const controls = document.createElement('div');
      controls.className = 'manual-add-controls';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'manual-add-primary';
      apply.textContent =
        this.session.index < this.session.recipients.length - 1
          ? 'Apply calculated injury and next'
          : 'Apply calculated injury and close';
      apply.disabled = this._applied || this._busy;
      apply.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void this.submitInjuryApply(ev, false, this._calculator.showApplyAction);
      });
      const privacy = document.createElement('small');
      privacy.textContent = this._calculator.showApplyAction
        ? 'Public result'
        : 'Quiet result (GGA setting)';
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = this._applied ? 'Next / Finish' : 'Skip';
      next.disabled = this._busy;
      next.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.advance();
      });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel remaining';
      cancel.disabled = this._busy;
      cancel.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.close();
      });
      controls.append(apply, next, cancel, privacy);
      panel.append(controls);
      if (this.session.recipients.length > 1) {
        const note = document.createElement('small');
        note.textContent =
          this.session.index === 0 && !this.session.rollSeeds
            ? 'The basic damage, type, divisor, modifier, and location entered for this first recipient seed the remaining dialogs. Each recipient’s DR and other options are loaded afresh.'
            : 'Changes here affect this recipient only. Review location, distance, and other options before applying.';
        panel.append(note);
      }
      content.prepend(panel);
      // GGA's upper Apply is direct HP/FP/resource loss, not calculated injury.
      const direct = root.querySelector('#apply-publicly');
      if (direct?.tagName === 'BUTTON') direct.textContent = 'Apply directly (ignore DR)';
      const quiet = root.querySelector('#apply-secretly');
      if (quiet?.tagName === 'BUTTON') quiet.textContent = 'Apply directly, quietly (ignore DR)';
      root.querySelectorAll('[id^="apply-"]').forEach((el) => {
        if (this._applied && (el.tagName === 'BUTTON' || el.closest('.dropdown-content'))) {
          el.setAttribute('aria-disabled', 'true');
          if ('disabled' in el) el.disabled = true;
        }
      });
      if (this._focusDamage) {
        this._focusDamage = false;
        const input = root.querySelector('#basicDamage');
        input?.focus();
        input?.select();
      }
    }

    assertPermission() {
      if (!game.settings.get(ID, 'enabled')) throw new Error('Manual damage is disabled.');
      if (!canUse(this.actor, game.user, game.settings.get('gurps', 'only-gms-open-add'))) {
        throw new Error('You no longer have permission to apply damage to this actor.');
      }
      const scene = this.recipient.document.parent;
      if (scene?.tokens?.get && !scene.tokens.get(this.recipient.document.id)) {
        throw new Error(
          'This token was deleted. Cancel the queue and select the current recipients.',
        );
      }
    }

    readBasicDamage() {
      const input = rootOf(this.element)?.querySelector('#basicDamage');
      if (input) {
        const value = input.value.trim();
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
          throw new Error('Enter a non-negative whole number for basic damage.');
        }
        this._calculator.basicDamage = Number(value);
      }
      if (!Number.isSafeInteger(this._calculator.basicDamage) || this._calculator.basicDamage < 0) {
        throw new Error('Enter a non-negative whole number for basic damage.');
      }
    }

    // Both native button groups and the queue button enter the same guard.
    async submitDirectApply(keepOpen, publicly) {
      return this.applyManual(null, keepOpen, publicly, true);
    }

    async submitInjuryApply(event, keepOpen, publicly) {
      return this.applyManual(event, keepOpen, publicly, false);
    }

    async applyManual(event, keepOpen, publicly, direct) {
      if (this._busy || this._applied) return false;
      this._busy = true;
      try {
        this.assertPermission();
        this.readBasicDamage();
        if (!Number.isSafeInteger(this.timesToApply) || this.timesToApply < 1) {
          throw new Error('Number of applications must be a positive whole number.');
        }
        const [resource, path] = this._calculator.resource;
        if (!resource || !path || !Number.isFinite(resource.value))
          throw new Error('The recipient has no valid destination resource.');
        // Freeze common attack inputs before per-recipient calculations.
        this.session.capture(this._calculator);
        if (direct) {
          await this.resolveInjury(true, this._calculator.basicDamage, publicly);
        } else {
          // Run GGA's optional location checks only when the user applies damage.
          // Capture above preserves the chosen attack location, not a recipient's
          // randomly determined Vitals result, for subsequent recipients.
          await this._adjustHitLocationIfNecessary();
          const injury = this._calculator.pointsToApply;
          // Render GGA's current calculation for the result card. The visible
          // table may be one render behind a just-edited damage field.
          const current = await this._renderTemplate(
            'apply-damage-dialog.hbs',
            await this.getData(),
          );
          const results = $(current).find('.results-table').clone().html();
          for (let index = 0; index < this.timesToApply; index++) {
            await this.resolveInjury(true, injury, publicly, results);
          }
        }
        this._applied = true;
        this._busy = false;
        if (keepOpen) this.render(false);
        else await this.advance();
        return true;
      } catch (error) {
        log.error('Apply failed', error);
        ui.notifications.error(
          `Manual damage: ${error.message}${this._applied ? ' Some damage was already applied; this recipient is locked to prevent applying it again.' : ''}`,
        );
        this._busy = false;
        this.render(false);
        return false;
      }
    }

    async resolveInjury(keepOpen, injury, publicly, results = null) {
      this.assertPermission();
      if (!Number.isFinite(injury) || injury < 0)
        throw new Error('Calculated injury is invalid. Review the ADD inputs.');
      const answer = await super.resolveInjury(keepOpen, injury, publicly, results);
      // Mark after every successful update so a partial Apply Multiple failure
      // cannot replay damage already committed by earlier iterations.
      this._applied = true;
      return answer;
    }

    async _renderTemplate(template, data) {
      const html = await super._renderTemplate(template, data);
      if (template !== 'chat-damage-results.hbs') return html;
      return '<div class="manual-add-result"><strong>Manual damage</strong></div>' + html;
    }

    async advance() {
      if (this._busy || this._advancing) return;
      this._advancing = true;
      this.session.capture(this._calculator);
      await super.close();
      this.session.next();
    }

    async close(options) {
      if (this._busy) return this;
      if (!this._advancing) this.session.finish(false);
      return super.close(options);
    }
  };
}

export class RecipientSession {
  constructor(DialogClass, recipients, seed, onFinish, rollSeeds = null) {
    if (rollSeeds && rollSeeds.length !== recipients.length)
      throw new Error('Each recipient needs exactly one damage seed.');
    this.rollSeeds = rollSeeds?.map((item) => ({ ...item }));
    this.DialogClass = DialogClass;
    this.recipients = recipients;
    this.seed = seed;
    this.index = 0;
    this.done = false;
    this.captured = false;
    this.onFinish = onFinish;
    this.completion = new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  capture(calculator) {
    if (!this.captured && !this.rollSeeds) {
      this.seed = commonValues(calculator);
      this.captured = true;
    }
  }

  show() {
    if (this.done) return false;
    try {
      this.dialog = new this.DialogClass(this, this.recipients[this.index], {
        ...(this.rollSeeds?.[this.index] ?? this.seed),
      });
      this.dialog.render(true, { height: 'auto' });
      return true;
    } catch (error) {
      this.error = error;
      log.error('Open failed', error);
      ui.notifications.error(`Manual damage: ${error.message}`);
      this.finish(false);
      return false;
    }
  }

  next() {
    if (this.done) return;
    if (++this.index >= this.recipients.length) this.finish(true);
    else this.show();
  }

  finish(completed) {
    if (this.done) return;
    this.done = true;
    this.onFinish?.();
    this.resolve(completed);
  }
}
