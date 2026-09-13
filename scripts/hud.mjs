import { ID, canUse } from './core.mjs';

// A native HTMLFormElement is also indexable: form[0] is its first control,
// not a jQuery wrapper. Check nodeType before unwrapping.
const elementOf = value => value?.nodeType ? value : (value?.[0] ?? value);
const enabled = () => game.settings.get(ID, 'enabled') && game.settings.get(ID, 'hudButton');

// Context rows take precedence over a HUD's bound token. Never substitute the
// selected token: it may differ from the token the user right-clicked.
export function tokenFor(application, target) {
  const element = elementOf(target);
  const row = element?.closest?.('[data-token-id], [data-document-id], [data-entry-id]');
  if (row) {
    const id = row.dataset.tokenId ?? row.dataset.documentId ?? row.dataset.entryId;
    return canvas.tokens.get(id) ?? null;
  }
  const object = application?.object;
  if (object?.actor) return object;
  const document = application?.document;
  if (document?.documentName === 'Token') return document.object ?? canvas.tokens.get(document.id) ?? null;
  return null;
}

function permitted(token) {
  return enabled() && canUse(token?.actor, game.user, game.settings.get('gurps', 'only-gms-open-add'));
}

export function createHudIntegration(launch) {
  function activate(application, target) {
    const token = tokenFor(application, target);
    if (!permitted(token)) return;
    return launch({ tokens: [token] });
  }

  function render(hud, html) {
    const root = elementOf(html) ?? elementOf(hud.element);
    if (!root?.querySelector) return;
    if (!permitted(tokenFor(hud))) {
      root.querySelector('.manual-add-hud-group')?.remove();
      root.querySelector('.manual-add-hud')?.remove();
      return;
    }
    if (root.querySelector('.manual-add-hud')) return;

    // The old code silently did nothing if the legacy right column was absent.
    // In that case create a positioned group independent of HUD internals.
    let host = root.querySelector('.col.right') ?? root.querySelector('.right');
    if (!host) {
      host = root.ownerDocument.createElement('div');
      host.className = 'manual-add-hud-group';
      root.append(host);
    }
    const button = root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'control-icon manual-add-hud';
    button.title = 'Manual Damage';
    button.dataset.tooltip = 'Manual Damage';
    button.setAttribute('aria-label', 'Manual Damage');
    button.innerHTML = '<i class="fa-solid fa-calculator" aria-hidden="true"></i>';
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      void activate(hud);
    });
    host.append(button);
  }

  function context(application, menuItems) {
    if (!enabled() || !Array.isArray(menuItems) || menuItems.some(item => item.manualDamageEntry)) return;
    menuItems.push({
      name: 'Manual Damage',
      icon: '<i class="fa-solid fa-calculator"></i>',
      manualDamageEntry: true,
      condition: target => permitted(tokenFor(application, target)),
      callback: target => { void activate(application, target); },
    });
  }

  return { render, context };
}

export function registerHudIntegration(launch) {
  const integration = createHudIntegration(launch);
  const hudClass = globalThis.CONFIG?.Token?.hudClass;
  const renderHooks = new Set(['renderTokenHUD', 'renderBasePlaceableHUD']);
  if (hudClass?.name) renderHooks.add(`render${hudClass.name}`);
  for (const hook of renderHooks) Hooks.on(hook, integration.render);
  // Foundry v14 documents this token-specific hook name. The generic
  // getPlaceableContextOptions name is a documentation placeholder.
  Hooks.on('getTokenPlaceableContextOptions', integration.context);
}
