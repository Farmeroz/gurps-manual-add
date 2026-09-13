import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHudIntegration, registerHudIntegration, tokenFor } from '../scripts/hud.mjs';

// Optional development-only DOM dependency; never loaded by the Foundry module.
const require = createRequire(import.meta.url);
let parseHTML;
try {
  ({ parseHTML } = require(process.env.MANUAL_ADD_DOM ?? 'linkedom'));
} catch {}

function setup() {
  const settings = new Map([
    ['enabled', true],
    ['hudButton', true],
    ['only-gms-open-add', false],
  ]);
  globalThis.game = { user: { isGM: true }, settings: { get: (_scope, key) => settings.get(key) } };
  const a = { id: 'a', actor: { id: 'actor-a', isOwner: true } };
  const b = { id: 'b', actor: { id: 'actor-b', isOwner: true } };
  globalThis.canvas = {
    tokens: new Map([
      ['a', a],
      ['b', b],
    ]),
  };
  const calls = [];
  return { settings, a, b, calls, integration: createHudIntegration((args) => calls.push(args)) };
}

test('registers native token context hook and custom HUD render hook without duplicates', () => {
  const hooks = [];
  globalThis.Hooks = { on: (name, fn) => hooks.push([name, fn]) };
  globalThis.CONFIG = { Token: { hudClass: class CustomTokenHUD {} } };
  registerHudIntegration(() => {});
  assert.deepEqual(
    hooks.map((x) => x[0]),
    [
      'renderTokenHUD',
      'renderBasePlaceableHUD',
      'renderCustomTokenHUD',
      'getTokenPlaceableContextOptions',
    ],
  );
  assert.equal(new Set(hooks.map((x) => x[0])).size, hooks.length);
});

test('context menu entry targets bound token and rechecks permissions at click', () => {
  const { settings, a, b, calls, integration } = setup();
  const hud = { object: a };
  const items = [];
  integration.context(hud, items);
  integration.context(hud, items);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Manual Damage');
  assert.equal(items[0].condition(), true);
  items[0].callback();
  assert.equal(calls[0].tokens[0], a);
  hud.object = b;
  items[0].callback();
  assert.equal(calls[1].tokens[0], b);
  settings.set('enabled', false);
  items[0].callback();
  assert.equal(calls.length, 2);
});

test('GM-only setting and actor ownership apply to the context menu', () => {
  const { settings, a, integration } = setup();
  const items = [];
  integration.context({ object: a }, items);
  game.user.isGM = false;
  settings.set('only-gms-open-add', true);
  assert.equal(items[0].condition(), false);
  settings.set('only-gms-open-add', false);
  assert.equal(items[0].condition(), true);
  a.actor.isOwner = false;
  assert.equal(items[0].condition(), false);
});

test('resolves a TokenDocument HUD binding and refuses unrelated documents', () => {
  const { a } = setup();
  assert.equal(tokenFor({ document: { documentName: 'Token', id: 'a' } }), a);
  assert.equal(tokenFor({ document: { documentName: 'Tile', id: 'a' } }), null);
});

const domTest = (name, fn) => test(name, { skip: !parseHTML }, fn);
function dom(markup) {
  return parseHTML(`<html><body>${markup}</body></html>`).document;
}

domTest('modern HUD without legacy right column receives a clickable calculator', () => {
  const { a, calls, integration } = setup();
  const doc = dom('<form id="token-hud"><input name="elevation"></form>');
  const root = doc.querySelector('form');
  integration.render({ object: a }, root);
  const button = root.querySelector('.manual-add-hud');
  assert.ok(button);
  assert.equal(button.parentElement.className, 'manual-add-hud-group');
  assert.equal(button.getAttribute('aria-label'), 'Manual Damage');
  button.click();
  assert.equal(calls[0].tokens[0], a);
});

domTest('an indexed native form is not mistaken for a jQuery wrapper', () => {
  const { a, integration } = setup();
  const doc = dom('<form><input name="elevation"></form>');
  const root = doc.querySelector('form');
  // Browser HTMLFormElement exposes form[0]; linkedom needs it supplied explicitly.
  Object.defineProperty(root, '0', { value: root.querySelector('input') });
  integration.render({ object: a }, root);
  assert.ok(root.querySelector(':scope > .manual-add-hud-group > button'));
  assert.equal(root.querySelector('input').children.length, 0);
});

domTest('legacy and jQuery HUD inputs work, and repeated parent hooks do not duplicate', () => {
  const { a, calls, integration } = setup();
  const doc = dom('<div id="token-hud"><div class="col right"></div></div>');
  const root = doc.querySelector('#token-hud');
  const hud = { object: a };
  integration.render(hud, [root]);
  integration.render(hud, root);
  integration.render(hud, [root]);
  assert.equal(root.querySelectorAll('.manual-add-hud').length, 1);
  assert.equal(root.querySelectorAll('.manual-add-hud-group').length, 0);
  root.querySelector('.manual-add-hud').click();
  assert.equal(calls.length, 1);
});

domTest('context row resolves the right-clicked token instead of the HUD or selection', () => {
  const { a, b, calls, integration } = setup();
  const doc = dom('<li data-entry-id="b"><span>Other token</span></li>');
  const target = doc.querySelector('span');
  const items = [];
  integration.context({ object: a }, items);
  assert.equal(items[0].condition(target), true);
  items[0].callback(target);
  assert.equal(calls[0].tokens[0], b);
  doc.querySelector('li').dataset.entryId = 'deleted';
  assert.equal(items[0].condition(target), false);
  items[0].callback(target);
  assert.equal(calls.length, 1);
});

domTest('disabling the HUD setting removes the rendered control and hides menu entry', () => {
  const { settings, a, integration } = setup();
  const doc = dom('<form></form>');
  const root = doc.querySelector('form');
  integration.render({ object: a }, root);
  settings.set('hudButton', false);
  integration.render({ object: a }, root);
  assert.equal(root.querySelector('.manual-add-hud'), null);
  assert.equal(root.querySelector('.manual-add-hud-group'), null);
  const items = [];
  integration.context({ object: a }, items);
  assert.equal(items.length, 0);
});
