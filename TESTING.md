# Testing

Start with the setup commands in [CONTRIBUTING.md](CONTRIBUTING.md).

## Automated coverage

Existing tests cover manual damage parsing, recipient selection, token HUD and chat invocation, multiple recipients, failure handling, and the native GGA damage calculator and application dialogue. Foundry documents and UI are mocked.

The roller tests use GGA’s real damage parser and roll-building methods with deterministic dice. They cover minimum damage, multiplier order, separate/shared totals, numeric bucket snapshots, chat retry, blind-result privacy, and single-use batches. Application tests exercise the current Layered Armour integration, including per-layer Hardened and per-recipient DR.

Run `npx playwright install chromium` once, then `npm run test:browser` for the workbench’s Chromium checks. `GCS_CHROMIUM_EXECUTABLE` can point to an existing Chromium executable. The browser suite covers field synchronisation, separate rolls, the explicit ADD hand-off, blind-player output, optional keyboard help, and small-window layout. Its Foundry application and document services are mocked.

The suite exercises these behaviours but does not claim complete coverage or reproduce a connected Foundry world. All automated cases should run; the standard test command treats skipped Node tests as a failure. Test output is saved under `test-output/`.

## Source fixtures

- `crnormand/gurps` 0.18.23, commit `4fb95f7ed8e114993c65ef77dc912a7b77957b02`, cached in `.cache/gga/`; optional installed-source override: `GGA_SOURCE`.
- `Farmeroz/gurps-layered-armour` 0.2.2, commit `7046395018ab8a982eddfef93c18a72fab56a88b`, cached in `.cache/layered/`; optional installed-source override: `LAYERED_SOURCE`.

`npm run test:setup` downloads only the listed files from fixed revisions, records their hashes, and leaves them under the ignored `.cache/` directory. The test runner checks the revision and hashes before use. Run setup again if the cache is missing or changed. The cache is excluded from git and all user releases. An explicit source override is read directly; quote paths containing spaces. No installed source or world is modified.

## Live check

Use a disposable unlinked NPC token with **30 current HP, DR 4 at Torso**, and no relevant injury modifiers. Enter `/add 12 cut location=Torso`.

1. Confirm the full ADD shows that token's DR 4 and 12 basic cutting damage.
2. With normal location/wounding rules enabled, confirm **12 injury**: `(12 − 4) × 1.5`.
3. Use **Apply calculated injury**. HP should become **18**, with one labelled result card.
4. Repeat with two independent NPCs, DR 4 and DR 8. The same 12 cutting should inflict 12 and 6 injury respectively, reviewed separately.
5. Check the HUD button, Chat macro, and OtF link. Check player access with your intended GGA permissions.

Use /add and the token HUD on one and several tokens. Enter damage, change location/divisor, and apply it. Also test it together with the Armour Layers candidate.

For the new roller, try `/add 2d+1 cut`, roll, and confirm that no resources change until an ADD Apply button is used. Check shared versus separate results on two unlinked NPCs. Repeat with saved armour layers enabled. Check Roll only with no selection, a negative modifier with a multiplier, numeric bucket opt-in, roll visibility from both player and GM clients, and cancellation after a partial queue. Test that a roll cannot be sent to another queue without explicitly rolling again.

Use your normal Foundry/GGA versions and module combination, and refresh connected clients after updating. Record unexpected notifications, visibility changes, or changed resource totals, together with the module versions and steps to reproduce them.

## Package verification

The build checks module/package versions, install URLs, declared assets, local imports, the allowed archive file list, and every archived file's bytes. The release ZIP contains only runtime files, the licence, and user documentation.
