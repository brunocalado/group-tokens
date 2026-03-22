import { Config } from './config.js';
import { Logger } from './logger.js';

const MOD_ID = "group-tokens";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * ApplicationV2-based context menu for Group Tokens actions.
 * Replaces the previous DialogV2 approach to eliminate CSS hacks for hidden
 * footers, dead spacing, and duplicate close buttons.
 */
class ContextMenuApp extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'gt-hud-dialog-window',
        classes: ['gt-context-menu-app'],
        window: { title: 'Group Tokens' },
        position: { width: 300 },
        actions: {
            toggle: async function(event, target) { await window.PartyCruncher?.toggleParty(target.dataset.groupId); this.close(); },
            find: async function(event, target) { await window.PartyCruncher?.findParty(target.dataset.groupId); this.close(); },
            create: async function() {
                const memberIds = this.controlledTokens.map(t => t.id);
                await window.PartyCruncher?.groupParty(null, memberIds, this.originToken.id);
                this.close();
            },
            "add-to-group": async function(event, target) {
                const targetGroupId = target.dataset.groupId;
                const group = Config.getGroup(targetGroupId);
                if (group && group.partyTokenId && !group.memberTokenIds.includes(this.originToken.id)) {
                    await Config.updateGroup(targetGroupId, { memberTokenIds: [...group.memberTokenIds, this.originToken.id] });
                    const groupIdx = Config.getGroups().findIndex(g => g.id === targetGroupId) + 1;
                    ui.notifications.info(`[${Config.data.modTitle}] ${Config.format('contextMenu.addedToGroup', { tokenName: this.originToken.name, groupIndex: groupIdx })}`);
                }
                this.close();
            },
            "get-over-here": async function(event, target) { await window.PartyCruncher?.getOverHere(target.dataset.groupId); this.close(); },
            "kill-them-all": async function(event, target) { this.close(); await window.PartyCruncher?.killThemAll(target.dataset.groupId); },
            "get-in-position": async function(event, target) { await window.PartyCruncher?.getInPosition(target.dataset.groupId); this.close(); },
            "save-formation": async function(event, target) { await window.PartyCruncher?.saveFormation(target.dataset.groupId); this.close(); },
            "load-formation": async function(event, target) { await window.PartyCruncher?.loadFormation(target.dataset.groupId); this.close(); },
            dashboard: function() { window.GroupTokensDashboard?.open(); this.close(); },
            remove: async function() { await ContextMenu._removeFromAllGroups(this.controlledTokens); this.close(); }
        }
    };

    static PARTS = {
        main: { template: 'modules/group-tokens/templates/context-menu-dialog.hbs' }
    };

    /**
     * @param {Token} token - The token the HUD was opened on
     * @param {Token[]} controlled - Tokens that were selected before HUD closed
     */
    constructor(token, controlled) {
        super();
        this.originToken = token;
        this.controlledTokens = controlled;
    }

    /**
     * Builds template context for the context-menu-dialog handlebars template.
     * Triggered by the AppV2 render lifecycle.
     * @returns {object} Template data for context-menu-dialog.hbs
     */
    async _prepareContext() {
        const token = this.originToken;
        const controlled = this.controlledTokens;
        const membership = ContextMenu._getGroupMembership(token);
        const multiSelected = controlled.length >= 2;

        let infoText = '';
        if (membership) {
            const { groupIndex, role } = membership;
            const roleLabel = role === 'party' ? Config.localize('contextMenu.roleParty') : Config.localize('contextMenu.roleMember');
            infoText = `<strong>${token.name}</strong> — ${roleLabel} ${Config.format('contextMenu.ofGroup', { groupIndex })}`;
        } else if (multiSelected) {
            infoText = `${Config.format('contextMenu.multiSelectHint', { count: controlled.length })}<br><em style="font-size:11px;color:#cccccc;">${Config.localize('contextMenu.multiSelectSubHint')}</em>`;
        } else {
            infoText = `<strong>${token.name}</strong> — ${Config.localize('contextMenu.noGroupHint')}`;
        }

        const anyInGroup = controlled.some(t => ContextMenu._getGroupMembership(t));
        const showRemove = membership || anyInGroup;
        const isLeader = membership?.role === 'party';
        const isMember = membership?.role === 'member';
        const leaderGroupIndex = isMember ? (membership?.groupIndex ?? null) : null;

        let leaderHasMembers = false;
        let isGroupExploded = false;
        let hasFormation = false;
        if (isLeader && membership) {
            const group = Config.getGroup(membership.groupId);
            if (group) {
                const nonLeaderIds = group.memberTokenIds.filter(id => id !== group.partyTokenId);
                leaderHasMembers = nonLeaderIds.length > 0;
                // Group is exploded when any non-leader member is visible
                isGroupExploded = nonLeaderIds.some(id => {
                    const tokenDoc = canvas.scene.tokens.get(id);
                    return tokenDoc && !tokenDoc.hidden;
                });
                hasFormation = group.formation && Object.keys(group.formation).length > 0;
            }
        }

        const hasTargets = isLeader && isGroupExploded && game.user.targets.size > 0;

        // Collect scene groups the token can join (only for ungrouped single-token context)
        let joinableGroups = [];
        if (!membership && !multiSelected) {
            const currentSceneId = canvas.scene?.id;
            if (currentSceneId) {
                const allGroups = Config.getGroups();
                joinableGroups = allGroups
                    .filter(g => g.sceneId === currentSceneId)
                    .map(g => ({
                        groupId:        g.id,
                        groupIndex:     allGroups.findIndex(ag => ag.id === g.id) + 1,
                        partyTokenName: Config.resolveTokenName(g.sceneId, g.partyTokenId)
                    }));
            }
        }

        return {
            infoText,
            hasMembership:     !!membership,
            isLeader,
            isMember,
            leaderHasMembers,
            isGroupExploded,
            hasTargets,
            hasFormation,
            leaderGroupIndex,
            groupId:           membership?.groupId ?? null,
            groupIndex:        membership?.groupIndex ?? null,
            canCreate:         multiSelected,
            showRemove:        !!showRemove,
            multiSelected:     controlled.length > 1,
            selectedCount:     controlled.length,
            showFallback:      !membership && !multiSelected && joinableGroups.length === 0,
            joinableGroups,
            hasJoinableGroups: joinableGroups.length > 0
        };
    }
}

export class ContextMenu {

    /**
     * Hooks into the Token HUD to inject the Group Tokens button.
     * Called during module setup via initExposedClasses().
     */
    static init() {
        Hooks.on('renderTokenHUD', (app, html, data) => {
            if (!game.user.isGM) return;
            ContextMenu._injectHUDButton(app, html);
        });
        Logger.info("Token HUD button integration initialized.");
    }

    /**
     * Adds the Group Tokens button to the Token HUD right column.
     * @param {TokenHUD} app
     * @param {HTMLElement} html
     */
    static _injectHUDButton(app, html) {
        const root = html instanceof HTMLElement ? html : html[0];
        if (!root) return;

        const token = app.object ?? app.token;
        if (!token) return;

        const disabledTypes = Config.setting('hudActorTypeFilter') ?? [];
        if (disabledTypes.includes(token.actor?.type)) return;

        const colRight = root.querySelector('.col.right');
        if (!colRight) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.classList.add('control-icon', 'gt-hud-btn');
        btn.setAttribute('data-tooltip', 'Group Tokens');
        btn.innerHTML = '<i class="fas fa-object-group"></i>';

        btn.addEventListener('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            // Dismiss active tooltip before closing HUD — app.close() removes the button from the DOM
            // before pointerleave fires, which would leave the tooltip orphaned on screen.
            game.tooltip.deactivate();
            // Capture selected tokens BEFORE closing HUD — HUD close triggers releaseAll()
            const savedControlled = [...canvas.tokens.controlled];
            app.close?.();
            await ContextMenu._openGroupMenu(token, savedControlled);
        });

        colRight.appendChild(btn);
    }

    /**
     * Instantiates and renders the ApplicationV2 context menu.
     * @param {Token} token - The token the HUD was opened on
     * @param {Token[]} savedControlled - Tokens that were selected before HUD closed
     */
    static async _openGroupMenu(token, savedControlled = null) {
        const controlled = (savedControlled && savedControlled.length > 0) ? savedControlled : canvas.tokens.controlled;
        new ContextMenuApp(token, controlled).render(true);
    }

    /**
     * Checks all configured groups to determine if a token belongs to any of them.
     * Uses token document ID for matching — immune to name collisions.
     * @param {Token} token
     * @returns {{ groupId: string, groupIndex: number, role: 'party'|'member' }|null}
     */
    static _getGroupMembership(token) {
        const tokenId = token.id;
        if (!tokenId) return null;

        const groups = Config.getGroups();
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if (g.partyTokenId === tokenId) return { groupId: g.id, groupIndex: i + 1, role: 'party' };
            if (g.memberTokenIds.includes(tokenId)) return { groupId: g.id, groupIndex: i + 1, role: 'member' };
        }
        return null;
    }

    /**
     * Checks whether a group is in a crunched (collapsed) state by inspecting
     * the hidden flag of its member tokens on the canvas.
     * @param {{ memberTokenIds: string[] }} group
     * @returns {boolean}
     */
    static _isGroupCrunched(group) {
        return group.memberTokenIds.some(id => canvas.scene.tokens.get(id)?.hidden === true);
    }

    /**
     * Removes the given tokens from every group they belong to.
     * If a group becomes empty after removal, it is deleted entirely.
     * When the removed token is the party leader and the group is crunched,
     * the group is exploded first to restore hidden member tokens to the canvas.
     * @param {Token[]} tokens
     */
    static async _removeFromAllGroups(tokens) {
        if (!tokens || tokens.length === 0) {
            ui.notifications.warn(`[${Config.data.modTitle}] ${Config.localize('errMsg.noTokensSelected')}`);
            return;
        }
        const idsToRemove = new Set(tokens.map(t => t.id));
        const groups = Config.getGroups();
        let changed = 0;

        for (const group of groups) {
            const partyRemoved = idsToRemove.has(group.partyTokenId);

            // When removing the leader of a crunched group, explode it first so
            // member tokens are restored to the canvas before the group is torn down.
            if (partyRemoved && ContextMenu._isGroupCrunched(group)) {
                await window.PartyCruncher?.toggleParty(group.id);
            }

            const origMemberCount = group.memberTokenIds.length;
            const filteredMembers = group.memberTokenIds.filter(id => !idsToRemove.has(id));

            if (filteredMembers.length !== origMemberCount || partyRemoved) {
                // Removing the leader always tears down the whole group — members
                // have no valid state without a party token.
                if (partyRemoved) {
                    await Config.deleteGroup(group.id);
                } else {
                    await Config.updateGroup(group.id, { memberTokenIds: filteredMembers });
                }
                changed++;
            }
        }

        const names = tokens.map(t => t.name).join(', ');
        if (changed > 0) {
            ui.notifications.info(`[${Config.data.modTitle}] ${Config.format('contextMenu.removedFromGroups', { tokenNames: names, count: changed })}`);
        } else {
            ui.notifications.info(`[${Config.data.modTitle}] ${Config.format('contextMenu.notInAnyGroup', { tokenNames: names })}`);
        }
    }
}
