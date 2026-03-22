import { Config } from './config.js';
import { Logger } from './logger.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Dashboard — AppV2-based singleton window for managing group tokens.
 * Replaces the previous DialogV2-based implementation to leverage native
 * ApplicationV2 lifecycle, action handling, and CSS-driven layout.
 */
export class Dashboard extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @type {Dashboard|null} Singleton instance */
    static #instance;

    /** @type {Set<string>} Tracks which group panels are currently expanded */
    #expandedGroups = new Set();

    static DEFAULT_OPTIONS = {
        id: "gt-dashboard-window",
        classes: ["gt-dashboard-app"],
        window: {
            title: "Dashboard",
            resizable: true
        },
        position: { width: 660, height: 440 },
        actions: {
            toggle: Dashboard.#onToggle,
            find: Dashboard.#onFind,
            transfer: Dashboard.#onTransfer,
            expand: Dashboard.#onExpand,
            findMember: Dashboard.#onFindMember,
            promoteMember: Dashboard.#onPromoteMember,
            removeMember: Dashboard.#onRemoveMember,
            clearGroup: Dashboard.#onClearGroup,
            copyGroupId: Dashboard.#onCopyGroupId
        }
    };

    static PARTS = {
        main: { template: "modules/group-tokens/templates/dashboard.hbs" }
    };

    /**
     * Exposes Dashboard globally for macro and context-menu access.
     * Called during module setup via initExposedClasses().
     */
    static init() {
        window.GroupTokensDashboard = Dashboard;
        Logger.info("Dashboard initialized.");
    }

    /**
     * Opens the Dashboard window as a singleton.
     * Only GMs may open the dashboard.
     */
    static async open() {
        if (!game.user.isGM) {
            ui.notifications.warn(`[${Config.data.modTitle}] GM only.`);
            return;
        }
        if (!Dashboard.#instance) Dashboard.#instance = new Dashboard();
        Dashboard.#instance.render(true);
    }

    // -----------------------------------------
    // DATA PREPARATION
    // -----------------------------------------

    /**
     * Prepares template context with all configured groups.
     * Resolves token names live from the canvas by document ID.
     * @param {object} _options - Render options (unused)
     * @returns {Promise<{groups: object[]}>}
     */
    async _prepareContext(_options) {
        const groups = Config.getGroups().map((g, i) => {
            const info = Dashboard._getGroupInfo(g, i);
            return { ...info, isEmpty: !g.partyTokenId && g.memberTokenIds.length === 0 };
        });
        return { groups };
    }

    /**
     * Extracts display information for a single group by resolving token IDs to names.
     * @param {object} group - The group object from Config
     * @param {number} index - 0-based index in the groups array
     * @returns {object}
     */
    static _getGroupInfo(group, index) {
        const groupIndex = index + 1;
        const partyTokenName = Config.resolveTokenName(group.sceneId, group.partyTokenId);
        const members = group.memberTokenIds
            .filter(id => id !== group.partyTokenId)
            .map(id => ({
                id,
                name: Config.resolveTokenName(group.sceneId, id)
            }));

        const isLeader = group.memberTokenIds.includes(group.partyTokenId);

        let statusClass = 'unknown';
        let statusLabel = '—';

        // Use the scene document collection (canvas.scene.tokens) rather than the canvas
        // placeable layer (canvas.tokens.get) because document data is available as soon
        // as the scene loads, whereas PIXI placeables may not yet exist when the dashboard
        // opens immediately after a scene transition — causing intermittent blank status.
        if (group.partyTokenId && canvas.scene?.id === group.sceneId) {
            if (isLeader) {
                const nonLeaderIds = group.memberTokenIds.filter(id => id !== group.partyTokenId);
                const nonLeaderDocs = nonLeaderIds
                    .map(id => canvas.scene.tokens.get(id))
                    .filter(Boolean);
                if (nonLeaderDocs.length > 0) {
                    const allHidden = nonLeaderDocs.every(t => t.hidden);
                    statusClass = allHidden ? 'grouped' : 'expanded';
                    statusLabel = allHidden ? Config.localize('dashboard.status.grouped') : Config.localize('dashboard.status.expanded');
                }
            } else {
                const partyDoc = canvas.scene.tokens.get(group.partyTokenId);
                if (partyDoc) {
                    statusClass = partyDoc.hidden ? 'expanded' : 'grouped';
                    statusLabel = partyDoc.hidden ? Config.localize('dashboard.status.expanded') : Config.localize('dashboard.status.grouped');
                }
            }
        }

        return {
            groupId: group.id,
            groupIndex,
            partyTokenName,
            members,
            statusClass,
            statusLabel
        };
    }

    // -----------------------------------------
    // RENDER LIFECYCLE
    // -----------------------------------------

    /**
     * Restores expanded panel state after a re-render.
     * AppV2 lifecycle hook — fires after DOM is updated.
     * @param {object} context - The prepared context
     * @param {object} options - Render options
     */
    _onRender(context, options) {
        super._onRender(context, options);
        for (const groupId of this.#expandedGroups) {
            const list = this.element.querySelector(`.gt-members-list[data-group-id="${groupId}"]`);
            const btn = this.element.querySelector(`[data-action="expand"][data-group-id="${groupId}"]`);
            if (list) list.removeAttribute('hidden');
            if (btn) btn.innerHTML = `<i class="fas fa-users"></i> ${Config.localize('dashboard.collapse')}`;
        }
    }

    // -----------------------------------------
    // ACTION HANDLERS
    // -----------------------------------------

    /**
     * Toggles group visibility (crunch/expand all members).
     * Triggered by data-action="toggle" button click.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onToggle(event, target) {
        const groupId = target.dataset.groupId;
        await window.PartyCruncher?.toggleParty(groupId);
    }

    /**
     * Pans and selects the group leader token on the canvas.
     * Triggered by data-action="find" button click.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onFind(event, target) {
        const groupId = target.dataset.groupId;
        await window.PartyCruncher?.findParty(groupId);
    }

    /**
     * Opens the scene transfer dialog for the group.
     * Triggered by data-action="transfer" button click.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onTransfer(event, target) {
        const groupId = target.dataset.groupId;
        await window.SceneTransfer?.transferGroup(groupId);
    }

    /**
     * Toggles the member list visibility for a group.
     * Pure DOM toggle — no re-render needed.
     * Triggered by data-action="expand" button click.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onExpand(event, target) {
        const groupId = target.dataset.groupId;
        const wrapper = target.closest('.gt-group-wrapper');
        const memberList = wrapper?.querySelector('.gt-members-list');
        if (!memberList) return;

        const isHidden = memberList.hasAttribute('hidden');
        if (isHidden) {
            memberList.removeAttribute('hidden');
            target.innerHTML = `<i class="fas fa-users"></i> ${Config.localize('dashboard.collapse')}`;
            this.#expandedGroups.add(groupId);
        } else {
            memberList.setAttribute('hidden', '');
            target.innerHTML = `<i class="fas fa-users"></i> ${Config.localize('dashboard.expand')}`;
            this.#expandedGroups.delete(groupId);
        }
    }

    /**
     * Pans to and selects an individual member token on the canvas.
     * Navigates to the group's scene first if the GM is on a different scene.
     * Triggered by data-action="findMember" button click.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onFindMember(event, target) {
        const memberId = target.dataset.memberId;
        const groupId = target.dataset.groupId;
        const group = Config.getGroup(groupId);
        if (!group) return;

        // Cross-scene guard: navigate to the group's scene if needed
        if (group.sceneId && canvas.scene?.id !== group.sceneId) {
            const targetScene = game.scenes.get(group.sceneId);
            if (!targetScene) {
                ui.notifications.warn(`[${Config.data.modTitle}] ${Config.localize('errMsg.sceneNotFound')}`);
                return;
            }
            await targetScene.view();
            await window.SceneTransfer?._waitForScene(targetScene);
        }

        const token = canvas?.tokens?.get(memberId);
        if (!token) {
            ui.notifications.warn(`[${Config.data.modTitle}] ${Config.localize('errMsg.tokenNotFoundOnScene')}`);
            return;
        }
        canvas.animatePan({ x: token.x, y: token.y, scale: Math.max(canvas.stage.scale.x, 1) });
        token.control({ releaseOthers: true });
    }

    /**
     * Promotes a member to group leader by swapping IDs.
     * Triggered by data-action="promoteMember" button click.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onPromoteMember(event, target) {
        const memberId = target.dataset.memberId;
        const groupId = target.dataset.groupId;
        const group = Config.getGroup(groupId);
        if (!group) return;

        let newMemberIds = [...group.memberTokenIds];

        // Swap: old leader takes the promoted member's slot in the list
        if (!newMemberIds.includes(group.partyTokenId)) {
            newMemberIds = newMemberIds.map(id => id === memberId ? group.partyTokenId : id);
        }

        await Config.updateGroup(groupId, {
            partyTokenId: memberId,
            memberTokenIds: newMemberIds
        });

        this.render(true);
    }

    /**
     * Removes a member from the group.
     * Triggered by data-action="removeMember" button click.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onRemoveMember(event, target) {
        const memberId = target.dataset.memberId;
        const groupId = target.dataset.groupId;
        const group = Config.getGroup(groupId);
        if (!group) return;

        await Config.updateGroup(groupId, {
            memberTokenIds: group.memberTokenIds.filter(id => id !== memberId)
        });

        // Remove the member row from the DOM without a full re-render
        const memberRow = target.closest('.gt-member-row');
        memberRow?.remove();
    }

    /**
     * Clears group configuration after confirmation.
     * Explodes the group first if members are crunched (hidden).
     * Triggered by data-action="clearGroup" button click.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async #onClearGroup(event, target) {
        const groupId = target.dataset.groupId;
        const group = Config.getGroup(groupId);
        if (!group) return;

        const partyName = Config.resolveTokenName(group.sceneId, group.partyTokenId);
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: Config.localize('dashboard.clearTitle') },
            content: `<p>${Config.format('dashboard.clearConfirm', { partyName })}</p>`,
        });

        if (confirmed) {
            const targetScene = game.scenes.get(group.sceneId);

            if (targetScene) {
                // Cross-scene guard: navigate to the target scene if not currently viewing it
                if (canvas.scene?.id !== targetScene.id) {
                    await targetScene.view();
                    if (window.SceneTransfer) {
                        await window.SceneTransfer._waitForScene(targetScene);
                    }
                }

                // A group is crunched if any members are hidden on the canvas
                const isCrunched = group.memberTokenIds.some(id => canvas.scene.tokens.get(id)?.hidden === true);

                if (isCrunched) {
                    // Explode the group to restore members before clearing config
                    await window.PartyCruncher?.toggleParty(groupId);
                }
            }

            await Config.deleteGroup(groupId);
            ui.notifications.info(`[${Config.data.modTitle}] ${Config.localize('dashboard.groupCleared')}`);
            this.render(true);
        }
    }

    static async #onCopyGroupId(event, target) {
        const groupId = target.dataset.groupId;
        if (!groupId) return;
        await navigator.clipboard.writeText(groupId);
        ui.notifications.info(`[${Config.data.modTitle}] Group ID copied: ${groupId}`);
    }
}
