import { createHelpController, helpResolver } from './tooltip-engine.mjs';
export const helpConfig = {
  id: 'gurps-manual-add',
  scope:
    '#context-menu .context-item:has(.manual-add-menu-icon), .manual-add-panel, .manual-add-hud, .gurps-manual-add, [name^="gurps-manual-add."], [data-key^="gurps-manual-add."], [data-tool="gurps-manual-add"], [data-control="gurps-manual-add"]',
  actions: {
    roll: 'Roll the displayed damage and record it in chat without applying injury. Retry keeps dice already rolled; Roll again starts a new damage event.',
    review:
      'Open the ADD for the listed recipients. Review DR, armour layers, and injury before applying. A rolled batch can be sent to one queue only.',
    refreshRecipients:
      'Use your currently selected tokens. Linked actors count once. Separate rolls must be made again if this selection is refreshed.',
    close:
      'Close the damage workbench. Chat rolls and any damage already applied remain. An open ADD queue continues independently.',
  },
  fields: {
    mode: 'Choose a fixed basic-damage number or roll damage dice. Switching entry mode discards the pending result in this window; chat records remain.',
    damage: 'A fixed basic-damage total before DR and wounding. No dice are rolled.',
    expression:
      'Enter a full expression such as 3d+2 cut, 2d(2) imp, or 3dx5 burn. The fields below show how it was interpreted. Dice are d6.',
    dice: 'Number of six-sided damage dice to roll, from 1 to 1000.',
    modifier:
      'Add or subtract this whole number from the dice total before the multiplier. GGA applies its minimum-damage rule.',
    multiplier:
      'Multiply the damage after the dice and modifier, using a positive whole number. This is not an armour divisor.',
    distribution:
      'Shared makes one roll for everyone. Separate makes one independent roll per listed recipient. Each ADD still uses that recipient’s own protection.',
    includeBucket:
      'Copy the current numeric bucket values into this batch, once per roll. Entries are not removed, and costs or other described effects are not executed. Off by default.',
    visibility:
      'Choose who can see the damage roll in chat. Blind results are hidden from players in this window, and require GM review. ADD injury-result visibility is controlled separately.',
    hitlocation:
      'Optional hit-location name. Leave blank to use each actor’s default, with Random replaced by a fixed default on opening. An unavailable location is flagged in the ADD.',
    basicDamage:
      'Basic damage before DR and wounding modifiers. Calculated injury applies this recipient’s armour and ADD options.',
    armorDivisor:
      'Armour divisor of this attack. The ADD uses it when calculating effective protection.',
    damageType: 'Choose the damage type used for DR and wounding calculations.',
    hitLocation: 'Choose the recipient’s hit location for armour and injury calculations.',
  },
  rules: [
    [
      '.manual-add-hud',
      'Open the damage workbench for this token. Enter fixed damage or prepare a roll, then review it in the ADD. Opening never rolls or applies damage.',
    ],
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
      return 'Advance without applying damage to this recipient. Recorded rolls retain their assigned totals; fixed-damage queues use the first recipient’s common inputs.';
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
