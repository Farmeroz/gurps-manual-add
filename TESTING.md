# Testing

Start with the setup commands in [CONTRIBUTING.md](CONTRIBUTING.md).

## Automated coverage

Tests cover manual damage parsing, recipient selection, token HUD and chat invocation, multiple recipients, failure handling, the native GGA damage calculator/application dialogue, and the B415 fragmentation helper. Fragmentation cases cover range, skill-15 attacks, normal success-roll limits, posture, Size Modifier, airbursts, direct hits, multiple fragment hits, random locations, cutting damage with AD 1, blind-result privacy, and repeated hits on one recipient. Foundry documents and UI are mocked.

The roller tests use GGA’s real damage parser and roll-building methods with deterministic dice. They cover minimum damage, multiplier order, separate/shared totals, numeric bucket snapshots, chat retry, blind-result privacy, and single-use batches. Application tests exercise the current Layered Armour integration, including per-layer Hardened, per-recipient DR, and an end-to-end fragment hit that depletes an Ablative Resource Tracker.

Run `npx playwright install chromium` once, then `npm run test:browser` for the workbench’s Chromium checks. `GCS_CHROMIUM_EXECUTABLE` can point to an existing Chromium executable. The browser suite covers field synchronisation, separate rolls, the explicit ADD hand-off, blind-player output, optional keyboard help, and small-window layout. Its Foundry application and document services are mocked.

The suite exercises these behaviours but does not claim complete coverage or reproduce a connected Foundry world. All automated cases should run; the standard test command treats skipped Node tests as a failure. Test output is saved under `test-output/`.

## Source fixtures

- `crnormand/gurps` 0.18.23, commit `4fb95f7ed8e114993c65ef77dc912a7b77957b02`, cached in `.cache/gga/`; optional installed-source override: `GGA_SOURCE`.
- `Farmeroz/gurps-layered-armour` 0.3.0 candidate, pinned by `tools/test-sources.json`, cached in `.cache/layered/`; optional installed-source override: `LAYERED_SOURCE`.

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

For fragmentation, select one or more tokens and choose **Fragmentation…** from `/add` → **Attack options** (or the standalone workbench). Check an ordinary target at several distances, a direct hit, prone/kneeling posture, an airburst, multiple fragment hits, and a case where the random location is behind cover and must be skipped. Confirm each actual hit opens its own ADD with its rolled location and that an Ablative Layered Armour tracker depletes only when that fragment's injury is applied.

Use your normal Foundry/GGA versions and module combination, and refresh connected clients after updating. Record unexpected notifications, visibility changes, or changed resource totals, together with the module versions and steps to reproduce them.

## Package verification

The build checks module/package versions, install URLs, declared assets, local imports, the allowed archive file list, and every archived file's bytes. The release ZIP contains only runtime files, the licence, and user documentation.

## Final candidate live checks (not verified by automated CI)

Use the release candidates together in your normal Foundry world with one GM and one connected player. Record the Foundry, GGA and module versions and each result.

- Open ordinary /add, expand Attack options, and confirm Fragmentation, Large-Area, Explosion and the explained Chinks control are discoverable.
- Apply explosion damage separately before fragment review. Confirm the replacement acknowledgement cannot accidentally apply the original basic/blast damage.
- Resolve fragments, try changing damage, range, centre, posture and visibility, and try Roll again. Keep hits must preserve results and original inputs; confirm discard must clear them. Test Close and window X too.
- Reset centre & distances; nominate a different zero-range or Direct hit recipient. Confirm distances recalculate and prior overrides/direct-hit ticks clear.
- Send multiple fragments into Ablative/Semi-Ablative armour. Confirm trackers and HP change only for applied hits, and later hits use the remaining protection.
- Skip a fragment whose rolled location is behind cover. Cancel midway through a multi-hit queue. Applied hits must remain applied; skipped and remaining hits must not change HP or armour.
- With the player connected, test ownership/GM-only permissions and public, GM, self and blind visibility. Blind results must remain hidden from players; this helper does not automatically transfer a player's pending queue to another client's GM. Use GM-led review for blind fragmentation.
- Reload the world and confirm armour configuration and remaining tracker values persist.

Passing automated tests does not establish these connected-world results. Record any failure before promoting to stable.
