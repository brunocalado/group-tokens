import { Config } from './config.js';
import { Logger } from './logger.js';
import { Dashboard as DashboardClass } from './dashboard.js';
import { crunchParty, explodeParty, gatherParty, spreadInCircle, moveToFormation, gatherToTargets, playActionAudio } from './party-executor.js';
import { KillThemAll } from './kill-them-all.js';
import { promptForPartyToken, stampGroupFlags } from './party-prompt.js';
import { SceneTransfer } from './scene-transfer.js';

/**
 * Public class for accessing this module through macro code.
 * All group operations use the group's unique ID (string) instead of a slot number.
 */
export class PartyCruncher {
    /**
     * Opens the Group Tokens Dashboard.
     * Convenience shortcut so all macro/console entry points live under PartyCruncher.
     * Note: intentionally bypasses the isBusy guard — opening the dashboard is
     * a read-only operation and must always be allowed, even mid-animation.
     * Syntax: PartyCruncher.Dashboard()
     * @returns {Promise<void>}
     */
    static async Dashboard() {
        if (!PartyCruncher.#requireGM("Dashboard")) return;
        return DashboardClass.open();
    }

    static #isBusy;

    static isBusy() {
        return this.#isBusy;
    }

    static async setBusy(isBusy) {
        this.#isBusy = isBusy;
        Logger.debug("(PartyCruncher.setBusy) ", isBusy ? "BUSY!" : "NOT BUSY")
    }

    static #instances = new Map();

    /**
     * Lazily creates or retrieves a PartyCruncher instance keyed by groupId.
     * @param {string} groupId
     * @returns {PartyCruncher}
     */
    static #getInstance(groupId) {
        if (!this.#instances.has(groupId)) {
            this.#instances.set(groupId, new PartyCruncher());
        }
        return this.#instances.get(groupId);
    }

    static Actions = Object.freeze({
        CRUNCH: Symbol("CRUNCH"),
        EXPLODE: Symbol("EXPLODE"),
        GROUP: Symbol("GROUP"),
        FIND: Symbol("FIND")
    });

    /**
     * Public method for usage in macros: Toggle existing group between CRUNCH and EXPLODE.
     * When called without a groupId, falls back to the first group on the current scene
     * and focuses the group's partyTokenId (leader/anchor) before executing the toggle.
     * @param {string|null} groupId - The unique group identifier, or null for scene fallback
     * @returns {Promise<void>}
     */
    static async toggleParty(groupId = null) {

        if (!PartyCruncher.#requireGM("toggleParty")) return;

        if (PartyCruncher.isBusy()) {
            Logger.warn(false, Config.localize("errMsg.pleaseWaitStillBusy"));
            return;
        }

        // Capture before overwriting so we know whether to focus the leader token below
        const calledWithoutArgument = groupId == null;
        groupId = PartyCruncher.#resolveGroupIdFromArgumentOrScene(groupId, "toggleParty");
        if (groupId == null) return;

        Logger.debug(`(PartyCruncher.toggleParty) TOGGLE - groupId: ${groupId} ...`);

        // When called without an explicit groupId, focus the partyTokenId as the
        // leader/anchor so the GM can see what is about to be toggled.
        // "Leader" is defined as partyTokenId — the only stable cross-mode anchor.
        if (calledWithoutArgument) {
            const group = Config.getGroup(groupId);
            if (group?.partyTokenId) {
                const leaderToken = canvas.tokens.get(group.partyTokenId);
                if (leaderToken) {
                    leaderToken.control({ releaseOthers: true });
                    canvas.animatePan(PartyCruncher.#getTokenCenter(leaderToken));
                }
            }
        }

        const instance = PartyCruncher.#getInstance(groupId);

        try {

            await PartyCruncher.setBusy(true);

            // Step 1 — Read & validate group data from settings
            const validatedIds = instance.#collectValidatedIdsFromSettings(groupId);
            Logger.debug("(PartyCruncher.toggleParty) validatedIds: ", validatedIds);

            // Step 2 — Gather and validate all the involved tokens from current scene
            const involvedTokens = instance.#collectInvolvedTokens(validatedIds);
            Logger.debug("(PartyCruncher.toggleParty) involvedTokens: ", involvedTokens);

            // Step 3 — Auto-determine the required action (CRUNCH or EXPLODE?)
            const requiredAction = instance.#determineRequiredAction(involvedTokens);
            Logger.debug(`(PartyCruncher.toggleParty) required action: ${requiredAction.toString()}`);

            // Step 4 — Auto-determine target token: always use the party token as anchor
            const targetToken = instance.#getTarget(requiredAction, involvedTokens);
            if (targetToken?.name === undefined) {
                Logger.warn(false, Config.localize("errMsg.pleaseActivateTokenLayer"));
                return;
            }
            Logger.debug(`(PartyCruncher.toggleParty) target token: [${targetToken.name}]`);
            canvas.tokens.releaseAll();
            targetToken.control({releaseOthers: true});
            canvas.animatePan(PartyCruncher.#getTokenCenter(targetToken));

            // Step 5 — Execute the action
            switch (requiredAction) {
                case PartyCruncher.Actions.CRUNCH:
                    Logger.info(`Crunching group ${groupId} ...`);
                    await crunchParty(involvedTokens, targetToken);
                    break;
                case PartyCruncher.Actions.EXPLODE:
                    Logger.info(`Exploding group ${groupId} ...`);
                    await explodeParty(involvedTokens, targetToken);
            }

        } catch (e) {
            Logger.error(false, e);
            return;
        } finally {
            await PartyCruncher.setBusy(false);
        }

        Logger.info(`... Toggling of group ${groupId} complete.`);
    }

    static #getTokenCenter(targetToken) {
        const { x, y } = targetToken;
        return targetToken.getCenterPoint({ x, y });
    }

    /**
     * Checks if the current user is a GM. Warns and logs if not.
     * Called at the top of every public GM-only method to provide a consistent
     * rejection message across all PartyCruncher entry points.
     * @param {string} methodName - Name of the calling method, used in the log message.
     * @returns {boolean} true if the user is a GM, false otherwise.
     */
    static #requireGM(methodName) {
        if (game.user.isGM) return true;
        Logger.warn(false, `(PartyCruncher.${methodName}) ${Config.localize('errMsg.gmOnly')}`);
        return false;
    }

    /**
     * Scans Config.getGroups() and returns the first group whose sceneId matches
     * the currently viewed scene. Only the active scene is searched — never all scenes —
     * because the caller explicitly wants a group "on the current scene".
     * "First" is defined by Config.getGroups() insertion order (creation order).
     * @returns {object|null} The first matching group object, or null if none found.
     */
    static #getFirstGroupOnCurrentScene() {
        const currentSceneId = canvas.scene?.id;
        if (!currentSceneId) return null;
        return Config.getGroups().find(g => g.sceneId === currentSceneId) ?? null;
    }

    /**
     * Resolves an effective groupId for zero-argument macro calls.
     * If groupId was provided it is returned unchanged. If omitted, falls back to
     * the first group configured on the current scene. Warns and returns null when
     * no group is found so the caller can return early without throwing.
     * @param {string|null} groupId - The argument passed by the caller.
     * @param {string} methodName - Name of the calling method, for log context.
     * @returns {string|null} The resolved group ID, or null if resolution failed.
     */
    static #resolveGroupIdFromArgumentOrScene(groupId, methodName) {
        if (groupId != null) return groupId;
        const group = PartyCruncher.#getFirstGroupOnCurrentScene();
        if (group) return group.id;
        Logger.warn(false, `(PartyCruncher.${methodName}) ${Config.localize('errMsg.noGroupOnCurrentScene')}`);
        return null;
    }

    /**
     * Public method for usage in macros: Assign selected scene tokens to a group.
     * Prompts for the party token that shall represent the members.
     * @param {string|null} groupId - Existing group ID, or null to auto-create a new group
     * @param {string[]|null} preSelectedTokenIds - Pre-captured token IDs (from HUD button)
     * @param {string|null} preferredTokenId - Token ID to pre-select in the leader dropdown (the HUD origin token)
     * @returns {Promise<void>}
     */
    static async groupParty(groupId = null, preSelectedTokenIds = null, preferredTokenId = null) {

        if (!PartyCruncher.#requireGM("groupParty")) return;

        if (PartyCruncher.isBusy()) {
            Logger.warn(false, Config.localize("errMsg.pleaseWaitStillBusy"));
            return;
        }

        // Guard against insufficient selection before entering the try block so the
        // user gets a yellow warning instead of an uncaught exception from #collectIdsFromTokenSelection.
        if (!preSelectedTokenIds && canvas.tokens.controlled.length < 2) {
            ui.notifications.warn(`[${Config.data.modTitle}] ${Config.localize('errMsg.selectAtLeastTwoTokens')}`);
            return;
        }

        Logger.debug(`(PartyCruncher.groupParty) GROUP - groupId: ${groupId} ...`);

        // Force activation of the Token Layer in the UI
        canvas.tokens.activate();

        try {

            await PartyCruncher.setBusy(true);

            // Step 1 — Collect token IDs from current selection
            const idsFromSelection = preSelectedTokenIds
                ? { memberTokenIds: preSelectedTokenIds, partyTokenId: null }
                : PartyCruncher.#collectIdsFromTokenSelection();

            // Ask the GM for the party token; pre-select the HUD origin token when provided
            const partyTokenResult = await promptForPartyToken(idsFromSelection.memberTokenIds, preferredTokenId);
            if (partyTokenResult.cancelled) return;

            idsFromSelection.partyTokenId = partyTokenResult.tokenId;
            Logger.debug(`(PartyCruncher.groupParty) idsFromSelection:`, idsFromSelection);

            // Step 2 — Validate
            const validatedIds = PartyCruncher.#validateIds(idsFromSelection);

            // Step 3 — Persist the group
            let group;
            if (groupId) {
                await Config.updateGroup(groupId, {
                    memberTokenIds: validatedIds.memberTokenIds,
                    partyTokenId: validatedIds.partyTokenId
                });
                group = Config.getGroup(groupId);
            } else {
                group = await Config.createGroup({
                    sceneId: canvas.scene.id,
                    partyTokenId: validatedIds.partyTokenId,
                    memberTokenIds: validatedIds.memberTokenIds
                });
            }

            // Step 4 — Stamp module flags on involved tokens for scene-transfer detection
            await stampGroupFlags(group);

            // Step 5 — Confirm in UI
            const partyName = Config.resolveTokenName(group.sceneId, group.partyTokenId);
            const memberNames = group.memberTokenIds.map(id => Config.resolveTokenName(group.sceneId, id));
            const groupIndex = Config.getGroups().findIndex(g => g.id === group.id) + 1;
            const msg =
                `${Config.localize('groupingConfirmation')
                    .replace('{partyNo}', groupIndex)
                    .replace('{partyTokenName}', partyName)}:</br>` +
                `<ul><li>` +
                memberNames.join(`</li><li>`) +
                `</li></ul>`;
            Logger.info(msg);

        } catch (e) {
            Logger.error(false, e);
            return;
        } finally {
            await PartyCruncher.setBusy(false);
        }

        Logger.info(`... Grouping complete.`);
    }

    /**
     * Public method for usage in macros: Select all member tokens of a given group in the scene.
     * The new target token depends on whether group is crunched or exploded (auto-detected).
     * If the GM is viewing a different scene than the group's origin scene, automatically navigates
     * to the correct scene before selecting tokens and panning the camera.
     * When called without a groupId, falls back to the first group configured on the current scene.
     * @param {string|null} groupId - The unique group identifier, or null for scene fallback
     * @returns {Promise<void>}
     */
    static async findParty(groupId = null) {

        if (!PartyCruncher.#requireGM("findParty")) return;

        if (PartyCruncher.isBusy()) {
            Logger.warn(false, Config.localize("errMsg.pleaseWaitStillBusy"));
            return;
        }

        groupId = PartyCruncher.#resolveGroupIdFromArgumentOrScene(groupId, "findParty");
        if (groupId == null) return;

        Logger.debug(`(PartyCruncher.findParty) FIND - groupId: ${groupId} ...`);

        // Cross-scene guard: if GM is on a different scene, navigate there first before
        // attempting canvas token lookup, which only works on the currently rendered scene.
        const group = Config.getGroup(groupId);
        if (group?.sceneId && canvas.scene?.id !== group.sceneId) {
            const targetScene = game.scenes.get(group.sceneId);
            if (!targetScene) {
                ui.notifications.error(`[${Config.data.modTitle}] ${Config.localize('errMsg.sceneNotFound')}`);
                return;
            }
            Logger.debug(`(PartyCruncher.findParty) Navigating to group scene: ${targetScene.name}`);
            await targetScene.view();
            await SceneTransfer._waitForScene(targetScene);
            return PartyCruncher.findParty(groupId);
        }

        const instance = PartyCruncher.#getInstance(groupId);

        try {

            await PartyCruncher.setBusy(true);

            // Step 1 — Read & validate group data from settings
            const validatedIds = instance.#collectValidatedIdsFromSettings(groupId);
            Logger.debug("(PartyCruncher.findParty) validatedIds: ", validatedIds);

            // Step 2 — Gather and validate all the involved tokens from current scene
            const involvedTokens = instance.#collectInvolvedTokens(validatedIds);
            Logger.debug("(PartyCruncher.findParty) involvedTokens: ", involvedTokens);

            // Step 3 — Decide what to focus on, depending on the chosen group's status in the scene
            const isLeader = instance.#isLeaderMode(validatedIds.memberTokenIds, validatedIds.partyTokenId);

            let isGrouped;
            if (isLeader) {
                const nonLeaderMembers = involvedTokens.memberTokens.filter(
                    t => t.id !== validatedIds.partyTokenId
                );
                isGrouped = nonLeaderMembers.every(t => t.document.hidden);
            } else {
                isGrouped = !involvedTokens.partyToken.document.hidden;
            }

            if (!isGrouped) {
                // Exploded — select only the leader token and pan to it.
                // In leader mode the partyToken is a visible member (the leader).
                // In classic mode the partyToken is hidden; fall back to the first visible member.
                const leaderToken = !involvedTokens.partyToken.document.hidden
                    ? involvedTokens.partyToken
                    : involvedTokens.memberTokens.find(t => !t.document.hidden);

                if (leaderToken) {
                    canvas.tokens.releaseAll();
                    leaderToken.control({ releaseOthers: true });
                    canvas.animatePan(leaderToken.getCenterPoint({ x: leaderToken.x, y: leaderToken.y }));
                }
            } else {
                // Crunched — select and pan to the party / leader token
                involvedTokens.partyToken.control({releaseOthers: true});
                canvas.animatePan(involvedTokens.partyToken.getCenterPoint({x: involvedTokens.partyToken.x, y: involvedTokens.partyToken.y}));
            }

        } catch (e) {
            Logger.error(false, e);
            return;
        } finally {
            await PartyCruncher.setBusy(false);
        }

        Logger.debug(`FINDing of group ${groupId} complete.`);
    }

    /**
     * Public method: Gather all visible group members around the leader using animated movement.
     * Members walk naturally toward the leader and position in formation without being hidden.
     * Only works when the group is exploded (members visible and spread out).
     * @param {string|null} groupId - The unique group identifier, or null for scene fallback
     * @returns {Promise<void>}
     */
    static async getOverHere(groupId = null) {

        if (!PartyCruncher.#requireGM("getOverHere")) return;

        if (PartyCruncher.isBusy()) {
            Logger.warn(false, Config.localize("errMsg.pleaseWaitStillBusy"));
            return;
        }

        groupId = PartyCruncher.#resolveGroupIdFromArgumentOrScene(groupId, "getOverHere");
        if (groupId == null) return;

        Logger.debug(`(PartyCruncher.getOverHere) GATHER - groupId: ${groupId} ...`);

        const instance = PartyCruncher.#getInstance(groupId);

        try {

            await PartyCruncher.setBusy(true);

            // Step 1 — Read & validate group data from settings
            const validatedIds = instance.#collectValidatedIdsFromSettings(groupId);
            Logger.debug("(PartyCruncher.getOverHere) validatedIds: ", validatedIds);

            // Step 2 — Gather and validate all the involved tokens from current scene
            const involvedTokens = instance.#collectInvolvedTokens(validatedIds);
            Logger.debug("(PartyCruncher.getOverHere) involvedTokens: ", involvedTokens);

            // Step 3 — Focus on the leader token
            const targetToken = involvedTokens.partyToken;
            if (targetToken?.name === undefined) {
                Logger.warn(false, Config.localize("errMsg.pleaseActivateTokenLayer"));
                return;
            }
            canvas.tokens.releaseAll();
            targetToken.control({ releaseOthers: true });
            canvas.animatePan(PartyCruncher.#getTokenCenter(targetToken));

            // Step 4 — Execute the gather
            Logger.info(`Gathering group ${groupId} around leader ...`);
            await gatherParty(involvedTokens, targetToken);

        } catch (e) {
            Logger.error(false, e);
            return;
        } finally {
            await PartyCruncher.setBusy(false);
        }

        Logger.info(`... Gathering of group ${groupId} complete.`);
    }

    /**
     * Public method: Send a chosen number of visible group members toward
     * GM-targeted enemy tokens. Members animate ("Get Over Here" style) and
     * cluster around each target. If there are multiple targets, members are
     * distributed round-robin across them.
     * @param {string|null} groupId
     */
    static async killThemAll(groupId = null) {

        if (!PartyCruncher.#requireGM("killThemAll")) return;

        if (PartyCruncher.isBusy()) {
            Logger.warn(false, Config.localize("errMsg.pleaseWaitStillBusy"));
            return;
        }

        groupId = PartyCruncher.#resolveGroupIdFromArgumentOrScene(groupId, "killThemAll");
        if (groupId == null) return;

        // Get GM-targeted tokens
        const targets = Array.from(game.user.targets);
        if (targets.length === 0) {
            ui.notifications.warn(`[${Config.data.modTitle}] No targets selected.`);
            return;
        }

        Logger.debug(`(PartyCruncher.killThemAll) groupId: ${groupId}, targets: ${targets.length}`);

        const instance = PartyCruncher.#getInstance(groupId);

        const validatedIds = instance.#collectValidatedIdsFromSettings(groupId);
        const involvedTokens = instance.#collectInvolvedTokens(validatedIds);

        // Visible non-leader members only
        const visibleMembers = involvedTokens.memberTokens.filter(t =>
            t.id !== involvedTokens.partyToken.id && !t.document.hidden
        );

        if (visibleMembers.length === 0) {
            ui.notifications.warn(`[${Config.data.modTitle}] No visible members to send.`);
            return;
        }

        // Let the GM choose how many members to send
        const { confirmed, count } = await KillThemAll.open(visibleMembers.length, targets.length);
        if (!confirmed || count < 1) return;

        const selectedMembers = visibleMembers.slice(0, count);

        // Round-robin distribute members across targets
        const memberGroups = targets.map(() => []);
        selectedMembers.forEach((m, i) => memberGroups[i % targets.length].push(m));

        try {
            await PartyCruncher.setBusy(true);

            canvas.tokens.releaseAll();
            playActionAudio('audioFile4KillThemAll');
            await gatherToTargets(memberGroups, targets);

        } catch (e) {
            Logger.error(false, e);
        } finally {
            await PartyCruncher.setBusy(false);
        }

        Logger.info(`... killThemAll of group ${groupId} complete.`);
    }

    /**
     * Public method: Spread visible group members to evenly-distributed positions
     * within a configurable circle radius around the leader. Members walk using
     * A* pathfinding to avoid walls.
     * Only available for the leader token when the group is exploded.
     * @param {string|null} groupId - The unique group identifier, or null for scene fallback
     * @returns {Promise<void>}
     */
    static async getInPosition(groupId = null) {

        if (!PartyCruncher.#requireGM("getInPosition")) return;

        if (PartyCruncher.isBusy()) {
            Logger.warn(false, Config.localize("errMsg.pleaseWaitStillBusy"));
            return;
        }

        groupId = PartyCruncher.#resolveGroupIdFromArgumentOrScene(groupId, "getInPosition");
        if (groupId == null) return;

        Logger.debug(`(PartyCruncher.getInPosition) SPREAD - groupId: ${groupId} ...`);

        const instance = PartyCruncher.#getInstance(groupId);
        const radius = Config.setting('getInPositionRadius') || 30;

        try {

            await PartyCruncher.setBusy(true);

            // Step 1 — Read & validate group data from settings
            const validatedIds = instance.#collectValidatedIdsFromSettings(groupId);
            Logger.debug("(PartyCruncher.getInPosition) validatedIds: ", validatedIds);

            // Step 2 — Gather and validate all the involved tokens from current scene
            const involvedTokens = instance.#collectInvolvedTokens(validatedIds);
            Logger.debug("(PartyCruncher.getInPosition) involvedTokens: ", involvedTokens);

            // Step 3 — Focus on the leader token
            const targetToken = involvedTokens.partyToken;
            if (targetToken?.name === undefined) {
                Logger.warn(false, Config.localize("errMsg.pleaseActivateTokenLayer"));
                return;
            }
            canvas.tokens.releaseAll();
            targetToken.control({ releaseOthers: true });
            canvas.animatePan(PartyCruncher.#getTokenCenter(targetToken));

            // Step 4 — Execute the spread within circle
            Logger.info(`Spreading group ${groupId} into position (radius: ${radius}) ...`);
            await spreadInCircle(involvedTokens, targetToken, radius);

        } catch (e) {
            Logger.error(false, e);
            return;
        } finally {
            await PartyCruncher.setBusy(false);
        }

        Logger.info(`... Get in Position for group ${groupId} complete.`);
    }

    /**
     * Public method: Save the current relative positions of visible members as a formation.
     * Only works when the group is exploded and members are spread out (not stacked on the leader).
     * @param {string|null} groupId
     * @returns {Promise<void>}
     */
    static async saveFormation(groupId = null) {

        if (!PartyCruncher.#requireGM("saveFormation")) return;

        groupId = PartyCruncher.#resolveGroupIdFromArgumentOrScene(groupId, "saveFormation");
        if (groupId == null) return;

        const group = Config.getGroup(groupId);
        if (!group) return;

        const gs = canvas.grid.size;
        const leaderToken = canvas.tokens.get(group.partyTokenId);
        if (!leaderToken) {
            ui.notifications.warn(`[${Config.data.modTitle}] Leader token not found on canvas.`);
            return;
        }

        const { w: lw, h: lh } = { w: leaderToken.document?.width ?? 1, h: leaderToken.document?.height ?? 1 };
        const leaderCenterCellX = Math.floor(leaderToken.document.x / gs) + Math.floor(lw / 2);
        const leaderCenterCellY = Math.floor(leaderToken.document.y / gs) + Math.floor(lh / 2);

        const nonLeaderIds = group.memberTokenIds.filter(id => id !== group.partyTokenId);
        const formation = {};
        let savedCount = 0;

        for (const memberId of nonLeaderIds) {
            const memberToken = canvas.tokens.get(memberId);
            if (!memberToken || memberToken.document.hidden) continue;

            const memberCellX = Math.floor(memberToken.document.x / gs);
            const memberCellY = Math.floor(memberToken.document.y / gs);
            const dx = memberCellX - leaderCenterCellX;
            const dy = memberCellY - leaderCenterCellY;

            // Skip members stacked on the leader (dx=0, dy=0 means on top)
            if (dx === 0 && dy === 0) continue;

            formation[memberId] = { dx, dy };
            savedCount++;
        }

        if (savedCount === 0) {
            ui.notifications.warn(`[${Config.data.modTitle}] No members outside the leader to save. Spread members first.`);
            return;
        }

        await Config.updateGroup(groupId, { formation });
        ui.notifications.info(`[${Config.data.modTitle}] Formation saved (${savedCount} member positions).`);
        Logger.info(`Formation saved for group ${groupId}: ${savedCount} positions.`);
    }

    /**
     * Public method: Move visible members to their previously saved formation positions
     * relative to the leader. Uses the same animated movement as getOverHere.
     * @param {string|null} groupId
     * @returns {Promise<void>}
     */
    static async loadFormation(groupId = null) {

        if (!PartyCruncher.#requireGM("loadFormation")) return;

        if (PartyCruncher.isBusy()) {
            Logger.warn(false, Config.localize("errMsg.pleaseWaitStillBusy"));
            return;
        }

        groupId = PartyCruncher.#resolveGroupIdFromArgumentOrScene(groupId, "loadFormation");
        if (groupId == null) return;

        const group = Config.getGroup(groupId);
        if (!group?.formation || Object.keys(group.formation).length === 0) {
            ui.notifications.warn(`[${Config.data.modTitle}] No saved formation for this group.`);
            return;
        }

        Logger.debug(`(PartyCruncher.loadFormation) LOAD FORMATION - groupId: ${groupId} ...`);

        const instance = PartyCruncher.#getInstance(groupId);

        try {

            await PartyCruncher.setBusy(true);

            const validatedIds = instance.#collectValidatedIdsFromSettings(groupId);
            const involvedTokens = instance.#collectInvolvedTokens(validatedIds);

            const targetToken = involvedTokens.partyToken;
            if (targetToken?.name === undefined) {
                Logger.warn(false, Config.localize("errMsg.pleaseActivateTokenLayer"));
                return;
            }
            canvas.tokens.releaseAll();
            targetToken.control({ releaseOthers: true });
            canvas.animatePan(PartyCruncher.#getTokenCenter(targetToken));

            Logger.info(`Loading formation for group ${groupId} ...`);
            await moveToFormation(involvedTokens, targetToken, group.formation);

        } catch (e) {
            Logger.error(false, e);
            return;
        } finally {
            await PartyCruncher.setBusy(false);
        }

        Logger.info(`... Formation loaded for group ${groupId}.`);
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Private — Data collection & validation (ID-based)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Reads group data from Config and returns the validated ID set.
     * @param {string} groupId
     * @returns {{ memberTokenIds: string[], partyTokenId: string }}
     */
    #collectValidatedIdsFromSettings(groupId) {
        const group = Config.getGroup(groupId);
        if (!group) {
            throw new Error(`${Config.localize('errMsg.pleaseCheckYourTokenSelection')}: group not found (${groupId})`);
        }
        return PartyCruncher.#validateIds({
            memberTokenIds: group.memberTokenIds,
            partyTokenId: group.partyTokenId
        });
    }

    /**
     * Reads token IDs from the current canvas selection.
     * Requires at least 2 tokens selected.
     * @returns {{ memberTokenIds: string[], partyTokenId: null }}
     */
    static #collectIdsFromTokenSelection() {
        const controlled = canvas.tokens.controlled;
        if (controlled.length < 2) {
            throw new Error(Config.localize('errMsg.invalidNumberOfMemberTokens'));
        }
        return {
            memberTokenIds: controlled.map(t => t.id),
            partyTokenId: null
        };
    }

    /**
     * Detect if this configuration is using Leader Mode.
     * Leader Mode: the partyTokenId is one of the memberTokenIds (the leader is part of the group).
     * Classic Mode: partyToken is an external token not in the members list.
     * @param {string[]} memberTokenIds
     * @param {string} partyTokenId
     * @returns {boolean}
     */
    #isLeaderMode(memberTokenIds, partyTokenId) {
        if (!partyTokenId || !memberTokenIds) return false;
        return memberTokenIds.includes(partyTokenId);
    }

    /**
     * Validates the token ID set: checks count, existence in scene, and leader/classic mode rules.
     * IDs are unique by definition — no name-collision checks needed.
     * @param {object} data - { memberTokenIds, partyTokenId }
     * @returns {{ memberTokenIds: string[], partyTokenId: string }}
     */
    static #validateIds(data) {
        Logger.debug("(PartyCruncher.#validateIds) data: ", data);

        if (!data.memberTokenIds || data.memberTokenIds.length === 0) {
            throw new Error(
                `${Config.localize('errMsg.pleaseCheckYourTokenSelection')}:<br/><br/>` +
                `<strong>${Config.localize('errMsg.invalidTokenCount')}</strong>`
            );
        }

        if (!data.partyTokenId) {
            throw new Error(
                `${Config.localize('errMsg.pleaseCheckYourTokenSelection')}:<br/><br/>` +
                `<strong>${Config.localize('errMsg.invalidTokenCount')}</strong>`
            );
        }

        // Remove duplicate IDs
        data.memberTokenIds = [...new Set(data.memberTokenIds)];

        // Check max 25 members (hard limit due to spiral math for EXPLODE positions)
        if (data.memberTokenIds.length > 25) {
            throw new Error(
                `${Config.localize('errMsg.tooManyMemberTokens')} (${data.memberTokenIds.length})!<br/>` +
                `${Config.localize('errMsg.invalidNumberOfMemberTokens')}`
            );
        }

        return {
            memberTokenIds: data.memberTokenIds,
            partyTokenId: data.partyTokenId
        };
    }

    /**
     * Looks up tokens by their document IDs on the canvas.
     * Throws if any token is missing from the current scene.
     * @param {string[]} tokenIds
     * @returns {Token[]}
     */
    #collectTokensById(tokenIds) {
        const tokens = [];
        const missing = [];
        for (const id of tokenIds) {
            const token = canvas.tokens.get(id);
            if (token) {
                tokens.push(token);
            } else {
                missing.push(id);
            }
        }
        if (missing.length > 0) {
            // Resolve any names we can for a friendly error
            const names = missing.map(id => Config.resolveTokenName(canvas.scene.id, id));
            throw new Error(`${Config.localize('errMsg.tokensMissingInScene')}: ${names.join(', ')}`);
        }
        return tokens;
    }

    /**
     * Collects all involved tokens from the current scene by their IDs.
     * In Leader Mode the partyToken IS one of the members — no separate external token needed.
     * @param {object} ids - { memberTokenIds, partyTokenId }
     * @returns {{ partyToken: Token, memberTokens: Token[] }}
     */
    #collectInvolvedTokens(ids) {
        const isLeader = this.#isLeaderMode(ids.memberTokenIds, ids.partyTokenId);
        const memberTokens = this.#collectTokensById(ids.memberTokenIds);

        let partyToken;
        if (isLeader) {
            partyToken = memberTokens.find(t => t.id === ids.partyTokenId);
        } else {
            partyToken = this.#collectTokensById([ids.partyTokenId])[0];
        }

        if (!partyToken) {
            const partyName = Config.resolveTokenName(canvas.scene.id, ids.partyTokenId);
            throw new Error(
                `${Config.localize('errMsg.pleaseCheckYourTokenSelection')}:<br/><br/>` +
                `${Config.localize('errMsg.tokensMissingInScene')}: ${partyName}`
            );
        }

        return { memberTokens, partyToken };
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Private — Action determination
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Determine current state of involved tokens and derive from it which action is next.
     * Classic Mode: partyToken visible → EXPLODE. partyToken hidden → CRUNCH.
     * Leader Mode:  any non-leader member visible → CRUNCH. All hidden → EXPLODE.
     * @param {{ partyToken: Token, memberTokens: Token[] }} involvedTokens
     * @returns {symbol}
     */
    #determineRequiredAction(involvedTokens) {
        const isLeader = involvedTokens.memberTokens.some(t => t.id === involvedTokens.partyToken.id);

        if (isLeader) {
            const nonLeaderMembers = involvedTokens.memberTokens.filter(
                t => t.id !== involvedTokens.partyToken.id
            );
            const anyNonLeaderVisible = nonLeaderMembers.some(t => !t.document.hidden);

            if (nonLeaderMembers.length === 0) {
                throw new Error(
                    `${Config.localize('errMsg.cannotDetermineAction')}:<br/><br/>` +
                    `${Config.localize('errMsg.membersAndPartyAllHidden')}`
                );
            }

            return anyNonLeaderVisible ? PartyCruncher.Actions.CRUNCH : PartyCruncher.Actions.EXPLODE;

        } else {
            const noOfMembersVisible = involvedTokens.memberTokens.filter(t => !t.document.hidden);
            const isPartyVisible = !involvedTokens.partyToken.document.hidden;

            if (!isPartyVisible && noOfMembersVisible.length === 0) {
                throw new Error(
                    `${Config.localize('errMsg.cannotDetermineAction')}:<br/><br/>` +
                    `${Config.localize('errMsg.membersAndPartyAllHidden')}`
                );
            }

            return isPartyVisible ? PartyCruncher.Actions.EXPLODE : PartyCruncher.Actions.CRUNCH;
        }
    }

    /**
     * Returns the party token as the fixed anchor for both CRUNCH and EXPLODE.
     * All members always converge on / expand from the leader's position.
     * @param {symbol} requiredAction
     * @param {{ partyToken: Token, memberTokens: Token[] }} involvedTokens
     * @returns {Token}
     */
    #getTarget(requiredAction, involvedTokens) {
        return involvedTokens.partyToken;
    }
}
