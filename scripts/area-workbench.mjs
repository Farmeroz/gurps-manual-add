import { saveDamageProfile } from './profiles.mjs';
import { AREA_MODES, areaEvents, pointDistance } from './area.mjs';
import {
  DamageBatch,
  defaultVisibility,
  escapeHTML as esc,
  nativeDamageRoller,
  parseExpression,
} from './rolls.mjs';
import { validateSeed } from './core.mjs';
const rootOf = (element) => (element?.nodeType ? element : element?.[0]);

export function createAreaWorkbenchClass(Base = globalThis.Application) {
  return class AreaWorkbench extends Base {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: 'manual-area-damage',
        title: 'Area damage',
        classes: ['gurps-manual-add', 'manual-area-workbench'],
        width: 760,
        height: 'auto',
        resizable: true,
      });
    }
    constructor(recipients, services = {}, options = {}) {
      super();
      this.services = {
        assertEnabled() {},
        roller: nativeDamageRoller,
        createMessage: (data, opts) => ChatMessage.create(data, opts),
        ...services,
      };
      this.recipients = recipients.slice();
      this.template = options.template ?? null;
      this.origin = options.origin ?? null;
      this.originKey = '';
      this.draft = {
        mode: options.mode ?? 'uniform',
        input: 'fixed',
        damage: String(options.damage ?? 0),
        damageType: options.damageType ?? 'cr',
        armorDivisor: String(options.armorDivisor ?? 1),
        expression: '3d cr',
        distribution: 'separate',
        radius: '',
        visibility: defaultVisibility(),
      };
      Object.assign(this.draft, options.profileSettings ?? {});
      this.rows = {};
      this.addRows();
      this.busy = false;
      this.prepared = false;
      this.handedOff = false;
      this.queueActive = false;
      this.pendingDiscard = null;
      this.error = '';
      this.events = null;
      this.batch = null;
      this.auditId = null;
      this.acknowledged = !services.replacesQueue;
      this.estimate();
    }
    addRows() {
      for (const r of this.recipients)
        this.rows[r.key] ??= { include: true, distance: '', directHit: false, edited: false };
    }
    estimate() {
      const chosen = this.recipients.find((r) => r.key === this.originKey);
      const origin = chosen
        ? {
            ...chosen.token.center,
            sceneId: chosen.document.parent?.id,
            elevation: chosen.document.elevation ?? 0,
          }
        : this.origin;
      for (const r of this.recipients) {
        const row = this.rows[r.key];
        if (row.edited) continue;
        const distance = pointDistance(origin, r);
        row.distance = distance === null ? '' : String(distance);
      }
    }
    assertSnapshot() {
      if (this.template && this.services.snapshot?.().signature !== this.template.signature)
        throw new Error(
          'The template or scene tokens changed. Reset results, then Refresh template before preparing damage.',
        );
    }
    markup() {
      return `<form autocomplete="off"><p><strong>1. Review recipients. 2. Prepare damage. 3. Review in ADD.</strong> Nothing applies injury until you confirm it in each ADD.</p>
      <details><summary>Coverage and rules</summary><p>${this.template ? `Template: ${esc(this.template.name)}. Uses Foundry Region membership (covered token spaces), not walls or cover. Refresh after moving the template or tokens.` : 'Selected recipients; no template is required. Add selected tokens or exclude rows below.'} Review cover, dodge-and-drop and partial overlap yourself.</p></details>
      <div class="manual-roll-grid"><label>Attack mode<select data-field="mode">${Object.entries(
        AREA_MODES,
      )
        .map(([v, l]) => `<option value="${v}">${l}</option>`)
        .join('')}</select></label>
      <label>Damage source<select data-field="input"><option value="fixed">Fixed damage</option><option value="dice">Roll dice</option></select></label>
      <label>Visibility<select data-field="visibility"><option value="public">Public</option><option value="gm">GM and me</option><option value="blind">Blind to GM</option><option value="self">Only me</option></select></label></div>
      <div data-fixed class="manual-roll-grid"><label>Basic damage<input type="number" min="0" step="1" data-field="damage"></label><label>Damage type<select data-field="damageType">${Object.entries(
        GURPS.DamageTables.woundModifiers,
      )
        .filter(([, v]) => !v.nodisplay)
        .map(([k]) => `<option value="${esc(k)}">${esc(k)}</option>`)
        .join(
          '',
        )}</select></label><label>Armour divisor<input type="number" step="any" data-field="armorDivisor"></label></div>
      <div data-dice><label>Damage expression<input data-field="expression" placeholder="3d cr"></label><label data-blast>Explosion rolls<select data-field="distribution"><option value="separate">Roll separately for recipients (B414)</option><option value="shared">One shared roll (GM shortcut)</option></select></label></div>
      <p data-uniform>Same basic damage for everyone, with no falloff. Each ADD uses that recipient’s protection and injury modifiers. </p>
      <section data-blast><details><summary>Blast rules and exceptions</summary><p>Collateral blast: divide by 3 × distance in yards (minimum 1 yard), round down. Only a direct hit receives full damage and the attack’s armour divisor. Zero distance alone is not a direct hit. GURPS 4e B414.</p></details>
      <label>Blast radius (yards)<input type="number" min="0" step="any" data-field="radius"></label>
      <label>Distance origin<select data-origin><option value="">${this.origin ? 'Template centre' : 'Manual distances'}</option>${this.recipients.map((r) => `<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')}</select></label><small>Centre-to-centre estimates include elevation. Edit any distance. Dice set radius automatically; fixed damage requires a radius.</small></section>
      <details><summary>Recipients and distances</summary><div class="manual-workbench-actions"><button type="button" data-action="add">Add selected tokens</button>${this.template ? '<button type="button" data-action="refresh">Refresh template</button>' : ''}<button type="button" data-action="reset">Reset distances</button></div></details>
      <table class="manual-fragment-table"><thead><tr><th>Include</th><th>Recipient</th><th data-blast>Distance (yd)</th><th data-blast>Direct hit</th></tr></thead><tbody>${this.recipients.map((r) => `<tr data-recipient="${esc(r.key)}"><td><input type="checkbox" data-help="Include this recipient in the damage review. Exclude targets protected by cover or outside the effect." data-row="include" aria-label="Include ${esc(r.name)}"></td><td>${esc(r.name)}</td><td data-blast><input type="number" min="0" step="any" data-help="Distance from blast centre in yards; editable. Collateral falloff uses at least one yard." data-row="distance" aria-label="${esc(r.name)} distance"></td><td data-blast><input type="checkbox" data-help="The attack actually struck this recipient. Full basic damage and its armour divisor apply; zero distance alone is not enough." data-row="directHit" aria-label="${esc(r.name)} direct hit"></td></tr>`).join('')}</tbody></table>
      ${this.services.replacesQueue ? '<label><input type="checkbox" data-ack> Replace the current unapplied ADD queue with this area attack. Previously applied injury is kept.</label>' : ''}
      <div class="manual-workbench-error" role="alert"></div><section data-results aria-live="polite"></section>
      <section data-discard hidden role="alert"><p>Discard these prepared results? They have not been applied automatically; the chat record remains.</p><button type="button" data-action="keep">Keep results</button><button type="button" data-action="discard">Discard and continue</button></section>
      <footer class="manual-workbench-actions"><button type="button" data-action="prepare">Prepare damage</button><button type="button" data-action="review">Review in ADD</button><button type="button" data-action="close">Close</button></footer><details><summary>Profiles and other actions</summary><button type="button" data-action="saveProfile">Save as macro…</button><button type="button" data-action="clear">Reset results</button><button type="button" data-action="fragments">Fragmentation…</button><small>Blast and fragmentation are separate. Finish this ADD queue before resolving fragments. Fragment recipients must be checked separately: their radius may be larger than the blast.</small></details></form>`;
    }
    async _renderInner() {
      return $(this.markup());
    }
    activateListeners(html) {
      super.activateListeners(html);
      const root = rootOf(html);
      root.addEventListener('submit', (e) => e.preventDefault());
      root.addEventListener('input', (e) => {
        if (this.busy || this.batch || this.events || this.handedOff || this.pendingDiscard) return;
        const target = e.target;
        if (target.dataset.field) this.draft[target.dataset.field] = target.value;
        if (target.matches('[data-origin]')) {
          this.originKey = target.value;
          this.estimate();
        }
        if (target.matches('[data-ack]')) this.acknowledged = target.checked;
        if (target.dataset.row) {
          const key = target.closest('[data-recipient]').dataset.recipient,
            row = this.rows[key];
          row[target.dataset.row] = target.type === 'checkbox' ? target.checked : target.value;
          if (target.dataset.row === 'distance') row.edited = true;
          if (
            !this.origin &&
            !this.originKey &&
            (row.directHit || (row.distance !== '' && Number(row.distance) === 0))
          ) {
            this.originKey = key;
            this.estimate();
          }
        }
        this.error = '';
        this.refresh(root);
      });
      root.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        e.preventDefault();
        if (action === 'saveProfile')
          void saveDamageProfile({ version: 1, kind: 'area', settings: this.draft });
        else if (action === 'prepare') void this.prepare();
        else if (action === 'review') void this.review();
        else if (action === 'close') void this.close();
        else if (action === 'fragments') void this.fragments();
        else if (action === 'keep') {
          this.pendingDiscard = null;
          this.refresh();
        } else if (action === 'discard') {
          const pending = this.pendingDiscard;
          this.clear();
          if (pending === 'close') void this.close();
          else void this.edit(pending);
        } else void this.edit(action);
      });
      this.refresh(root);
    }
    refresh(root = rootOf(this.element)) {
      if (!root) return;
      const locked =
        this.busy ||
        Boolean(this.batch || this.events) ||
        this.handedOff ||
        Boolean(this.pendingDiscard);
      for (const node of root.querySelectorAll('[data-field]')) {
        node.value = this.draft[node.dataset.field];
        node.disabled = locked;
      }
      for (const node of root.querySelectorAll('[data-blast]'))
        node.hidden = this.draft.mode !== 'explosion';
      root.querySelector('[data-uniform]').hidden = this.draft.mode === 'explosion';
      root.querySelector('[data-fixed]').hidden = this.draft.input !== 'fixed';
      root.querySelector('[data-dice]').hidden = this.draft.input !== 'dice';
      root.querySelector('[data-field="radius"]').disabled = locked || this.draft.input === 'dice';
      if (this.draft.mode === 'explosion' && this.draft.input === 'dice') {
        try {
          const spec = parseExpression(
            this.draft.expression,
            {},
            GURPS.DamageTables.woundModifiers,
          );
          root.querySelector('[data-field="radius"]').value = String(
            2 * spec.dice * spec.multiplier,
          );
        } catch {
          root.querySelector('[data-field="radius"]').value = '';
        }
      }
      root.querySelector('[data-action="reset"]').hidden = this.draft.mode !== 'explosion';
      root.querySelector('[data-origin]').value = this.originKey;
      root.querySelector('[data-origin]').disabled = locked;
      for (const tr of root.querySelectorAll('[data-recipient]'))
        for (const node of tr.querySelectorAll('[data-row]')) {
          const state = this.rows[tr.dataset.recipient];
          if (node.type === 'checkbox') node.checked = Boolean(state[node.dataset.row]);
          else node.value = state[node.dataset.row];
          node.disabled = locked || (node.dataset.row === 'distance' && state.directHit);
        }
      const ack = root.querySelector('[data-ack]');
      if (ack) {
        ack.checked = this.acknowledged;
        ack.disabled = locked;
      }
      for (const button of root.querySelectorAll('[data-action]'))
        button.disabled = this.busy || this.queueActive || Boolean(this.pendingDiscard);
      for (const a of ['keep', 'discard'])
        root.querySelector(`[data-action="${a}"]`).disabled = this.busy;
      root.querySelector('[data-action="prepare"]').disabled =
        this.busy || this.handedOff || this.prepared || Boolean(this.pendingDiscard);
      root.querySelector('[data-action="prepare"]').textContent =
        this.batch && !this.prepared ? 'Retry recording same results' : 'Prepare damage';
      root.querySelector('[data-action="review"]').disabled =
        this.busy ||
        !this.prepared ||
        this.handedOff ||
        !this.events?.some((e) => e.inRange && e.effective > 0) ||
        Boolean(this.pendingDiscard) ||
        (this.draft.visibility === 'blind' && !game.user.isGM);
      root.querySelector('[data-discard]').hidden = !this.pendingDiscard;
      root.querySelector('.manual-workbench-error').textContent = this.error;
      const hidden = this.draft.visibility === 'blind' && !game.user.isGM;
      root.querySelector('[data-results]').innerHTML = this.prepared
        ? hidden
          ? '<p>Blind results recorded for the GM.</p>'
          : `<ul>${this.events.map((e) => `<li>${esc(e.recipient.name)}: ${e.inRange ? `${e.effective} ${esc(e.seed.damageType)} before DR` : 'outside blast radius; omitted'}.</li>`).join('')}</ul><p>${this.handedOff ? (this.queueActive ? 'Sent to ADD; finish each review.' : 'ADD queue finished. Applied and skipped entries remain in their normal chat records.') : 'Prepared only. Click Review in ADD; zero-damage entries are omitted.'}</p>`
        : '';
    }
    clear() {
      this.batch = null;
      this.events = null;
      this.auditId = null;
      this.prepared = false;
      this.handedOff = false;
      this.pendingDiscard = null;
      this.error = '';
    }
    async edit(action) {
      if (this.busy || this.queueActive) return;
      if ((this.batch || this.events) && !this.handedOff) {
        this.pendingDiscard = action;
        this.refresh();
        return;
      }
      this.clear();
      try {
        if (action === 'add') {
          const seen = new Set(this.recipients.map((r) => r.key));
          this.recipients.push(...this.services.readRecipients().filter((r) => !seen.has(r.key)));
          this.addRows();
          this.estimate();
        }
        if (action === 'refresh') {
          const snap = this.services.snapshot();
          this.template = snap;
          this.origin = snap.origin;
          this.originKey = '';
          this.recipients = this.services.readRecipients({ tokens: snap.tokens });
          this.rows = {};
          this.addRows();
          this.estimate();
        }
        if (action === 'reset') {
          this.originKey = '';
          for (const row of Object.values(this.rows)) {
            row.distance = '';
            row.edited = false;
            row.directHit = false;
          }
          this.estimate();
        }
        this.render(false);
      } catch (error) {
        this.error = error.message;
        this.refresh();
      }
    }
    async prepare() {
      if (this.busy || this.handedOff || this.prepared || this.pendingDiscard) return false;
      this.busy = true;
      this.error = '';
      this.refresh();
      try {
        this.services.assertEnabled();
        this.assertSnapshot();
        if (!this.acknowledged)
          throw new Error('Confirm replacement of the pending ADD queue first.');
        const included = this.recipients.filter((r) => this.rows[r.key].include);
        if (!included.length) throw new Error('Include at least one recipient.');
        let seeds,
          radius = Infinity;
        const types = GURPS.DamageTables.woundModifiers;
        const spec =
          this.draft.input === 'dice' ? parseExpression(this.draft.expression, {}, types) : null;
        if (this.draft.mode === 'explosion') {
          radius = spec ? 2 * spec.dice * spec.multiplier : Number(this.draft.radius);
          if (!Number.isFinite(radius) || radius <= 0)
            throw new Error('Enter the blast radius in yards for fixed damage.');
        }
        // Validate all distances before rolling, so bad input never silently rerolls dice.
        areaEvents(
          included,
          this.rows,
          { damage: 0, damageType: spec?.damageType ?? this.draft.damageType },
          this.draft.mode,
          types,
          radius,
        );
        if (spec) {
          this.batch ??= new DamageBatch({
            spec,
            recipients: included,
            distribution: this.draft.mode === 'explosion' ? this.draft.distribution : 'shared',
            visibility: this.draft.visibility,
          });
          await this.batch.evaluate(await this.services.roller());
          await this.batch.publish(this.services.createMessage);
          // Blind results can be recorded but only the GM can hand them to ADD.
          seeds = included.map((_r, i) => ({
            damage: this.batch.results[this.batch.distribution === 'shared' ? 0 : i].damage,
            damageType: spec.damageType,
            armorDivisor: spec.armorDivisor,
          }));
        } else
          seeds = validateSeed(
            {
              damage: this.draft.damage,
              damageType: this.draft.damageType,
              armorDivisor: this.draft.armorDivisor,
            },
            types,
          );
        this.events = areaEvents(included, this.rows, seeds, this.draft.mode, types, radius);
        if (!this.auditId) {
          const msg = await this.services.createMessage(
            {
              user: game.user.id,
              speaker: { alias: `${game.user.name} – Area damage` },
              content: `<h3>${esc(AREA_MODES[this.draft.mode])}</h3><ul>${this.events.map((e) => `<li>${esc(e.recipient.name)}: ${esc(e.seed.rollInfo)} ${e.inRange ? '' : 'Outside blast radius; omitted.'}</li>`).join('')}</ul><p>Prepared only. Review in ADD to apply injury.</p>`,
            },
            { messageMode: this.draft.visibility },
          );
          if (!msg?.id)
            throw new Error('Could not record the area results. Retry keeps the same dice.');
          this.auditId = msg.id;
        }
        this.prepared = true;
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
      if (this.busy || !this.prepared || this.handedOff || this.pendingDiscard) return false;
      this.busy = true;
      this.error = '';
      this.refresh();
      try {
        this.services.assertEnabled();
        this.assertSnapshot();
        if (this.draft.visibility === 'blind' && !game.user.isGM)
          throw new Error('Ask the GM to review blind damage.');
        const events = this.events.filter((e) => e.inRange && e.effective > 0);
        if (!events.length) throw new Error('No non-zero damage recipients to review.');
        const session = await this.services.startEvents(events);
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
    async fragments() {
      if (this.busy || this.queueActive) return;
      if ((this.batch || this.events) && !this.handedOff) {
        this.error = 'Finish the area review or reset its results before opening fragmentation.';
        this.refresh();
        return;
      }
      await this.services.openFragmentation?.({
        tokens: this.recipients.filter((r) => this.rows[r.key].include).map((r) => r.token),
        origin: this.origin,
        distances: Object.fromEntries(
          this.recipients.map((r) => [
            r.key,
            { distance: this.rows[r.key].distance, directHit: this.rows[r.key].directHit },
          ]),
        ),
      });
    }
    async close(options) {
      if (this.busy || this.queueActive) return this;
      if ((this.batch || this.events) && !this.handedOff) {
        this.pendingDiscard = 'close';
        this.refresh();
        return this;
      }
      return super.close(options);
    }
  };
}
