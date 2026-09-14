import { validateSeed } from './core.mjs';
import {
  DamageBatch,
  bucketSnapshot,
  defaultVisibility,
  escapeHTML,
  nativeDamageRoller,
  parseExpression,
} from './rolls.mjs';

const rootOf = (element) => (element?.nodeType ? element : element?.[0]);
const signed = (n) => (Number(n) ? `${Number(n) > 0 ? '+' : ''}${n}` : '');

export function createWorkbenchClass(Base = globalThis.Application) {
  return class ManualDamageWorkbench extends Base {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: 'manual-damage-workbench',
        title: 'Manual Damage',
        classes: ['gurps-manual-add', 'manual-damage-workbench'],
        width: 620,
        height: 'auto',
        resizable: true,
      });
    }

    constructor(options = {}, services) {
      super();
      this.services = { roller: nativeDamageRoller, ...services };
      this.recipients = this.services.initialRecipients ?? this.services.readRecipients();
      this.draft = {
        mode: options.expression || options.roll ? 'roll' : 'fixed',
        damage: String(options.damage ?? 0),
        expression: '3d cr',
        dice: '3',
        modifier: '0',
        multiplier: '1',
        damageType: options.damageType ?? 'cr',
        armorDivisor: String(options.armorDivisor ?? 1),
        hitlocation: options.hitlocation ?? '',
        distribution: options.distribution ?? 'shared',
        includeBucket: false,
        visibility: defaultVisibility(),
      };
      this.batch = null;
      this.busy = false;
      this.error = '';
      this.parseError = '';
      this.queueActive = false;
      this.handedOff = false;
      if (options.expression) this.setExpression(options.expression, options);
      else this.composeExpression();
    }

    types() {
      return GURPS.DamageTables.woundModifiers;
    }

    setExpression(expression, defaults) {
      this.draft.expression = expression;
      try {
        const spec = parseExpression(
          expression,
          defaults ?? {
            damageType: /\s+[a-z]/i.test(expression.trim()) ? undefined : this.draft.damageType,
            armorDivisor: expression.includes('(') ? undefined : this.draft.armorDivisor,
            hitlocation: this.draft.hitlocation || undefined,
          },
          this.types(),
        );
        this.draft.expression = spec.expression;
        for (const key of ['dice', 'modifier', 'multiplier', 'damageType', 'armorDivisor'])
          this.draft[key] = String(spec[key]);
        this.parseError = '';
      } catch (error) {
        this.parseError = error.message;
      }
    }

    composeExpression() {
      const d = this.draft;
      if (!/^\d+$/.test(d.dice) || !/^-?\d+$/.test(d.modifier) || !/^\d+$/.test(d.multiplier)) {
        this.parseError = 'Enter whole numbers for dice, modifier, and multiplier.';
        return;
      }
      this.setExpression(
        `${d.dice}d${signed(d.modifier)}${Number(d.multiplier) !== 1 ? `x${d.multiplier}` : ''}${Number(d.armorDivisor) !== 1 ? `(${d.armorDivisor})` : ''} ${d.damageType}`,
        { hitlocation: d.hitlocation || undefined },
      );
    }

    markup() {
      const choices = (values) =>
        values
          .map(
            ([value, label]) =>
              `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`,
          )
          .join('');
      const field = (key, label, attrs = 'type="text"') =>
        `<label>${label}<input data-field="${key}" name="${key}" ${attrs}></label>`;
      return `<form class="manual-workbench-form" autocomplete="off">
        <p>Enter fixed damage or roll dice, then review each recipient in the Apply Damage Dialog.</p>
        <label>Damage entry<select data-field="mode"><option value="fixed">Fixed number</option><option value="roll">Roll damage</option></select></label>
        <div class="manual-fixed-input">${field('damage', 'Basic damage', 'type="number" min="0" step="1"')}</div>
        <div class="manual-roll-inputs">
          ${field('expression', 'Damage expression', 'type="text" placeholder="3d+2 cut or 2d(2) imp" spellcheck="false"')}
          <div class="manual-roll-grid">${field('dice', 'Dice (d6)', 'type="number" min="1" max="1000" step="1"')}${field('modifier', 'Modifier', 'type="number" step="1"')}${field('multiplier', 'Multiplier', 'type="number" min="1" step="1"')}</div>
        </div>
        <div class="manual-roll-grid">
          <label>Damage type<select data-field="damageType">${choices(
            Object.entries(this.types())
              .filter(([, v]) => !v.nodisplay)
              .map(([key]) => [key, key]),
          )}</select></label>
          ${field('armorDivisor', 'Armour divisor', 'type="number" step="any"')}
          ${field('hitlocation', 'Hit location (optional)', 'type="text" placeholder="Actor default" list="manual-damage-locations"')}
        </div>
        <datalist id="manual-damage-locations">${choices([...new Set(this.recipients.flatMap((r) => (r.actor.hitLocationsWithDR ?? []).map((l) => l.where)))].map((name) => [name, name]))}</datalist>
        <div class="manual-roll-inputs">
          <label>Multiple recipients<select data-field="distribution"><option value="shared">One roll shared by all recipients</option><option value="separate">Roll separately for each recipient</option></select></label>
          <label>Roll visibility<select data-field="visibility">${choices([
            ['public', 'Public'],
            ['gm', 'GM and me'],
            ['blind', 'Blind to GM'],
            ['self', 'Only me'],
          ])}</select></label>
          <label class="manual-bucket-option"><input type="checkbox" data-field="includeBucket"> Include numeric modifier-bucket values</label>
          <small>The bucket is copied once per batch. Its entries remain in place; costs and other effects are not executed.</small>
        </div>
        <section class="manual-selection"><strong>Recipients</strong><p class="manual-recipient-names"></p><button type="button" data-action="refreshRecipients">Use currently selected tokens</button></section>
        <div class="manual-workbench-error" role="alert"></div>
        <section class="manual-roll-results" aria-live="polite"></section>
        <footer class="manual-workbench-actions"><button type="button" data-action="roll">Roll damage</button><button type="button" data-action="review">Review and apply</button><button type="button" data-action="close">Close</button></footer>
        <small>Rolling does not apply damage. Each ADD uses its recipient’s DR, armour layers, and injury options. Injury-result visibility follows the ADD’s own controls.</small>
      </form>`;
    }

    async _renderInner() {
      return $(this.markup());
    }

    activateListeners(html) {
      super.activateListeners(html);
      const root = rootOf(html);
      root.addEventListener('submit', (event) => event.preventDefault());
      root.addEventListener('input', (event) => {
        const node = event.target.closest('[data-field]');
        if (!node || this.busy || this.queueActive) return;
        const key = node.dataset.field;
        this.draft[key] = node.type === 'checkbox' ? node.checked : node.value;
        this.batch = null;
        this.handedOff = false;
        this.error = '';
        if (key === 'expression') this.setExpression(node.value);
        else if (['dice', 'modifier', 'multiplier', 'damageType', 'armorDivisor'].includes(key))
          this.composeExpression();
        this.refresh(root);
      });
      root.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        event.preventDefault();
        if (action === 'close') void this.close();
        else if (action === 'roll') void this.rollDamage();
        else if (action === 'review') void this.review();
        else if (action === 'refreshRecipients') this.refreshRecipients();
      });
      this.refresh(root);
    }

    refresh(root = rootOf(this.element)) {
      if (!root) return;
      const locked = this.busy || this.queueActive;
      root.querySelectorAll('[data-field]').forEach((node) => {
        node.disabled = locked;
        if (node === node.ownerDocument.activeElement) return;
        if (node.type === 'checkbox') node.checked = this.draft[node.dataset.field];
        else node.value = this.draft[node.dataset.field];
      });
      root.querySelectorAll('.manual-roll-inputs').forEach((node) => {
        node.hidden = this.draft.mode !== 'roll';
      });
      root.querySelector('.manual-fixed-input').hidden = this.draft.mode !== 'fixed';
      root.querySelector('.manual-recipient-names').textContent = this.recipients.length
        ? this.recipients.map((r) => r.name).join(', ')
        : 'No recipients selected. You can still make a shared roll for chat only.';
      root.querySelector('.manual-workbench-error').textContent =
        this.error || (this.draft.mode === 'roll' ? this.parseError : '');
      const results = root.querySelector('.manual-roll-results');
      if (this.batch?.hidden)
        results.textContent =
          'Blind damage roll: the result is visible to the GM in chat. Ask the GM to review and apply it.';
      else if (this.batch?.results.length)
        results.innerHTML = `<strong>${escapeHTML(this.batch.spec.expression)}</strong><ul>${this.batch.results.map((r) => `<li>${escapeHTML(r.target)}: <strong>${r.damage} basic damage</strong> <small>${escapeHTML([r.explainLineOne, r.explainLineTwo].filter(Boolean).join(' '))}</small></li>`).join('')}</ul><p>${this.handedOff ? 'Sent to the ADD queue. Roll again to start a new damage event.' : this.batch.messageId ? 'Recorded in chat. Ready for review; damage has not been applied.' : 'The roll is not yet recorded in chat. Retry keeps these dice.'}</p>`;
      else results.textContent = this.queueActive ? 'The ADD queue is open.' : '';
      const roll = root.querySelector('[data-action="roll"]');
      roll.hidden = this.draft.mode !== 'roll';
      roll.disabled = locked || Boolean(this.parseError);
      roll.textContent = this.busy
        ? 'Working…'
        : this.batch && !this.batch.messageId
          ? 'Retry: keep existing dice'
          : this.batch
            ? 'Roll again'
            : 'Roll damage';
      const review = root.querySelector('[data-action="review"]');
      review.disabled =
        locked ||
        this.handedOff ||
        !this.recipients.length ||
        (this.draft.mode === 'roll' && (!this.batch?.messageId || this.batch.hidden));
      root.querySelector('[data-action="refreshRecipients"]').disabled = locked || this.handedOff;
      root.querySelector('[data-action="close"]').disabled = this.busy;
    }

    refreshRecipients() {
      if (this.busy || this.queueActive || this.handedOff) return;
      try {
        this.recipients = this.services.readRecipients();
        if (this.batch?.distribution === 'separate') {
          this.batch = null;
          this.error = 'Selection updated. Roll again for these recipients.';
        } else this.error = '';
      } catch (error) {
        this.error = error.message;
      }
      this.refresh();
    }

    async rollDamage() {
      if (this.busy || this.queueActive) return false;
      this.busy = true;
      this.error = '';
      this.refresh();
      try {
        this.services.assertEnabled();
        if (this.parseError) throw new Error(this.parseError);
        if (!this.batch || this.batch.messageId) {
          const spec = parseExpression(
            this.draft.expression,
            { hitlocation: this.draft.hitlocation || undefined },
            this.types(),
          );
          this.batch = new DamageBatch({
            spec,
            recipients: this.recipients,
            distribution: this.draft.distribution,
            modifiers: bucketSnapshot(this.draft.includeBucket),
            visibility: this.draft.visibility,
          });
          this.handedOff = false;
        }
        await this.batch.evaluate(await this.services.roller());
        await this.batch.publish(this.services.createMessage);
        return true;
      } catch (error) {
        this.error = error.message;
        return false;
      } finally {
        this.busy = false;
        this.refresh();
      }
    }

    async review() {
      if (this.busy || this.queueActive || this.handedOff) return false;
      this.busy = true;
      this.error = '';
      this.refresh();
      try {
        this.services.assertEnabled();
        const seeds = this.draft.mode === 'roll' ? this.batch?.seedsFor(this.recipients) : null;
        if (this.draft.mode === 'roll' && !seeds)
          throw new Error('Roll damage before reviewing it.');
        const seed =
          seeds?.[0] ??
          validateSeed(
            { ...this.draft, hitlocation: this.draft.hitlocation || undefined },
            this.types(),
          );
        const session = await this.services.startQueue(this.recipients, seed, seeds);
        // Consume the batch only after the ADD session is created. Closing or
        // partially applying a queue does not make that batch reusable.
        if (this.batch) this.batch.used = true;
        this.handedOff = true;
        this.queueActive = true;
        session.completion.finally(() => {
          this.queueActive = false;
          this.refresh();
        });
        return true;
      } catch (error) {
        this.error = error.message;
        return false;
      } finally {
        this.busy = false;
        this.refresh();
      }
    }

    async close(options) {
      if (this.busy) return this;
      return super.close(options);
    }
  };
}
