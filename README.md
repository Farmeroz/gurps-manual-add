# GURPS Manual Damage 0.5.3

## 0.5.3: selected-origin distance estimates

Fixes the blank explosion distances confirmed in Foundry 14.367. Area Attack passed an elevation-bearing origin alongside a plain 2D destination, producing an invalid distance. It now uses fragmentation's working token measurement routine; template origins also pass clean 2D coordinates, with elevation accounted for separately. The earlier 0.5.2 change did not fix this live failure.

For an explosion, select **Distance origin**, or enter the first zero distance/tick the first **Direct hit** to nominate a recipient as origin. Other unedited distances calculate automatically when scene measurements are available. **Recipients and distances → Reset distances** clears the origin and manual overrides before choosing a new centre. Direct hit is a separate attack choice; zero distance alone does not mark it. Manual distance overrides remain intact during estimates.

Update to **0.5.3** and reload connected clients. No Cones update or macro recreation is required. GURPS 4e damage rules are unchanged.

## 0.5.1: Area Attack opening fix

Fixes “Cannot set property template” when opening Area Attack from ADD, `/add area`, `/add explosion`, a saved area profile or a Cones handoff. The area snapshot now uses a separate property from Foundry’s read-only HTML template accessor. Multiple selected tokens are supported. Update Manual Damage and reload connected clients; no Cones update or macro recreation is needed. Existing damage rules and profile formats are unchanged.

## Reusable damage profiles

Configure an attack, expand the secondary options, and choose **Save as macro…** (in ADD: **Attack options → Save attack as macro…**). Name it, then find it in Foundry's **Macros** directory and drag it onto your hotbar. Each save creates a new macro; it does not replace an existing macro with the same name. Creating and running script macros requires the appropriate Foundry permissions.

| Save from                                | Settings remembered                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADD → Attack options                     | Current **fixed** basic damage, type, armour divisor, location, damage modifier, custom wounding multiplier if selected, explosion/half-damage/shotgun switches and shotgun RoF multiplier |
| Roll damage → Profiles                   | Dice expression or fixed damage, type/divisor, optional location, shared/separate rolls, visibility and whether to use the **current** modifier bucket                                     |
| Area damage → Profiles and other actions | Uniform AoE/explosion/cone mode, fixed damage or dice, type/divisor, blast roll distribution, visibility and explicit radius for fixed-damage explosions                                   |
| Fragmentation → Profiles                 | Fragment dice, airburst and visibility                                                                                                                                                     |

Select the current recipient tokens and run the macro. Dice and area/fragmentation profiles reopen their helpers for review; they do not roll automatically. Fixed ADD profiles open the normal recipient queue. **No profile applies injury automatically.** A profile saved from ADD stores the displayed basic damage as a fixed value, even if that number originally came from dice. Save from **Roll damage** to retain a dice formula.

Recipients, token IDs, template references, origin, distances, posture, direct-hit choices, rolled results, target DR, vulnerabilities and Injury Tolerance are not saved. Review them for each use. Chinks, armour-layer overrides and contextual exposed-location choices also remain per-target review in Layered Armour. Native ADD explosion distance must be reviewed anew. This is an attack preset, not a copy of a defender's injury calculation.

**With saved Cones shapes:** run the shape macro, place it, then **Send area to Manual Damage**. Run your saved **area damage** macro while that fresh helper is open: it loads attack settings into the current template/recipient snapshot. Prepared results must be reset first, and an active queue must finish. Review the shape's coverage/radius if the loaded profile changes the attack mode or blast radius. Without a template handoff, the macro uses the currently selected tokens.

The GURPS 4e rules and existing review process are unchanged: large-area protection B400, explosions B414 and fragmentation B415. Profiles are versioned and require Manual Damage 0.5.1 or later. Older hand-written macros using `api.open` remain supported.

**Stable install/update manifest:**

```text
https://github.com/Farmeroz/gurps-manual-add/releases/latest/download/module.json
```

## About Manual Damage

Version 0.5.0 introduced reusable attack profiles to the existing damage, area and fragmentation workflow.

Enter fixed damage or roll damage dice, then review and apply the result with GGA’s full Apply Damage Dialog (ADD). Each recipient keeps their own DR, hit locations, and injury options. A separate GURPS 4e fragmentation helper resolves B415 fragment hits without cluttering ordinary damage entry. GURPS Layered Armour is supported when installed and enabled.

Requires Foundry VTT 14 and GURPS Game Aid (GGA) 0.18.x. No additional modules are required.

## Area attacks: Uniform AoE, explosions and cones

Open **/add area** (or **/add aoe**) for the compact area helper. **/add explosion** starts in Explosion mode. From an existing ADD, use **Attack options → Area attack…**; from the standalone roller, use **Area attack…**. Ordinary damage entry remains unchanged.

1. Select recipients, or use **Send area to Manual Damage** in the companion Cones module's Region Controls.
2. Choose **Uniform AoE**, **Explosion** or **Cone** and fixed damage or dice.
3. Check the recipient list. Untick anyone not affected. **Recipients and distances** contains **Add selected tokens**, **Refresh template** and **Reset distances**.
4. Click **Prepare damage**, check the results, then **Review in ADD**. Preparing records results only; applying calculated injury remains a separate action in each ADD.

**Uniform AoE** uses the same basic damage for everyone, with no distance falloff. Dice are rolled once. Each recipient still gets their own DR and injury calculation. **Cone** also uses uniform basic damage; the Region supplies the shape. Special Dissipation effects are not calculated.

**Explosion** shows distance and Direct hit controls. Collateral damage is divided by three times distance in yards (minimum one yard), rounded down, and receives no armour divisor. A direct hit receives full damage and retains the attack's divisor. Entering distance zero does not make it a direct hit. Large-area protection is used. Dice default to separate rolls per recipient, with an explicit shared-roll GM shortcut. Collateral radius is automatically 2 × dice × damage multiplier; fixed damage requires the original attack's radius in yards. Recipients beyond that radius and zero-damage results do not enter ADD. References: GURPS 4e B400, B413–414. Internal/contact explosions, special falloff enhancements and Dissipation require separate adjudication.

Template measurements run from the shape's centre/apex to token centres, including elevation, in recognised yards, feet or metres. Distances remain editable. For manual attacks, the first zero-distance or direct-hit recipient suggests the origin; use the origin dropdown or reset to change it. Review token-edge cases, cover and dodge-and-drop yourself.

Inputs lock once results exist. **Reset results** explicitly discards them before editing or rerolling. Closing with pending results asks before discarding. Chat or ADD opening failures retain prepared dice for retry. Sending the same batch to ADD twice is blocked. Moving a template or scene tokens invalidates its snapshot: reset results and **Refresh template** to use the new positions. Refresh replaces the candidate list and its manual overrides. Linked tokens sharing one actor are still reviewed once; separate unlinked NPCs remain independent.

The original ADD queue is replaced only after acknowledging that its unapplied entries will be replaced. Earlier applied injury is retained. Finish the area queue before using **Reset or resolve fragmentation → Fragmentation…**. This carries the listed recipients and distances into the existing fragmentation helper; review its recipient list separately because fragment range can exceed the blast. Opening a helper never applies blast or fragment injury automatically.

### Area-attack installation

Use Manual Damage **0.5.3** with Cones **0.3.0** for template handoff and saved-profile workflows. Layered Armour remains optional and needs no new release for this feature. The area helper works with selected tokens without Cones. Missing hit-location NPCs retain explicit manual DR review.

Manifest: https://github.com/Farmeroz/gurps-manual-add/releases/latest/download/module.json

## Quick start for players and GMs

1. Select the recipient token(s), then enter **`/add`**. Use selected tokens, not just targeted tokens.
2. Enter basic damage and its type, or choose **Roll damage…** and then **Use rolled damage** to return the roll to the ADD.
3. Check the recipient, hit location, DR, divisor and calculated injury. Open **Attack options** for fragmentation, large-area or explosion damage. Chinks and layered exposure controls require GURPS Layered Armour.
4. Choose **Apply calculated injury and next/close**. **Skip** changes nothing for that recipient. **Cancel remaining** leaves already-applied injury in place.

**Apply directly (ignore DR)** bypasses armour. Use calculated injury for ordinary damage resolution.

### Features introduced in 0.3.1

NPCs without hit locations now open temporary manual review: enter DR (including 0) for calculated injury, or deliberately apply direct damage. Their sheets remain unchanged. Failed ADD opening preserves rolled results for retry.

### Features introduced in 0.3.0

The GURPS 4e fragmentation helper rolls fragment attacks, locations and damage, then sends each hit to ADD for review. It includes blast-centre distance estimates, manual overrides, a centre/distance reset, and warnings before discarding pending hits. Ordinary `/add` now exposes the extra attack options even when opened without initial damage.

## Install or update

Install using this manifest URL in Foundry’s **Add-on Modules**:

```text
https://github.com/Farmeroz/gurps-manual-add/releases/latest/download/module.json
```

For manual installation, extract the ZIP’s `gurps-manual-add` folder into `Data/modules`, replacing the existing folder. Restart Foundry, enable **GURPS Manual Damage** in your world, and reload connected browsers.

**Moving from an rc test build:** install using the stable manifest above, because rc manifests are pinned to their specific test release. Confirm **0.5.3** in Manage Modules and reload every connected client. If you use Layered Armour, keep it on its current stable release. Future stable updates use the stable manifest.

## Open Manual Damage

- Enter **`/add`** or **`/madd`** in chat to open the ADD immediately for your selected tokens.
- Right-click a token and use its **Manual Damage** calculator button or supported context-menu entry. The ADD opens for that token.
- Use a Chat macro containing `/add`, or an OtF link such as `[/add]`.

The ADD starts with your selected recipient tokens. Targets and GGA’s Last Actor are not substituted for selected recipients. Inside the ADD, **Roll damage…** opens the optional roller for the current and remaining recipients.

Use **Attack options** in ordinary `/add` to open **Fragmentation…** or choose single-location, large-area, or explosion damage, even when starting with no damage number. Chinks is visible in the Armour Layers panel and explains which damage types enable it. These armour controls require GURPS Layered Armour. Review explosion distance in the native ADD before applying injury.

Use `/add roll` or a dice command to open the standalone roller, including without selected tokens. Its **Use currently selected tokens** button updates the list. You can make a shared roll for chat only and add recipients later without rerolling. The standalone workbench also offers **Fragmentation…** when recipients are selected.

## Enter fixed damage

### Incomplete NPCs without hit locations

The ADD opens in **temporary manual review** when the actor has no hit-location table. Enter **Reviewed DR for this recipient** (including 0 if unprotected), then apply calculated injury. The preview uses provisional DR 0 until you enter a value; calculated application is blocked until then. Alternatively, **Apply directly (ignore DR)** deliberately subtracts the entered damage without protection or calculated wounding.

The sheet is unchanged. No anatomy, location multipliers, random body location or crippling location is assumed. Layered protection and armour degradation are bypassed in this mode; review DR and injury modifiers yourself. If Layered Armour is enabled, use its version 0.3.1 or later. Each recipient starts with its own unfilled DR field. Fragment hits against an actor without locations use this same manual review instead of inventing a body plan.

If the ADD cannot finish opening, the roller retains its results for retry rather than marking them as transferred. This does not restore hits already applied in a partially completed queue.

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

## Fragmentation

Choose **Fragmentation…** from `/add` → **Attack options**, or from the standalone Manual Damage workbench, to resolve the GURPS 4e fragmentation rules on Basic Set: Campaigns, p. 415. When opened from an ADD, reviewing fragment hits replaces the current unapplied queue; the original basic damage is not also applied. Closing the helper before review leaves the original ADD available.

Enter the listed fragmentation damage, such as `2d cut`. For each selected recipient, enter distance from the blast, choose posture, and tick **Direct hit** if the explosive attack actually struck that target. **Airburst** is a single global option.

The first recipient entered at distance zero or marked Direct hit suggests the blast centre. You can change the centre using its dropdown. For tokens on the active scene, the helper estimates straight-line distances between token centres, including token elevation, converting scene yards, feet or metres into yards. Previously edited distances are preserved; every estimate can be overridden. Airbursts, unknown units and unavailable token measurements require manual distances. Zero range does not itself mark a direct hit. Measurement uses Foundry's [grid measurement API](https://foundryvtt.com/api/v14/interfaces/foundry.grid.types.GridMeasurePathResult.html).

Use **Reset centre & distances** to clear the previous centre, all distance overrides and Direct hit ticks, then enter zero or tick Direct hit on the new centre. Damage, posture, airburst and visibility settings are retained. Reset also clears pending results and warns before discarding unreviewed hits.

**Resolve fragments only rolls the hits. You must click Review hits in ADD, then apply injury in each ADD.** Closing the helper before review does not transfer or apply anything. Both Close and the window close control warn when hits are pending: keep them to return to review, or explicitly discard them. The chat record remains, but it does not automatically restore the pending queue. No warning is needed if no fragments hit or the hits have already been handed to ADD.

Editing an input or choosing **Roll again** also requires confirmation before discarding pending hits. Keeping hits restores the original rolled inputs; confirming an edit clears the old results and applies that edit.

**Explosion blast damage is separate from fragmentation.** When opened from an ADD, the helper requires acknowledgement before replacing its current unapplied queue with fragment hits. To apply blast damage first, close the helper, finish the original ADD queue, then reopen Fragmentation through `/add`. Fragment review does not apply the pending blast damage for you.

The helper follows B415:

- maximum fragment radius is five yards per die of fragmentation damage;
- a directly struck target receives one automatic fragment hit;
- otherwise fragments attack at skill 15 using only range, posture, and Size Modifier;
- each full three points of margin of success adds one further fragment hit;
- airbursts ignore posture modifiers;
- every actual fragment hit rolls hit location randomly;
- fragmentation is cutting damage and does **not** inherit the explosive attack’s armour divisor.

The helper rolls and records the fragment attacks, locations, and damage first. Nothing is applied yet. Choose **Review hits in ADD** to send each actual fragment hit through the ordinary GGA ADD one at a time. That means normal hit-location effects, Injury Tolerance, Layered Armour, Hardened, Ablative/Semi-Ablative condition, crippling, shock, and other ADD rules continue to operate in their normal places.

B415 also says that if a randomly rolled location is behind cover, the fragment hits the cover instead. The helper cannot infer arbitrary scene cover reliably, so the fragment’s ADD carries an explicit reminder; choose **Skip** for that hit after adjudicating the cover.

When **Direct hit** is selected, distance is irrelevant and its input is disabled. When **Airburst** is selected, posture is irrelevant and the posture controls are disabled. Blind fragmentation results remain hidden from non-GMs and require GM review.

### An explosive attack with fragments: order of work

1. Resolve and apply the **blast damage** in the normal ADD, reviewing explosion distance and protection for each recipient.
2. Select the fragment recipients and open `/add` → **Attack options** → **Fragmentation…**, or `/add roll` → **Fragmentation…**.
3. Enter the listed fragment damage. Choose the centre and review distances, posture, direct hits and airburst status. Distance zero alone does not mean the attack directly struck that recipient.
4. Click **Resolve fragments**, inspect the results, then **Review hits in ADD**. If opened from an ADD, acknowledge that fragment review replaces its pending queue; do not leave unapplied blast damage there.
5. Review and apply each fragment separately. If the rolled location is behind cover, adjudicate the cover and **Skip** that recipient's fragment hit.

The chat message is a record, not a saved application queue. Closing after confirming discard, reloading the client, or cancelling a partially completed ADD queue does not provide an automatic resume or undo. Do not rerun a whole batch to recover unfinished hits: previously applied hits would be applied again.

## Multiple recipients

Choose **One roll shared by all recipients** for one damage roll, or **Roll separately for each recipient** for independent totals tied to the listed tokens. When opened from an ADD, that list contains only the current and remaining recipients; earlier applied or skipped recipients are unchanged. A result cannot return if its original ADD has since been applied, advanced, or closed. Separate rolls require recipients before rolling. Refreshing their selection requires fresh separate rolls.

The ADD opens one recipient at a time. Each reads its own protection and injury options, including saved armour layers. Changes to a rolled result in one ADD affect that recipient only; the other recipients retain their recorded totals. In a fixed-damage queue, the first ADD’s common damage inputs seed the later dialogs.

Multiple linked tokens sharing one actor count once. Unlinked NPC tokens remain separate recipients.

Use **Apply calculated injury and next/close** for GGA’s normal damage calculation. The native **Apply directly (ignore DR)** option deliberately bypasses protection. **Skip** advances without applying damage. **Cancel remaining** ends the queue; damage already applied remains applied.

Each rolled batch can open one application queue or return once to its existing ADD. Cancelling or partially completing that queue does not make the batch reusable. Roll again for a new damage event. GGA’s deliberate **Apply Multiple** option remains available inside the ADD.

## Visibility and modifier bucket

Choose **Public**, **GM and me**, **Blind to GM**, or **Only me** for the damage-roll chat message. Blind results are hidden from players in the workbench, and require GM review and application. The ADD controls the visibility of its injury-result messages separately.

For blind fragmentation, have the GM run the helper and review the hits. A player's pending helper is not automatically transferred to the GM's client; the private chat record does not supply a cross-client review queue.

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

Open the fragmentation helper for selected tokens:

```js
await game.modules.get('gurps-manual-add').api.openFragmentation();
```

An optional `tokens` array accepts canvas tokens or their IDs. `api.command('/add 3d+2 cut')` uses the chat parser. Explicit roller calls resolve when the window is launched; empty and numeric ADD calls resolve when the queue finishes or is cancelled. Neither return value counts actors damaged.

## Support and licence

### Common questions

- **Where is Fragmentation?** In plain `/add`, expand **Attack options**. It is also in the standalone `/add roll` window, but not in the attached Roll damage window.
- **Nothing changed after Resolve fragments.** That is expected: choose **Review hits in ADD**, then apply injury in each ADD.
- **The old centre or distances are sticking.** Manual overrides are preserved. Use **Reset centre & distances**, then enter zero or tick Direct hit on the new centre. Review all estimates before rolling.
- **Chinks is disabled.** In Layered Armour it requires eligible impaling, piercing or tight-beam burning damage to a single location, rather than explosion/large-area damage. It represents an already-successful attack against a chink (GURPS 4e B400).
- **ADD will not open.** Select permitted recipient tokens, check the GGA GM-only setting, and ensure a GM is connected. Finish or cancel any existing damage queue.

Report problems through [GitHub Issues](https://github.com/Farmeroz/gurps-manual-add/issues). Released under the [MIT licence](LICENSE).

GURPS is a trademark of Steve Jackson Games. This unofficial module is not affiliated with or endorsed by Steve Jackson Games, Foundry Gaming LLC, or the GURPS Game Aid maintainers. GGA source is not bundled.

## 0.3.3: area attacks without hit locations

Actors without a hit-location table can now select Single location, Large-area, or Explosion
in Attack options. The selection survives rerendering and calculated injury. Enter reviewed DR
appropriate to the selected attack, including 0 for an unprotected recipient. No hit locations
are added to the actor, no armour average is inferred, and automatic location modifiers and
layered armour remain bypassed in this manual-review fallback.

Explosion distance and armour-divisor handling remain with GGA. The attack context follows
the recipient queue, but each recipient still uses its own protection and distance review.
This release fixes the disabled Attack area selector for recipients without hit locations.
