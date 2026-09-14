import { createHelpController, helpResolver } from './tooltip-engine.mjs';
export const helpConfig = {
  id: 'gurps-manual-add',
  scope:
    '#context-menu .context-item:has(.manual-add-menu-icon), .manual-add-panel, .manual-add-hud, .gurps-manual-add, [name^="gurps-manual-add."], [data-key^="gurps-manual-add."], [data-tool="gurps-manual-add"], [data-control="gurps-manual-add"]',
  actions: {},
  fields: {
    basicDamage:
      'Basic damage before DR and wounding modifiers. Calculated injury applies this recipient’s armour and ADD options.',
    armorDivisor:
      'Armour divisor of this attack. The ADD uses it when calculating effective protection.',
    damageType: 'Choose the damage type used for DR and wounding calculations.',
    hitLocation: 'Choose the recipient’s hit location for armour and injury calculations.',
  },
  rules: [
    ['.manual-add-hud', 'Open the full Apply Damage Dialog for this token without rolling damage.'],
    [
      '.manual-add-primary',
      'Apply the calculated injury using this recipient’s DR and ADD options, then advance or close.',
    ],
    [
      '#apply-publicly',
      'Apply basic damage directly, bypassing DR and the injury calculation, with a public result.',
    ],
    [
      '#apply-secretly',
      'Apply basic damage directly and quietly, bypassing DR and the injury calculation.',
    ],
  ],
  actionAttributes: ['data-action'],
};
let resolve = helpResolver(helpConfig);

const baseResolve = resolve;
resolve = (node, original) => {
  if (node.closest('.armour-add-panel, .armour-add, .gurps-layered-armour')) return '';
  if (node.closest('.manual-add-controls')) {
    if (node.textContent === 'Cancel remaining')
      return 'End the queue. Damage already applied remains applied.';
    if (node.textContent === 'Skip')
      return 'Advance without applying damage to this recipient. The first recipient’s common inputs seed the rest of the queue.';
    if (node.textContent === 'Next / Finish')
      return 'Continue after this recipient’s injury has already been applied.';
  }
  return baseResolve(node, original);
};

export const helpController = createHelpController({ ...helpConfig, resolve });
if (globalThis.Hooks) {
  Hooks.once('init', () => helpController.register());
  Hooks.once('ready', () => helpController.start());
}
