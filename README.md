# GURPS Manual Damage 0.1.1

Open the GURPS 4e Game Aid (GGA) Apply Damage Dialog without rolling damage first.  The module uses GGA's actual calculator and damage-application code.  DR, hit locations, damage types, wounding modifiers, and the other actor data and options that GGA normally uses remain available.

Target: Foundry VTT 14 and GGA 0.18.x.  Tested in live Foundry worlds with GGA 0.18.23, including `/add`, multiple recipients, and the Version 0.1.1 HUD controls.  There are no additional module dependencies.

## Update from 0.1.0

Replace the existing `Data/modules/gurps-manual-add` folder with the `gurps-manual-add` folder in this ZIP.  Restart Foundry and reload the world so it loads the new JavaScript.  Confirm the installed version is **0.1.1** and **Show Manual Damage on token HUD** is enabled in module settings.

Right-click a token and look for the **calculator icon**, with the tooltip **Manual Damage**.  A **Manual Damage** entry is also registered in Foundry 14's supported token context menus.  These controls open the dialog for the right-clicked token.  Use `/add` for all selected tokens.

## Changes in 0.1.1

- Adds a HUD control even when the older `.col.right` layout is absent.
- Correctly distinguishes native HTML form elements from jQuery wrappers.
- Handles the configured custom token HUD class and parent render hooks without duplicate controls.
- Adds the documented Foundry 14 `getTokenPlaceableContextOptions` menu integration.
- Rechecks permissions and resolves the right-clicked token, including token-list context rows.

## Install or update

1. From Foundry's **Setup** screen, open **Add-on Modules**.
2. Paste `https://github.com/Farmeroz/gurps-manual-add/releases/latest/download/module.json` into **Manifest URL** and select **Install**.
3. Open your GURPS world, enable **GURPS Manual Damage** in **Manage Modules**, and reload when prompted.

For a manual installation, download the versioned ZIP from [GitHub Releases](https://github.com/Farmeroz/gurps-manual-add/releases) and extract its `gurps-manual-add` folder into `Data/modules/`.

## Open the calculator

- **Token HUD:** right-click a token and click its calculator icon, **Manual Damage**.  The control appears in a separate group beside the HUD if its older right-hand column is absent.  This opens the dialog for that token alone.
- **Selected tokens:** select one or more recipient tokens and enter `/add` in chat.  `/madd` is an alias.
- **Chat macro:** create a Chat macro with `/add` as its content.
- **OtF:** use `[/add]` or `[/add 12 cut]` in a location that supports GGA OtF links.

No token selected means no application: the module prompts you to select a recipient.  It does not silently substitute GGA's Last Actor or a targeted token.

Examples:

```text
/add
/add 12 cut
/add 12 cut location="Left Arm" divisor=2
/add 8 burn divisor=0.5
/add 3 fat
/add help
```

The number is **basic damage before DR and wounding modifiers**, not injury.  Dice formulas and negative damage are rejected.  Damage types use GGA's abbreviations.  `divisor=-1` means ignore DR, following GGA's internal convention.  Location names are matched to the recipient's own hit-location list, case-insensitively; `Large-Area` is also supported.

## Use the ADD

The full ADD opens, even if GGA's simple-dialog setting is enabled.  The initial defaults are 0 basic damage, crushing, and armour divisor 1 unless supplied in the command.  Basic damage is selected for typing.  This does not alter your GGA settings.

The module's **Apply calculated injury and next/close** button uses GGA's current calculation, including DR and enabled wounding rules.  Its result visibility follows GGA's default Apply-action setting, shown beside the button.

GGA's own Apply buttons remain available, including quiet application and keep-open options.  Its upper **direct Apply** button bypasses DR and the injury calculation; the module labels that button accordingly.  Use the calculated-injury button for the normal damage → DR → injury workflow.

Result cards are GGA's normal cards with a **Manual damage** label.  There is no fabricated attacker, attack roll, damage roll, or attack-action expenditure.  GGA's normal effects controls remain available; effects are not all automatically applied merely because HP or FP changes.

Opening does not roll dice.  If GGA's default hit location is Random, the module starts with Torso, or the first available location for a different body plan.  You can explicitly use the ADD's Random button.  GGA's optional Body Hits/location check is deferred until you apply calculated injury; if enabled, that check can roll dice then.

## Multiple recipients

The command takes a snapshot of the selected tokens and opens one dialog at a time.

- The first dialog's basic damage, type, armour divisor, damage modifier, and location seed subsequent recipients.  A custom user-entered wounding multiplier follows its custom type too.
- These common values are captured on the first Apply or Skip.  Later edits affect only the current recipient.
- Each recipient gets a fresh GGA calculator and their own actor data.  DR overrides, explosion distance, injury-tolerance overrides, and other recipient-specific options are not copied.  Review those individually.
- A location missing from a recipient's body plan produces a warning and falls back to Torso or its first location for review.
- **Skip** advances without damage.  **Cancel remaining**, or closing the window, ends the queue; damage already applied remains applied.
- **Apply and keep open** leaves the effects controls available.  Use **Next / Finish** to continue.  A completed recipient is locked against another Apply in this queue.  For another attack, finish the queue and open a new one.
- GGA's **Apply Multiple** remains available for a deliberate batch of hits; that batch finishes before advancing.  If an update fails partway through, earlier successful hits remain applied and the recipient is locked against accidentally replaying them.
- Multiple linked tokens sharing one actor are included once.  Separate unlinked NPC tokens remain separate recipients and use their own synthetic actors.

## Permissions and settings

GGA's **Only GMs can open the ADD** setting is respected.  If GGA permits players, a player can use this module only for actors they own.  Permission is checked again before applying damage.  Tokens without a usable actor or permission are skipped with a notice.

GGA 0.18.23's native ADD constructor assumes an active GM exists for damage without an attacker.  This release therefore requires a GM to be connected, including when an authorised player opens the manual ADD.

Module settings:

- **Enable manual damage** — world setting, default on.
- **Show Manual Damage on token HUD** — per-user setting, default on.

A second manual-damage queue is refused until the current one is finished or cancelled.  The HUD button, chat commands, and API share these rules.  Existing `/add` or `/madd` command registrations are respected; a conflicting alias is not registered.

## JavaScript macro / API

```js
await game.modules.get('gurps-manual-add').api.open();
```

Prefill and use selected tokens:

```js
await game.modules.get('gurps-manual-add').api.open({
  damage: 12,
  damageType: 'cut',
  hitlocation: 'Left Arm',
  armorDivisor: 2,
});
```

Use specific canvas tokens or token IDs:

```js
await game.modules.get('gurps-manual-add').api.open({
  tokens: [canvas.tokens.get('YOUR_TOKEN_ID')],
  damage: 8,
  damageType: 'burn',
});
```

Run the command parser directly:

```js
await game.modules.get('gurps-manual-add').api.command('/add 12 cut');
```

The promise resolves `true` when the queue finishes, including skipped recipients, or `false` if cancelled, rejected, or unable to open.  It is not a count of actors damaged.  Awaited OtF/chat command processing waits for the queue to finish.

## Functional check

Use a disposable unlinked NPC token with **30 current HP, DR 4 at Torso**, and no relevant injury modifiers.  Enter `/add 12 cut location=Torso`.

1. Confirm the full ADD shows that token's DR 4 and 12 basic cutting damage.
2. With normal location/wounding rules enabled, confirm **12 injury**: `(12 − 4) × 1.5`.
3. Use **Apply calculated injury**.  HP should become **18**, with one labelled result card.
4. Repeat with two independent NPCs, DR 4 and DR 8.  The same 12 cutting should inflict 12 and 6 injury respectively, reviewed separately.
5. Check the HUD button, Chat macro, and OtF link.  Check player access with your intended GGA permissions.

## Validation and sources

The repository's automated tests exercise the parser, permissions, token deduplication, the native GGA calculator and HP/FP application, per-recipient DR, armour divisors, Vitals, automatic Unliving detection, quiet cards, repeated clicks, Apply Multiple, cancellation, permission revocation, partial-update failure, custom wounding multipliers, and direct application.  Version 0.1.1 also passed 9 HUD/context-menu regression checks, including DOM insertion and clicks using LinkeDOM, alongside the 5 portable core tests.

Run the portable tests with Node.js 20 or newer:

```sh
node --test tests/*.test.mjs
```

For the native integration tests, set `GGA_SOURCE` to a GGA 0.18 source directory containing `module/` and `lib/`.  Without it, those integration tests are explicitly skipped.

```sh
GGA_SOURCE=/path/to/gurps node --test tests/*.test.mjs
```

The HUD DOM tests use the optional development-only `linkedom@0.18.12` package.  Install it outside the module and set `MANUAL_ADD_DOM` to its absolute package directory, or install it where Node can resolve `linkedom`.  Without it, the five DOM-dependent tests are explicitly skipped; the hook and permission tests still run.  The installed Foundry module has no LinkeDOM dependency.

GURPS 4e rules context: **Basic Set, pp. 378–379** (damage, DR, and injury), and **pp. 398–400** (hit locations).  The module delegates rules handling to GGA and introduces no house rules.  It does not expand what GGA automatically recognises on an actor, or correct independent GGA calculation issues.

Implementation references:

- https://github.com/crnormand/gurps/blob/v0.18.23/module/damage/applydamage.js
- https://github.com/crnormand/gurps/blob/v0.18.23/module/damage/damagecalculator.js
- https://github.com/crnormand/gurps/blob/v0.18.23/module/chat.js
- https://foundryvtt.com/api/classes/foundry.applications.hud.TokenHUD.html
- https://foundryvtt.com/api/functions/hookEvents.getPlaceableContextOptions.html

Report problems through [GitHub Issues](https://github.com/Farmeroz/gurps-manual-add/issues).  Released under the [MIT licence](LICENSE).

GURPS is a trademark of Steve Jackson Games.  This unofficial module is not affiliated with or endorsed by Steve Jackson Games, Foundry Gaming LLC, or the GURPS Game Aid maintainers.  GGA source is not bundled.
