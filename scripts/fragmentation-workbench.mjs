import {
  actorSizeModifier,
  fragmentAttackTarget,
  fragmentHitCount,
  fragmentRange,
  fragmentSeed,
  randomHitLocation,
} from './fragmentation.mjs';
import { escapeHTML, nativeDamageRoller, parseExpression } from './rolls.mjs';

const rootOf = (element) => (element?.nodeType ? element : element?.[0]);
const POSTURES = [
  ['standing', 'Standing', 0],
  ['crouching', 'Crouching', -2],
  ['kneeling', 'Kneeling', -2],
  ['crawling', 'Crawling', -2],
  ['sitting', 'Sitting', -2],
  ['lying', 'Lying down', -2],
];

function roll3d() {
  return Roll.create('3d');
}

async function evaluateRoll(roll) {
  await roll.evaluate();
  if (!Number.isSafeInteger(roll.total)) throw new Error('GURPS returned an invalid 3d roll.');
  return roll;
}

function rangeModifier(yards) {
  const ssrt = globalThis.GURPS?.SSRT;
  if (typeof ssrt?.getModifier !== 'function')
    throw new Error('GGA Size and Speed/Range Table service is unavailable.');
  return ssrt.getModifier(yards);
}

export function createFragmentationWorkbenchClass(Base = globalThis.Application) {
  return class FragmentationWorkbench extends Base {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: 'manual-damage-fragmentation',
        title: 'Fragmentation',
        classes: ['gurps-manual-add', 'manual-fragmentation-workbench'],
        width: 680,
        height: 'auto',
        resizable: true,
      });
    }

    constructor(recipients, services = {}) {
      super();
      this.recipients = recipients.slice();
      this.services = {
        assertEnabled: () => {},
        startEvents: null,
        roller: nativeDamageRoller,
        createMessage: (data, options) => ChatMessage.create(data, options),
        ...services,
      };
      this.draft = {
        expression: '2d cut',
        dice: '2',
        modifier: '0',
        airburst: false,
        visibility: 'public',
      };
      this.rows = Object.fromEntries(
        this.recipients.map((recipient) => [
          recipient.key,
          {
            distance: '1',
            posture: 'standing',
            directHit: false,
          },
        ]),
      );
      this.events = null;
      this.summary = [];
      this.rolls = [];
      this.busy = false;
      this.error = '';
      this.handedOff = false;
    }

    markup() {
      const postureOptions = POSTURES.map(
        ([value, label]) => `<option value="${value}">${label}</option>`,
      ).join('');
      const rows = this.recipients
        .map((recipient) => {
          const sm = actorSizeModifier(recipient.actor);
          return `<tr data-recipient="${escapeHTML(recipient.key)}"><td><strong>${escapeHTML(recipient.name)}</strong><small>SM ${sm >= 0 ? '+' : ''}${sm}</small></td><td><input data-frag-field="distance" type="number" min="0" step="1" value="1" aria-label="${escapeHTML(recipient.name)} distance"></td><td><select data-frag-field="posture" aria-label="${escapeHTML(recipient.name)} posture">${postureOptions}</select></td><td><input data-frag-field="directHit" type="checkbox" aria-label="${escapeHTML(recipient.name)} direct hit"></td></tr>`;
        })
        .join('');
      return `<form class="manual-fragmentation-form" autocomplete="off">
        <p>Resolve GURPS 4e fragmentation (B415).  This helper determines fragment hits and random hit locations, then sends each actual hit to the normal ADD.</p>
        <div class="manual-roll-grid">
          <label>Fragment damage<input data-field="expression" value="2d cut" spellcheck="false"></label>
          <label>Airburst<input data-field="airburst" type="checkbox"></label>
          <label>Roll visibility<select data-field="visibility"><option value="public">Public</option><option value="gm">GM and me</option><option value="blind">Blind to GM</option><option value="self">Only me</option></select></label>
        </div>
        <small>Fragmentation is cutting damage with no inherited armour divisor.  Danger radius is 5 yards per damage die.  Airbursts ignore posture modifiers.</small>
        <table class="manual-fragment-table"><thead><tr><th>Recipient</th><th>Distance (yd)</th><th>Posture</th><th>Direct hit</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="manual-workbench-error" role="alert"></div>
        <section class="manual-roll-results" aria-live="polite"></section>
        <footer class="manual-workbench-actions"><button type="button" data-action="resolveFragments">Resolve fragments</button><button type="button" data-action="reviewFragments">Review hits in ADD</button><button type="button" data-action="close">Close</button></footer>
        <small>Direct hit guarantees one fragment hit and ignores distance for the fragment attack.  Otherwise fragments attack at skill 15 with only range, posture, and SM modifiers.  Each hit rolls location randomly.  If that location is behind cover, B415 says the fragment hits the cover instead; Skip that ADD hit.</small>
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
        if (this.busy || this.handedOff) return;
        const field = event.target.closest('[data-field]');
        if (field) {
          this.draft[field.dataset.field] = field.type === 'checkbox' ? field.checked : field.value;
          this.events = null;
          this.summary = [];
          this.rolls = [];
        }
        const row = event.target.closest('[data-recipient]');
        const frag = event.target.closest('[data-frag-field]');
        if (row && frag) {
          const state = this.rows[row.dataset.recipient];
          state[frag.dataset.fragField] = frag.type === 'checkbox' ? frag.checked : frag.value;
          this.events = null;
          this.summary = [];
          this.rolls = [];
        }
        this.error = '';
        this.refresh(root);
      });
      root.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        event.preventDefault();
        if (action === 'close') void this.close();
        else if (action === 'resolveFragments') void this.resolveFragments();
        else if (action === 'reviewFragments') void this.reviewFragments();
      });
      this.refresh(root);
    }

    refresh(root = rootOf(this.element)) {
      if (!root) return;
      const locked = this.busy || this.handedOff;
      root.querySelectorAll('input, select, button').forEach((node) => {
        if (node.dataset.action === 'close') node.disabled = this.busy;
        else node.disabled = locked;
      });
      const output = root.querySelector('.manual-roll-results');
      const blind = this.draft.visibility === 'blind' && !game.user.isGM;
      output.innerHTML = blind
        ? this.summary.length
          ? '<p>Blind fragmentation result: details are visible to the GM in chat.</p>'
          : ''
        : this.summary.length
          ? `<ul>${this.summary.map((line) => `<li>${escapeHTML(line)}</li>`).join('')}</ul><p>${this.events?.length ? `${this.events.length} fragment hit(s) ready for ADD review.` : 'No fragment hits.'}</p>`
          : '';
      root.querySelector('.manual-workbench-error').textContent = this.error;
      const review = root.querySelector('[data-action="reviewFragments"]');
      review.disabled =
        locked || !this.events?.length || (this.draft.visibility === 'blind' && !game.user.isGM);
      root.querySelector('[data-action="resolveFragments"]').textContent = this.busy
        ? 'Working…'
        : this.events
          ? 'Roll again'
          : 'Resolve fragments';
    }

    async fragmentDamage(roller, spec, targetName) {
      const dice = roller._getDiceData(spec.formula, 'cut', [], null, null);
      if (!dice) throw new Error('GGA could not interpret the fragmentation damage expression.');
      const data = await roller._createDraggableSection({ id: null }, dice, targetName, [], null);
      if (!Number.isSafeInteger(data.damage) || data.damage < 0)
        throw new Error('GGA returned invalid fragmentation damage.');
      return data;
    }

    async resolveFragments() {
      if (this.busy || this.handedOff) return false;
      this.busy = true;
      this.error = '';
      this.events = null;
      this.summary = [];
      this.rolls = [];
      this.refresh();
      try {
        this.services.assertEnabled();
        const spec = parseExpression(
          this.draft.expression,
          { damageType: 'cut', armorDivisor: 1 },
          GURPS.DamageTables.woundModifiers,
        );
        if (spec.damageType !== 'cut' || spec.armorDivisor !== 1)
          throw new Error(
            'Fragmentation damage is cutting and does not inherit an armour divisor.',
          );
        const roller = await this.services.roller();
        const events = [],
          summary = [],
          rolls = [];
        for (const recipient of this.recipients) {
          const row = this.rows[recipient.key];
          const distance = Number(row.distance);
          const posture = POSTURES.find(([value]) => value === row.posture)?.[2] ?? 0;
          const target = fragmentAttackTarget({
            dice: spec.dice,
            distance: row.directHit ? 0 : distance,
            postureModifier: posture,
            sizeModifier: actorSizeModifier(recipient.actor),
            airburst: this.draft.airburst,
            rangeModifier,
          });
          if (!target.inRange) {
            summary.push(`${recipient.name}: outside ${target.maximum}-yard fragment radius.`);
            continue;
          }
          let attackRoll = null,
            hits;
          if (row.directHit) hits = fragmentHitCount({ directHit: true, inRange: true });
          else {
            attackRoll = await evaluateRoll(roll3d());
            rolls.push(attackRoll);
            hits = fragmentHitCount({
              attackRoll: attackRoll.total,
              target: target.target,
              inRange: true,
            });
          }
          if (!hits) {
            summary.push(
              `${recipient.name}: no fragment hit${attackRoll ? ` (rolled ${attackRoll.total} vs ${target.target})` : ''}.`,
            );
            continue;
          }
          const details = [];
          for (let i = 0; i < hits; i++) {
            const locRoll = await evaluateRoll(roll3d());
            rolls.push(locRoll);
            const location = randomHitLocation(recipient.actor, locRoll.total);
            const damage = await this.fragmentDamage(roller, spec, recipient.name);
            if (damage.roll) rolls.push(damage.roll);
            events.push({
              recipient,
              seed: fragmentSeed(
                damage.damage,
                location,
                `Fragment ${i + 1}/${hits}: ${spec.expression}; random location ${locRoll.total} → ${location}. If that location is behind cover, B415 says the fragment hits the cover; Skip this ADD hit.`,
              ),
            });
            details.push(`${damage.damage} cut to ${location}`);
          }
          summary.push(
            `${recipient.name}: ${hits} hit${hits === 1 ? '' : 's'}${attackRoll ? ` (rolled ${attackRoll.total} vs ${target.target})` : ' (direct hit)'} – ${details.join('; ')}.`,
          );
        }
        const message = await this.services.createMessage(
          {
            user: game.user.id,
            speaker: { alias: `${game.user.name} – Fragmentation` },
            content: `<section class="manual-add-roll-result"><h3>Fragmentation: ${escapeHTML(spec.expression)}</h3><ul>${summary.map((line) => `<li>${escapeHTML(line)}</li>`).join('')}</ul><p>Fragment hits and locations rolled only. Injury has not been applied.</p></section>`,
            rolls,
            sound: globalThis.CONFIG?.sounds?.dice,
          },
          { messageMode: this.draft.visibility },
        );
        if (!message?.id) throw new Error('Fragmentation results could not be recorded in chat.');
        this.events = events;
        this.summary = summary;
        this.rolls = rolls;
        return true;
      } catch (error) {
        this.error = error.message;
        return false;
      } finally {
        this.busy = false;
        this.refresh();
      }
    }

    async reviewFragments() {
      if (this.busy || this.handedOff || !this.events?.length) return false;
      this.busy = true;
      this.error = '';
      this.refresh();
      try {
        const session = await this.services.startEvents(this.events);
        this.handedOff = true;
        session.completion.finally(() => this.close());
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
