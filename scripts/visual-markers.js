import { Config } from './config.js';
import { Logger } from './logger.js';

const MOD_ID = "group-tokens";

// Leader badge color (red) and member badge color (steel blue)
const LEADER_COLOR = 0xaa0000;
const MEMBER_COLOR = 0x3a7abf;

/**
 * VisualMarkers
 * Renders PIXI-based badges directly on the canvas over group tokens and member tokens.
 * Only visible to the GM.
 *
 * Each badge shows "G#" (group index) in the top-right corner of the token.
 * A thin colored border is drawn around the token.
 * Crunched (grouped) party tokens get a solid badge; member tokens get a hollow border only.
 */
export class VisualMarkers {

    // Map<tokenId, PIXI.Container> — containers added to the token's parent
    static _containers = new Map();

    /**
     * Registers Foundry hooks for canvas/token lifecycle events.
     * Called during module setup via initExposedClasses().
     */
    static init() {
        // Redraw all markers when the canvas is ready (scene load / reload)
        Hooks.on('canvasReady', () => {
            VisualMarkers._refreshAll();
        });

        // A token was added to the scene
        Hooks.on('createToken', (tokenDoc) => {
            VisualMarkers._refreshToken(tokenDoc.id);
        });

        // A token was updated (position, hidden, name, flags…)
        Hooks.on('updateToken', (tokenDoc) => {
            VisualMarkers._refreshToken(tokenDoc.id);
        });

        // A token was removed
        Hooks.on('deleteToken', (tokenDoc) => {
            VisualMarkers._removeMarker(tokenDoc.id);
        });

        // Settings changed — might affect group membership
        Hooks.on('updateSetting', (settingDoc) => {
            if (settingDoc.key?.startsWith(`${MOD_ID}.`)) {
                VisualMarkers._refreshAll();
            }
        });

        Logger.info("Visual markers (PIXI) initialized.");
    }

    // ─────────────────────────────────────────────────────────────
    //  Public API
    // ─────────────────────────────────────────────────────────────

    /**
     * Refresh all markers in the current scene.
     */
    static _refreshAll() {
        if (!game.user.isGM) return;
        if (!canvas?.tokens) return;

        // Remove stale containers first
        VisualMarkers._containers.forEach((_, id) => VisualMarkers._removeMarker(id));

        for (const token of canvas.tokens.placeables) {
            VisualMarkers._drawMarkerForToken(token);
        }
    }

    /**
     * Refresh the marker for a single token by document id.
     * @param {string} tokenDocId
     */
    static _refreshToken(tokenDocId) {
        if (!game.user.isGM) return;
        if (!canvas?.tokens) return;

        VisualMarkers._removeMarker(tokenDocId);

        const token = canvas.tokens.get(tokenDocId);
        if (token) VisualMarkers._drawMarkerForToken(token);
    }

    /**
     * Remove and destroy the PIXI container for a token.
     * @param {string} tokenDocId
     */
    static _removeMarker(tokenDocId) {
        const container = VisualMarkers._containers.get(tokenDocId);
        if (container) {
            container.destroy({ children: true });
            VisualMarkers._containers.delete(tokenDocId);
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Internal drawing
    // ─────────────────────────────────────────────────────────────

    /**
     * Determine which group (if any) a token belongs to, and draw accordingly.
     * @param {Token} token - canvas placeable
     */
    static _drawMarkerForToken(token) {
        const info = VisualMarkers._getGroupMembership(token);
        if (!info) return;

        const { role, isLeader } = info;
        // Leader/party tokens use red; member tokens use blue.
        const borderColor = isLeader ? LEADER_COLOR : MEMBER_COLOR;

        const container = new PIXI.Container();
        container.name = `gt-marker-${token.id}`;

        const w = token.w;
        const h = token.h;

        // Border around the token
        const border = new PIXI.Graphics();
        const alpha = role === 'party' ? 0.9 : 0.5;
        const lineWidth = role === 'party' ? 3 : 2;
        border.lineStyle(lineWidth, borderColor, alpha);
        border.drawRoundedRect(2, 2, w - 4, h - 4, 6);
        container.addChild(border);

        // Badge (top-right corner)
        const showBadge = role === 'party' && (isLeader || !token.document.hidden);
        if (showBadge) {
            VisualMarkers._addBadge(container, LEADER_COLOR, w, true);
        } else if (role === 'member' && !isLeader) {
            VisualMarkers._addBadge(container, MEMBER_COLOR, w, false);
        }

        token.addChild(container);
        VisualMarkers._containers.set(token.id, container);
    }

    /**
     * Draw a circular badge in the top-right corner of the token.
     * Uses Unicode glyphs: ♛ (\u265B) for leaders, ♟ (\u265F) for members.
     * Both leader and member badges are identical in size for visual consistency.
     * @param {PIXI.Container} container
     * @param {number} color - hex fill color for the badge background
     * @param {number} tokenWidth
     * @param {boolean} isLeaderBadge - true for leader (skull), false for member (pawn)
     */
    static _addBadge(container, color, tokenWidth, isLeaderBadge) {
        const BADGE_SIZE = 22;
        const MARGIN = 4;
        const x = tokenWidth - BADGE_SIZE - MARGIN;
        const y = MARGIN;

        const bg = new PIXI.Graphics();
        bg.beginFill(color, 0.95);
        bg.lineStyle(1.5, 0xffffff, 0.8);
        bg.drawCircle(x + BADGE_SIZE / 2, y + BADGE_SIZE / 2, BADGE_SIZE / 2);
        bg.endFill();
        container.addChild(bg);

        // \u265B = ♛ (Black Chess Queen / Crown) for leaders, \u265F = ♟ (Chess Pawn) for members.
        // Using standard Unicode chess symbols instead of FontAwesome glyphs because PIXI.Text
        // cannot render FA private-use-area codepoints without explicitly loading the font into PIXI.
        // Chess queen reads clearly as a crown at small canvas sizes.
        const iconUnicode = isLeaderBadge ? '\u265B' : '\u265F';

        const style = new PIXI.TextStyle({
            fontFamily: '"Arial Unicode MS", Arial, sans-serif',
            fontSize: 15,
            fill: '#ffffff',
            align: 'center'
        });
        const label = new PIXI.Text(iconUnicode, style);
        // Double resolution prevents sub-pixel aliasing blur on small glyphs.
        label.resolution = (window.devicePixelRatio ?? 1) * 2;
        label.anchor.set(0.5, 0.5);
        label.x = x + BADGE_SIZE / 2;
        label.y = y + BADGE_SIZE / 2;
        container.addChild(label);
    }

    /**
     * Check all configured groups and return { groupIndex, role, isLeader } if this token
     * is the party token or a member of any group.
     * Uses token document ID for matching — immune to name collisions.
     *
     * isLeader: true when this token IS the partyToken AND it is in the member list (leader mode).
     *
     * @param {Token} token
     * @returns {{ groupIndex: number, role: 'party'|'member', isLeader: boolean } | null}
     */
    static _getGroupMembership(token) {
        const tokenId = token.id;
        if (!tokenId) return null;

        const groups = Config.getGroups();
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if (!g.partyTokenId && g.memberTokenIds.length === 0) continue;

            const isLeaderMode = g.memberTokenIds.includes(g.partyTokenId);

            if (g.partyTokenId === tokenId) {
                return { groupIndex: i + 1, role: 'party', isLeader: isLeaderMode };
            }
            if (g.memberTokenIds.includes(tokenId)) {
                return { groupIndex: i + 1, role: 'member', isLeader: false };
            }
        }

        return null;
    }
}
