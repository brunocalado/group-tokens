import { Config } from './config.js';
import { Logger } from './logger.js';
import { PartyCruncher } from './party-cruncher.js';

const MOD_ID = "group-tokens";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * AppV2 confirmation dialog shown when a group transfer is intercepted.
 * Uses the scene-transfer-dialog.hbs template to display transfer details.
 */
class TransferPromptApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'gt-transfer-window',
        classes: ['gt-transfer-app'],
        window: { title: "Group Tokens — Transfer Group" },
        position: { width: 380 }
    };

    static PARTS = {
        main: { template: 'modules/group-tokens/templates/scene-transfer-dialog.hbs' }
    };

    /**
     * @param {Function} resolveFn - Promise resolve callback
     * @param {object} contextData - Template data for the HBS template
     */
    constructor(resolveFn, contextData) {
        super({});
        this.resolveFn = resolveFn;
        this.contextData = contextData;
        this.hasResolved = false;
    }

    /**
     * Provides template data to the HBS template.
     * @returns {Promise<object>}
     */
    async _prepareContext() { return this.contextData; }

    /**
     * Wires up confirm/cancel button listeners after the template renders.
     * AppV2 lifecycle: called after DOM insertion.
     * @param {object} context
     * @param {object} options
     */
    _onRender(context, options) {
        super._onRender(context, options);
        this.element.querySelector('#gt-tr-confirm')?.addEventListener('click', () => this._finish(true));
        this.element.querySelector('#gt-tr-cancel')?.addEventListener('click', () => this._finish(false));
    }

    /**
     * Resolves the promise exactly once and closes the window.
     * @param {boolean} result
     */
    _finish(result) {
        if (!this.hasResolved) {
            this.hasResolved = true;
            this.resolveFn(result);
        }
        this.close();
    }

    /**
     * Ensures the promise resolves with false if closed via title bar or Escape.
     * @param {object} options
     * @returns {Promise<void>}
     */
    async close(options) {
        if (!this.hasResolved) {
            this.hasResolved = true;
            this.resolveFn(false);
        }
        return super.close(options);
    }
}

/**
 * AppV2 scene picker dialog for choosing a transfer destination.
 * Uses the scene-picker-dialog.hbs template.
 */
class ScenePickerApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'gt-scene-pick-window',
        classes: ['gt-scene-pick-app'],
        window: { title: "Transfer Group — Choose Destination" },
        position: { width: 340 }
    };

    static PARTS = {
        main: { template: 'modules/group-tokens/templates/scene-picker-dialog.hbs' }
    };

    /**
     * @param {Function} resolveFn - Promise resolve callback
     * @param {Array<{id: string, name: string, isActive: boolean}>} scenes - Available scenes
     */
    constructor(resolveFn, scenes) {
        super({});
        this.resolveFn = resolveFn;
        this.scenes = scenes;
        this.hasResolved = false;
    }

    /**
     * Provides template data to the HBS template.
     * @returns {Promise<object>}
     */
    async _prepareContext() { return { scenes: this.scenes }; }

    /**
     * Wires up confirm/cancel button listeners after the template renders.
     * AppV2 lifecycle: called after DOM insertion.
     * @param {object} context
     * @param {object} options
     */
    _onRender(context, options) {
        super._onRender(context, options);
        this.element.querySelector('#gt-tr-confirm')?.addEventListener('click', () => {
            const sceneId = this.element.querySelector('#gt-scene-select')?.value;
            this._finish(sceneId ? game.scenes.get(sceneId) : null);
        });
        this.element.querySelector('#gt-tr-cancel')?.addEventListener('click', () => this._finish(null));
    }

    /**
     * Resolves the promise exactly once and closes the window.
     * @param {Scene|null} result
     */
    _finish(result) {
        if (!this.hasResolved) {
            this.hasResolved = true;
            this.resolveFn(result);
        }
        this.close();
    }

    /**
     * Ensures the promise resolves with null if closed via title bar or Escape.
     * @param {object} options
     * @returns {Promise<void>}
     */
    async close(options) {
        if (!this.hasResolved) {
            this.hasResolved = true;
            this.resolveFn(null);
        }
        return super.close(options);
    }
}

/**
 * SceneTransfer
 *
 * Handles transferring a group (party token + all member tokens) from one scene
 * to another, preserving token data including unlinked token deltas (HP, items,
 * effects, etc. stored directly on the token).
 *
 * Two entry points:
 *  1. preCreateToken hook — intercepts when a group token is drag-dropped or
 *     copy-pasted into a different scene, cancels the default creation, and
 *     runs the full transfer instead. Detection uses module flags stamped on tokens.
 *  2. SceneTransfer.transferGroup(groupId, destScene) — callable from macros,
 *     the Dashboard, or ExecuteScript region behaviors.
 */
export class SceneTransfer {

    // Lock set: keys are "groupId:destSceneId" — prevents the hook from firing
    // multiple times for the same paste operation (Foundry fires preCreateToken
    // once per token when pasting a multi-token selection)
    static #pendingTransfers = new Set();

    // Flag to suppress our own hook during createEmbeddedDocuments
    static #ownCreation = false;

    /**
     * Registers the preCreateToken hook, wraps RegionDocument.teleportToken to
     * intercept group token region teleports, and exposes class globally.
     * Called during module setup via initExposedClasses().
     */
    static init() {
        Hooks.on('preCreateToken', SceneTransfer._onPreCreateToken);
        SceneTransfer._wrapRegionTeleport();
        window.SceneTransfer = SceneTransfer;
        Logger.info("Scene transfer initialized.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Region teleport intercept
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Wraps RegionDocument.prototype.teleportToken to suppress the
     * "Failed to create Token in destination Scene" error for group tokens.
     * When a group token enters a teleport region, our preCreateToken hook
     * cancels the single-token creation (returning false) and schedules the
     * full group transfer. That cancellation makes the native teleportToken
     * throw — this wrapper catches that error silently so it never reaches
     * the console.
     */
    static _wrapRegionTeleport() {
        const original = RegionDocument.prototype.teleportToken;

        RegionDocument.prototype.teleportToken = async function(token, ...args) {
            const groupId = token.flags?.[MOD_ID]?.groupId;
            if (!groupId || !Config.getGroup(groupId)) {
                return original.call(this, token, ...args);
            }

            // The original will throw because preCreateToken returns false
            // for group tokens. Our hook already scheduled the full group
            // transfer, so we swallow the error.
            try {
                return await original.call(this, token, ...args);
            } catch (err) {
                Logger.debug(`(SceneTransfer) Suppressed region teleport error for group ${groupId}: ${err.message}`);
            }
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Hook handler
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Fires before a token is created in any scene.
     * Uses the module flag `group-tokens.groupId` (stamped during groupParty) to detect
     * group tokens being pasted into a different scene.
     *
     * @param {TokenDocument} tokenDoc
     * @param {object} data - creation data
     * @param {object} options
     * @param {string} userId
     * @returns {boolean|void} return false cancels the default creation
     */
    static _onPreCreateToken(tokenDoc, data, _options, userId) {
        if (SceneTransfer.#ownCreation) return;
        if (userId !== game.userId) return;
        if (!game.user.isGM) return;

        const destScene = tokenDoc.parent;
        if (!destScene) return;

        // Check for module flag — this is how we detect group tokens across scenes
        const groupId = data.flags?.[MOD_ID]?.groupId;
        if (!groupId) return;

        const group = Config.getGroup(groupId);
        if (!group) return;

        // Determine whether this is the party/leader token.
        // Primary detection uses the `role` and `tokenId` flags stamped by stampGroupFlags.
        // Fallback: if neither flag is present (groups created before the fix), treat the
        // first token of this group we see (no pending transfer yet) as the trigger.
        if (group.partyTokenId) {
            const isPartyToken = group.partyTokenId === data.flags?.[MOD_ID]?.tokenId
                || data.flags?.[MOD_ID]?.role === 'party';

            if (!isPartyToken) {
                const lockKey = `${groupId}:${destScene.id}`;
                if (SceneTransfer.#pendingTransfers.has(lockKey)) {
                    // A transfer for this group is already running — cancel the extra paste
                    Logger.debug(`(SceneTransfer) Cancelling duplicate paste for group ${groupId}`);
                    return false;
                }
                // Flags not stamped yet (legacy group): fall through and trigger transfer
                // as if this were the party token. This handles Ctrl+C/V on any group token.
                Logger.debug(`(SceneTransfer) No role flag on token — treating as party token for group ${groupId}`);
            }
        }

        const originScene = game.scenes.get(group.sceneId);
        if (!originScene) return;

        // Same-scene paste: reposition all group tokens relative to the drop point
        // instead of creating a duplicate token. The default creation is cancelled.
        if (originScene.id === destScene.id) {
            const lockKey = `${groupId}:same`;
            if (SceneTransfer.#pendingTransfers.has(lockKey)) return false;
            SceneTransfer.#pendingTransfers.add(lockKey);

            const dropX = data.x ?? 0;
            const dropY = data.y ?? 0;
            setTimeout(async () => {
                try {
                    await SceneTransfer._repositionGroup(group, originScene, { x: dropX, y: dropY });
                } finally {
                    setTimeout(() => SceneTransfer.#pendingTransfers.delete(lockKey), 2000);
                }
            }, 0);
            return false;
        }

        const lockKey = `${groupId}:${destScene.id}`;
        if (SceneTransfer.#pendingTransfers.has(lockKey)) {
            Logger.debug(`(SceneTransfer) Duplicate preCreateToken for group ${groupId} — cancelled`);
            return false;
        }

        SceneTransfer.#pendingTransfers.add(lockKey);
        Logger.info(`(SceneTransfer) Intercepted group ${groupId} token drop into scene "${destScene.name}"`);

        // Serialize ALL tokens NOW — synchronously before setTimeout
        const capturedMemberData = originScene.tokens.contents
            .filter(t => group.memberTokenIds.includes(t.id))
            .map(t => {
                const d = t.toObject();
                delete d._id;
                return { tokenData: d, x: t.x, y: t.y, id: t.id };
            });

        const partyTokenInOrigin = originScene.tokens.get(group.partyTokenId);
        const capturedPartyData = partyTokenInOrigin
            ? { tokenData: (() => { const d = partyTokenInOrigin.toObject(); delete d._id; return d; })(),
                x: partyTokenInOrigin.x, y: partyTokenInOrigin.y, id: partyTokenInOrigin.id }
            : null;

        const dropPosition = { x: data.x ?? 0, y: data.y ?? 0 };

        setTimeout(async () => {
            try {
                await SceneTransfer._promptAndTransfer(group, originScene, destScene, dropPosition, capturedMemberData, capturedPartyData);
            } finally {
                setTimeout(() => SceneTransfer.#pendingTransfers.delete(lockKey), 2000);
            }
        }, 0);

        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Public API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Transfer a group from its current scene to a destination scene.
     * Preserves full token data including unlinked token deltas.
     *
     * @param {string} groupId
     * @param {Scene} [destScene] - destination scene; if null, shows a picker dialog
     */
    static async transferGroup(groupId, destScene = null) {
        if (!game.user.isGM) {
            ui.notifications.warn(`[${Config.data.modTitle}] GM only.`);
            return;
        }

        const group = Config.getGroup(groupId);
        if (!group || (!group.partyTokenId && group.memberTokenIds.length === 0)) {
            ui.notifications.warn(`[${Config.data.modTitle}] Group is not configured.`);
            return;
        }

        const originScene = game.scenes.get(group.sceneId);
        if (!originScene) {
            ui.notifications.warn(`[${Config.data.modTitle}] Could not find the group's scene.`);
            return;
        }

        if (!destScene) {
            destScene = await SceneTransfer._pickDestinationScene(originScene);
            if (!destScene) return;
        }

        if (destScene.id === originScene.id) {
            ui.notifications.info(`[${Config.data.modTitle}] Group is already in scene "${destScene.name}".`);
            return;
        }

        await SceneTransfer._executeTransfer(group, originScene, destScene, null);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Show a confirmation dialog after intercept, then execute transfer.
     * @param {object} group
     * @param {Scene} originScene
     * @param {Scene} destScene
     * @param {{x,y}} dropPosition
     * @param {object[]|null} capturedMemberData
     * @param {object|null} capturedPartyData
     * @returns {Promise<boolean>}
     */
    static async _promptAndTransfer(group, originScene, destScene, dropPosition, capturedMemberData = null, capturedPartyData = null) {
        const partyTokenName = Config.resolveTokenName(group.sceneId, group.partyTokenId);
        const memberNames = group.memberTokenIds.map(id => Config.resolveTokenName(group.sceneId, id));

        const contextData = {
            groupIndex: Config.getGroups().findIndex(g => g.id === group.id) + 1,
            originSceneName: originScene.name,
            destSceneName:   destScene.name,
            partyTokenName,
            memberCount:     memberNames.length,
            memberNames:     memberNames.join(', ')
        };

        const confirmed = await new Promise(resolve => {
            new TransferPromptApp(resolve, contextData).render(true);
        });

        if (confirmed) {
            await SceneTransfer._executeTransfer(group, originScene, destScene, dropPosition, capturedMemberData, capturedPartyData);
            return true;
        }
        return false;
    }

    /**
     * Show a scene picker dialog and return the chosen Scene.
     * @param {Scene} originScene - excluded from the list
     * @returns {Promise<Scene|null>}
     */
    static async _pickDestinationScene(originScene) {
        const scenes = game.scenes.contents.filter(s => s.id !== originScene.id);
        if (scenes.length === 0) {
            ui.notifications.warn(`[${Config.data.modTitle}] No other scenes available.`);
            return null;
        }

        const sceneList = scenes.map(s => ({
            id:       s.id,
            name:     s.name,
            isActive: s.id === game.scenes.active?.id
        }));

        return new Promise(resolve => {
            new ScenePickerApp(resolve, sceneList).render(true);
        });
    }

    /**
     * Core transfer logic.
     * Serializes all group tokens (party + members) from originScene,
     * creates them in destScene, then deletes originals.
     * After creation, remaps the stored token IDs and sceneId in the group setting.
     *
     * @param {object} group
     * @param {Scene} originScene
     * @param {Scene} destScene
     * @param {{x,y}|null} dropPosition
     * @param {object[]|null} capturedMemberData
     * @param {object|null} capturedPartyData
     */
    static async _executeTransfer(group, originScene, destScene, dropPosition = null, capturedMemberData = null, capturedPartyData = null) {
        if (PartyCruncher.isBusy()) {
            ui.notifications.warn(`[${Config.data.modTitle}] Please wait for the current action to complete.`);
            return;
        }

        await PartyCruncher.setBusy(true);
        try {
            // Collect token data — prefer pre-captured (from hook), else read live from originScene
            const partySource = capturedPartyData
                ?? (() => {
                    const doc = originScene.tokens.get(group.partyTokenId);
                    if (!doc) return null;
                    const d = doc.toObject();
                    delete d._id;
                    return { tokenData: d, x: doc.x, y: doc.y, id: doc.id };
                })();

            const memberSource = capturedMemberData
                ?? originScene.tokens.contents
                    .filter(t => group.memberTokenIds.includes(t.id))
                    .map(t => {
                        const d = t.toObject();
                        delete d._id;
                        return { tokenData: d, x: t.x, y: t.y, id: t.id };
                    });

            if (!partySource && memberSource.length === 0) {
                ui.notifications.error(`[${Config.data.modTitle}] No token data found for this group.`);
                return;
            }

            // Anchor: drop position (from paste) > party origin position > scene center
            const anchor = dropPosition
                ?? (partySource ? { x: partySource.x, y: partySource.y } : null)
                ?? SceneTransfer._getSceneCenter(destScene);

            const partyOriginX = partySource?.x ?? anchor.x;
            const partyOriginY = partySource?.y ?? anchor.y;

            // In leader mode the party token is already inside memberSource — adding it
            // separately would create a duplicate token and break leader mode by making
            // newPartyTokenId fall outside newMemberTokenIds after the ID remap.
            const isLeaderMode = group.memberTokenIds.includes(group.partyTokenId);

            // Tokens arrive in crunched (collapsed) state: only the leader/party
            // token is visible at the anchor; all other members are hidden at (0,0).
            // The GM can then EXPLODE the group to spread members around the leader.
            const tokenDataArray = [];
            if (partySource && !isLeaderMode) {
                // Classic mode: party token visible at anchor
                const d = foundry.utils.deepClone(partySource.tokenData);
                d.x = anchor.x;
                d.y = anchor.y;
                d.hidden = false;
                tokenDataArray.push(d);
            }

            for (const member of memberSource) {
                const d = foundry.utils.deepClone(member.tokenData);
                if (isLeaderMode && member.id === group.partyTokenId) {
                    // Leader token: visible at anchor
                    d.x = anchor.x;
                    d.y = anchor.y;
                    d.hidden = false;
                } else {
                    // Member token: crunched (hidden at 0,0)
                    d.x = 0;
                    d.y = 0;
                    d.hidden = true;
                }
                tokenDataArray.push(d);
            }

            if (tokenDataArray.length === 0) {
                ui.notifications.error(`[${Config.data.modTitle}] No token data found for this group.`);
                return;
            }

            Logger.info(`(SceneTransfer) Transferring ${tokenDataArray.length} tokens from "${originScene.name}" to "${destScene.name}"`);

            // Create in destination scene — disable our hook to avoid self-interception
            SceneTransfer.#ownCreation = true;
            let created = [];
            try {
                created = await destScene.createEmbeddedDocuments("Token", tokenDataArray);
            } finally {
                SceneTransfer.#ownCreation = false;
            }
            Logger.info(`(SceneTransfer) Created ${created.length} tokens in "${destScene.name}"`);

            // Remap token IDs preserving the leader mode relationship.
            // In leader mode all created tokens map 1-to-1 with memberSource (no party offset).
            // In classic mode created[0] is the separate party token, members follow.
            let newPartyTokenId;
            const newMemberTokenIds = [];

            if (isLeaderMode) {
                memberSource.forEach((member, i) => {
                    newMemberTokenIds.push(created[i].id);
                    if (member.id === group.partyTokenId) {
                        newPartyTokenId = created[i].id;
                    }
                });
                // Fallback guard — should never happen if group data is consistent
                if (!newPartyTokenId) newPartyTokenId = created[0].id;
            } else {
                newPartyTokenId = partySource ? created[0].id : group.partyTokenId;
                const memberOffset = partySource ? 1 : 0;
                memberSource.forEach((_, i) => {
                    newMemberTokenIds.push(created[memberOffset + i].id);
                });
            }

            // Update the group setting with new IDs and sceneId
            await Config.updateGroup(group.id, {
                sceneId:        destScene.id,
                partyTokenId:   newPartyTokenId,
                memberTokenIds: newMemberTokenIds
            });

            // Delete originals from origin scene.
            // In leader mode partySource.id is already inside memberSource, so skip it
            // to avoid passing a duplicate ID to deleteEmbeddedDocuments.
            const originIdsToDelete = [];
            if (!isLeaderMode && partySource?.id) originIdsToDelete.push(partySource.id);
            for (const m of memberSource) {
                if (m.id) originIdsToDelete.push(m.id);
            }

            if (originIdsToDelete.length > 0) {
                await originScene.deleteEmbeddedDocuments("Token", originIdsToDelete);
                Logger.info(`(SceneTransfer) Deleted ${originIdsToDelete.length} tokens from "${originScene.name}"`);
            }

            ui.notifications.info(
                `[${Config.data.modTitle}] Group transferred to "${destScene.name}". ` +
                `${created.length} token(s) moved, ${originIdsToDelete.length} removed from origin.`
            );

        } catch (err) {
            Logger.error(false, err);
        } finally {
            await PartyCruncher.setBusy(false);
        }
    }

    /**
     * Find all groups that contain a given groupId in their flags.
     * Used by the preCreateToken hook to cancel duplicate member pastes.
     * @param {string} groupId
     * @returns {object[]}
     */
    static _findGroupsContainingToken(groupId) {
        if (!groupId) return [];
        return Config.getGroups().filter(g => g.id === groupId);
    }

    /**
     * Reposition all tokens in a group within the same scene, anchoring to a new
     * drop position. Called when the leader/party token is pasted in the same scene
     * it already belongs to (Ctrl+C → Ctrl+V on the same canvas).
     * Relative offsets between members are preserved; hidden (crunched) tokens are
     * moved to the anchor so a subsequent EXPLODE places them correctly.
     * @param {object} group
     * @param {Scene} scene
     * @param {{x: number, y: number}} anchor - The paste drop position
     * @returns {Promise<void>}
     */
    static async _repositionGroup(group, scene, anchor) {
        if (PartyCruncher.isBusy()) {
            ui.notifications.warn(`[${Config.data.modTitle}] Please wait for the current action to complete.`);
            return;
        }

        const isLeaderMode = group.memberTokenIds.includes(group.partyTokenId);

        // Gather all tokens that need to move (party token + members, deduplicated)
        const allIds = [...new Set([
            ...(isLeaderMode ? [] : [group.partyTokenId]),
            ...group.memberTokenIds
        ])].filter(Boolean);

        const partyDoc = scene.tokens.get(group.partyTokenId);
        if (!partyDoc) {
            ui.notifications.warn(`[${Config.data.modTitle}] Leader token not found in scene.`);
            return;
        }

        const originX = partyDoc.x;
        const originY = partyDoc.y;

        const updates = [];
        for (const tokenId of allIds) {
            const doc = scene.tokens.get(tokenId);
            if (!doc) continue;

            if (doc.hidden) {
                // Crunched token — move to anchor so EXPLODE works from the new leader position
                updates.push({ _id: tokenId, x: anchor.x, y: anchor.y });
            } else {
                updates.push({
                    _id: tokenId,
                    x:  anchor.x + (doc.x - originX),
                    y:  anchor.y + (doc.y - originY)
                });
            }
        }

        if (updates.length === 0) return;

        SceneTransfer.#ownCreation = true;
        try {
            await scene.updateEmbeddedDocuments("Token", updates);
        } finally {
            SceneTransfer.#ownCreation = false;
        }

        Logger.info(`(SceneTransfer) Repositioned ${updates.length} group tokens to anchor (${anchor.x}, ${anchor.y})`);
        ui.notifications.info(`[${Config.data.modTitle}] Group repositioned to the drop position.`);
    }

    /**
     * Wait until a scene's canvas is fully ready before operating on it.
     * @param {Scene} scene
     * @returns {Promise<void>}
     */
    static _waitForScene(scene) {
        if (canvas.scene?.id === scene.id && canvas.ready) return Promise.resolve();

        return new Promise(resolve => {
            const timeout = setTimeout(() => {
                Logger.debug(`(SceneTransfer) _waitForScene timeout for "${scene.name}" — proceeding`);
                resolve();
            }, 8000);

            Hooks.once('canvasReady', () => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    /**
     * Returns the center coordinates of a scene.
     * @param {Scene} scene
     * @returns {{x: number, y: number}}
     */
    static _getSceneCenter(scene) {
        const dims = scene.dimensions ?? scene.getDimensions?.() ?? {};
        return {
            x: Math.round((dims.width  ?? 1000) / 2),
            y: Math.round((dims.height ?? 1000) / 2)
        };
    }
}
