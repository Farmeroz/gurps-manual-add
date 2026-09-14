# GURPS Manual Damage 0.2.1

Enter fixed damage or roll damage dice, then review and apply the result with GGA’s full Apply Damage Dialog (ADD). Each recipient keeps their own DR, hit locations, and injury options. GURPS Layered Armour is supported when installed and enabled.

Requires Foundry VTT 14 and GURPS Game Aid (GGA) 0.18.x. No additional modules are required.

## Install or update

Install using this manifest URL in Foundry’s **Add-on Modules**:

```text
https://github.com/Farmeroz/gurps-manual-add/releases/latest/download/module.json
```

For manual installation, extract the ZIP’s `gurps-manual-add` folder into `Data/modules`, replacing the existing folder. Restart Foundry, enable **GURPS Manual Damage** in your world, and reload connected browsers.

## Open Manual Damage

- Enter **`/add`** or **`/madd`** in chat to open the ADD immediately for your selected tokens.
- Right-click a token and use its **Manual Damage** calculator button or supported context-menu entry. The ADD opens for that token.
- Use a Chat macro containing `/add`, or an OtF link such as `[/add]`.

The ADD starts with your selected recipient tokens. Targets and GGA’s Last Actor are not substituted for selected recipients. Inside the ADD, **Roll damage…** opens the optional roller for the current and remaining recipients.

Use `/add roll` or a dice command to open the standalone roller, including without selected tokens. Its **Use currently selected tokens** button updates the list. You can make a shared roll for chat only and add recipients later without rerolling.

## Enter fixed damage

Enter basic damage, its type, and armour divisor directly in the ADD. Basic damage is the amount before protection and wounding, not the final injury.

Existing numeric commands open the ADD directly:

```text
/add 12 cut
/add 12 cut location="Left Arm" divisor=2
/add 3 fat
```

## Roll damage

In the ADD, click **Roll damage…**. The roller starts with that dialog’s damage type and armour divisor. Enter a compact expression, or use the dice, modifier, multiplier, damage-type, and armour-divisor fields. The expression and fields update together.

```text
3d+2 cut
2d(2) imp
1d-1x5 burn
```

Dice are six-sided. The modifier is added or subtracted before the multiplier; GGA handles the actual dice and minimum-damage calculation. Use a whole-number multiplier. Armour divisors may be fractional; `-1` means ignore DR. The attached roller retains the existing ADD’s location. The standalone roller also accepts an optional hit-location name.

Select **Roll damage** to show the result and record it in chat. This changes no HP, FP, armour, or actor resources. From the optional roller, select **Use rolled damage** to return the total, type, and divisor to the same ADD. Its location, DR overrides, temporary armour layers, and other settings stay intact. The remaining recipients receive their assigned totals. This does not apply injury; use the ADD’s Apply controls when ready. Closing the roller without returning leaves the ADD unchanged.

The standalone roller retains **Review and apply**, which opens a new ADD queue. Its **Fixed number** mode is also available. The chat card records the roll; application is performed through the ADD.

**Roll again** starts a new damage event. Changing any damage or roll-option field discards the pending result in the workbench; existing chat records remain. If recording a result fails, **Retry: keep existing dice** records the same dice rather than rerolling them.

Dice commands prepare the roller but do not roll automatically:

```text
/add roll
/add 3d+2 cut
/add 2d(2) imp location="Left Arm"
/add 3d burn rolls=separate
/add help
```

Expressions must be complete. Actor-relative expressions such as `sw+2` or `thr`, margin references, arbitrary Foundry formulas, and fractional multipliers are not supported.

## Multiple recipients

Choose **One roll shared by all recipients** for one damage roll, or **Roll separately for each recipient** for independent totals tied to the listed tokens. When opened from an ADD, that list contains only the current and remaining recipients; earlier applied or skipped recipients are unchanged. A result cannot return if its original ADD has since been applied, advanced, or closed. Separate rolls require recipients before rolling. Refreshing their selection requires fresh separate rolls.

The ADD opens one recipient at a time. Each reads its own protection and injury options, including saved armour layers. Changes to a rolled result in one ADD affect that recipient only; the other recipients retain their recorded totals. In a fixed-damage queue, the first ADD’s common damage inputs seed the later dialogs.

Multiple linked tokens sharing one actor count once. Unlinked NPC tokens remain separate recipients.

Use **Apply calculated injury and next/close** for GGA’s normal damage calculation. The native **Apply directly (ignore DR)** option deliberately bypasses protection. **Skip** advances without applying damage. **Cancel remaining** ends the queue; damage already applied remains applied.

Each rolled batch can open one application queue or return once to its existing ADD. Cancelling or partially completing that queue does not make the batch reusable. Roll again for a new damage event. GGA’s deliberate **Apply Multiple** option remains available inside the ADD.

## Visibility and modifier bucket

Choose **Public**, **GM and me**, **Blind to GM**, or **Only me** for the damage-roll chat message. Blind results are hidden from players in the workbench, and require GM review and application. The ADD controls the visibility of its injury-result messages separately.

**Include numeric modifier-bucket values** is off by default. When enabled, the current numeric modifiers are copied once for the batch and included in each roll. The bucket is not cleared or changed. Costs, actions, and other effects described in its entries are not executed. Review the entries yourself before including them; this is a numeric snapshot, not an attack roll.

## Permissions and settings

Rolling alone does not require a recipient or an active GM. Applying damage respects GGA’s **Only GMs can open the ADD** setting and actor ownership. Permissions and token existence are checked again before opening and applying. GGA 0.18’s native ADD requires an active GM for damage without an attacker, so a GM must be connected for the application stage.

Opening a window never rolls damage. A default Random hit location starts at Torso or the actor’s first available location. You can explicitly choose Random inside the ADD. GGA’s optional Body Hits check may roll when calculated injury is applied.

Module settings include:

- **Enable manual damage**: world setting, on by default.
- **Show Manual Damage on token HUD**: personal setting, on by default.
- **Show help tooltips**: personal setting, on by default. Hover or use keyboard focus for help; Escape dismisses it. Turning help off preserves labels and essential notices.

## JavaScript macros

Open the ADD for selected tokens:

```js
await game.modules.get('gurps-manual-add').api.open();
```

Prepare a roll:

```js
await game.modules.get('gurps-manual-add').api.open({
  expression: '3d+2 cut',
  distribution: 'shared', // or 'separate'
  hitlocation: 'Torso',
});
```

Open fixed damage directly for selected tokens:

```js
await game.modules.get('gurps-manual-add').api.open({
  damage: 12,
  damageType: 'cut',
  armorDivisor: 2,
});
```

An optional `tokens` array accepts canvas tokens or their IDs. `api.command('/add 3d+2 cut')` uses the chat parser. Explicit roller calls resolve when the window is launched; empty and numeric ADD calls resolve when the queue finishes or is cancelled. Neither return value counts actors damaged.

## Support and licence

Report problems through [GitHub Issues](https://github.com/Farmeroz/gurps-manual-add/issues). Released under the [MIT licence](LICENSE).

GURPS is a trademark of Steve Jackson Games. This unofficial module is not affiliated with or endorsed by Steve Jackson Games, Foundry Gaming LLC, or the GURPS Game Aid maintainers. GGA source is not bundled.
