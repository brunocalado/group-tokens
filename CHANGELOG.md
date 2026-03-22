# Unreleased

## [Fixed]
- Group tokens entering a teleport region no longer throw "Failed to create Token in destination Scene". `RegionDocument.teleportToken` is wrapped to catch the error caused by `preCreateToken` cancelling single-token creation for group tokens; the hook's full group transfer handles everything.
- After confirming a group transfer triggered by a region teleport, tokens now disappear from the origin scene immediately instead of after an 8-second delay. Root cause: `_waitForScene` was waiting for `canvasReady` on the destination scene, but `createEmbeddedDocuments`/`deleteEmbeddedDocuments` are pure DB operations that don't require canvas readiness.

## [Changed]
- Group transfers now create tokens in collapsed (crunched) state: only the leader/party token is visible at the destination; all other members arrive hidden at (0,0). The GM can EXPLODE the group after transfer to spread members.
- Ctrl+C / Ctrl+V on a group leader token no longer creates a standalone token — the full group transfer is now triggered correctly. Root cause: `stampGroupFlags` was only writing the `groupId` flag; `tokenId` and `role` flags are now also stamped, allowing the `preCreateToken` hook to identify the leader reliably.
- Copy-pasting a group leader token in the **same scene** now repositions the entire group to the drop point instead of creating an orphan token.
- Duplicate `setBusy(false)` calls in `toggleParty`, `groupParty`, and `findParty` — the `finally` block already resets busy state; the redundant post-try call has been removed.

## [Changed]
- `GroupDataModel` now validates group data in `createGroup()` and `updateGroup()`, catching malformed entries before they reach settings.
- All hardcoded English UI strings in Dashboard, context menu, and party prompt are now routed through `Config.localize()` / `Config.format()` for i18n support.
- InstructionsMenu layout styles moved from inline JS (`style.setProperty` + `ResizeObserver`) to `instructions.css`, scoped via `#gt-instr-window`.

## [Removed]
- Dead localization keys: `setting.modVersion`, `setting.hideChatInfo`, and the `chatInfoContent` block.
- Redundant "Cancel" button from the HUD context menu.

## [Changed]
- Improved text and button contrast across HUD and party-prompt dialogs; enforced sans-serif font on all buttons and inputs.

- Refactored Dashboard from `DialogV2.wait()` to a proper `ApplicationV2` (`HandlebarsApplicationMixin`) singleton, using native action handlers and CSS-driven layout instead of JS-forced styles and `ResizeObserver`.
- Refactored party-prompt and scene-transfer dialogs from `DialogV2` to `ApplicationV2`, eliminating duplicate button bars and `.gt-clean-dialog` CSS hacks.

## [Removed]
- `forceUniqueTargetToken` setting and its "Behaviour" settings section; all members now always group/ungroup using the party token (leader) position as a fixed anchor.

## [Changed]
- Dashboard button in Token HUD context menu is now always visible, regardless of group state.
- Increased UI contrast across the context menu: darker button backgrounds with white text, white cancel button, and explicit white actor name.

## [Fixed]
- Dashboard singleton now uses a synchronous static lock instead of a DOM check, eliminating race conditions that could open duplicate instances.
- Explode spread now accounts for leader and member token sizes (N×N), preventing members from landing inside a large leader's footprint or overlapping each other.

## [Added]
- Token HUD context menu now shows role-aware actions: leaders see **Toggle** (plus **Find** only when the group has no members yet); members see **Toggle** and **Find Leader of Group #N**; ungrouped tokens see per-group **Add to Group #N** buttons when groups exist on the scene, and the Dashboard fallback only when no groups are present.
- `PartyCruncher.Dashboard()` static method: opens the Group Tokens Dashboard from macros or the browser console.
- Zero-argument fallback for `findParty()` and `toggleParty()`: when called without a `groupId`, both methods resolve the first configured group on the current scene and warn if none exists.
- `toggleParty()` without argument focuses the `partyTokenId` (leader/anchor token) before executing the toggle, so the GM sees what is about to change.
- GM-only enforcement on all public `PartyCruncher` methods (`Dashboard`, `findParty`, `toggleParty`, `groupParty`): non-GMs receive a yellow warning notification and the call returns immediately.
- Early yellow warning in `groupParty()` when fewer than 2 tokens are selected and no `preSelectedTokenIds` are provided, preventing the exception previously thrown by `#collectIdsFromTokenSelection`.
- Cross-scene navigation for `findParty` and Dashboard `find-member`: if the GM is viewing a different scene than the group's origin, the view automatically switches to the correct scene before selecting tokens and panning the camera.

## [Removed]
- `PartyCruncher.healthCheck()` removed; it relied on the blocking `alert()` API and provided no value beyond what the Logger already exposes in the console.

## [Changed]
- Refactored `main.js` into four focused files: `party-cruncher.js` (public API), `party-executor.js` (movement engine), `party-prompt.js` (dialog + flags), and `main.js` (bootstrap only).
- `scene-transfer.js` now imports `PartyCruncher` directly instead of relying on the `window` global.
- Optional dependency state (`optionalDepsAvailable`) and module readiness (`ready`) moved to `Config` as static properties.

## [Changed]
- Dashboard width increased to 660px.
- Dashboard action buttons (Toggle, Find, Transfer, Clear) no longer close the dialog; only the window X closes it.
- Dashboard now shows only the group leader's name per row; member list is revealed via an "Expand" toggle button.
- Each member in the expanded list has a delete button to remove them from the group without closing the dashboard.
- Added text labels to Find, Transfer, and Clear buttons to fix icon-only rendering issue.
- Removed the "New Group" button from the dashboard.

## [Changed]
- Complete UI redesign: replaced brown/gold fantasy theme with a clean neutral dark design system using CSS custom properties.
- All dialogs now use a single consistent close mechanism — duplicate window-chrome `×` buttons are suppressed via CSS on dialogs that already provide Cancel/Close actions.
- Removed redundant in-content header blocks (title + subtitle) from Dashboard, Group Config, Instructions, and Scene Transfer dialogs; the Foundry window chrome title is sufficient.
- Replaced decorative gold circle group badges with flat numbered tags.
- All button colours now follow semantic intent: blue=Toggle, indigo=Find, green=Create, red=Remove/Clear, amber=Transfer.
- Extracted inline `<style>` injection from `main.js` Party Token Picker into `styles/party-prompt.css`.

## [Added]
- `styles/base.css`: shared CSS custom properties (design tokens) and utility classes, loaded first via `module.json`.
- `styles/party-prompt.css`: standalone stylesheet for the Party Token Picker dialog.

# 0.0.1

## [Changed]
- Group storage migrated from 10 fixed world settings (`memberTokenNames1–5`, `partyTokenName1–5`) to a single `groups` Array setting with unlimited entries.
- Token identification switched from name-based matching to Foundry document IDs, eliminating collisions when tokens share the same name.
- Each group now stores a `sceneId`; orphaned groups (whose scene was deleted) are automatically cleaned up.
- Scene transfer uses module flags on tokens for cross-scene detection instead of name matching, and remaps token IDs after creation in the destination scene.
- GroupConfigMenu is now a read-only overview; group management is done through the Dashboard and Token HUD.

## [Removed]
- German (`de`) translation; module now ships English only.
- Fixed 5-group slot limit; groups are now unlimited.

