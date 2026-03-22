import { Config } from './config.js';
import { Logger } from './logger.js';

const MOD_ID = "group-tokens";
const { ApplicationV2 } = foundry.applications.api;

/**
 * Standalone AppV2 window for picking the group/party token from a set of candidates.
 * Replaces the previous DialogV2-based prompt to avoid duplicate button bars
 * and CSS hacks for hiding default footers.
 */
class PartyPromptApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'gt-prompt-window',
        classes: ['gt-prompt-app'],
        window: { title: 'Group Token Selection' },
        position: { width: 360 }
    };

    /**
     * @param {Function} resolveFn - Promise resolve callback
     * @param {Array<{id: string, name: string}>} tokens - Candidate tokens
     * @param {string|null} preferredId - Token ID to pre-select
     */
    constructor(resolveFn, tokens, preferredId) {
        super({});
        this.resolveFn = resolveFn;
        this.tokens = tokens;
        this.preferredId = preferredId;
        this.hasResolved = false;
    }

    /**
     * Builds the inner HTML for the prompt window.
     * AppV2 lifecycle: called during render to produce the DOM content.
     * @param {object} context
     * @param {object} options
     * @returns {Promise<string>}
     */
    async _renderHTML(context, options) {
        const optionsHtml = this.tokens.length
            ? this.tokens.map(t => {
                const selected = t.id === this.preferredId ? ' selected' : '';
                return `<option value="${t.id}"${selected}>${t.name}</option>`;
              }).join('')
            : `<option value="" disabled>${Config.localize('partyPrompt.noTokens')}</option>`;

        return `<div id="gt-prompt-root">
          <div class="gt-prompt-label">
            ${Config.localize('partyPrompt.label')}
            <em>${Config.localize('partyPrompt.hint')}</em>
          </div>
          <select id="gt-prompt-select">${optionsHtml}</select>
          <div class="gt-prompt-actions">
            <button type="button" class="btn-cancel" data-action="cancel">${Config.localize('partyPrompt.cancel')}</button>
            <button type="button" class="btn-confirm" data-action="confirm">${Config.localize('partyPrompt.confirm')}</button>
          </div>
        </div>`;
    }

    /**
     * Inserts rendered HTML into the content element and wires up button listeners.
     * AppV2 lifecycle: called after _renderHTML to place content into the DOM.
     * @param {string} result - HTML string from _renderHTML
     * @param {HTMLElement} content - The .window-content element
     * @param {object} options
     */
    _replaceHTML(result, content, options) {
        content.innerHTML = result;
        content.querySelector('[data-action="confirm"]')?.addEventListener('click', () => {
            const val = content.querySelector('#gt-prompt-select')?.value;
            this._finish(val ? { tokenId: val } : { cancelled: true });
        });
        content.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            this._finish({ cancelled: true });
        });
    }

    /**
     * Resolves the promise exactly once and closes the window.
     * @param {{tokenId: string}|{cancelled: true}} result
     */
    _finish(result) {
        if (!this.hasResolved) {
            this.hasResolved = true;
            this.resolveFn(result);
        }
        this.close();
    }

    /**
     * Ensures the promise resolves with cancellation if the user closes the window
     * via the title-bar X or Escape key instead of the Cancel button.
     * @param {object} options
     * @returns {Promise<void>}
     */
    async close(options) {
        if (!this.hasResolved) {
            this.hasResolved = true;
            this.resolveFn({ cancelled: true });
        }
        return super.close(options);
    }
}

/**
 * Shows a dialog letting the GM pick which token becomes the party/leader token.
 * Displays a dropdown restricted to the passed member token IDs.
 * Triggered by PartyCruncher.groupParty() during group creation/update.
 * @param {string[]} memberTokenIds - IDs of the tokens selected as members
 * @param {string|null} preferredTokenId - Token ID to pre-select in the dropdown (the HUD origin token)
 * @returns {Promise<{tokenId: string}|{cancelled: true}>}
 */
export async function promptForPartyToken(memberTokenIds, preferredTokenId = null) {
    const memberIdSet = new Set(memberTokenIds);

    // Resolve only the IDs passed as members — the leader choice only makes sense within the current selection.
    // filter(Boolean) discards any IDs whose token was removed from the canvas between selection and prompt open.
    const allSceneTokens = [...memberIdSet]
        .map(id => {
            const t = canvas.tokens.get(id);
            return t ? { id: t.id, name: t.name } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));

    return new Promise(resolve => {
        new PartyPromptApp(resolve, allSceneTokens, preferredTokenId).render(true);
    });
}

/**
 * Stamps module flags on every token in the group.
 * Three flags are written so the preCreateToken hook can reliably detect group
 * tokens during copy/paste across or within scenes:
 *   - groupId: the group this token belongs to
 *   - tokenId: the token's own document ID (preserved by Foundry when copying)
 *   - role:    'party' for the leader/party token, 'member' for all others
 * Called after PartyCruncher.groupParty() persists the group.
 * @param {object} group - The group object from Config
 * @returns {Promise<void>}
 */
export async function stampGroupFlags(group) {
    const allIds = [...group.memberTokenIds];
    if (group.partyTokenId && !allIds.includes(group.partyTokenId)) {
        allIds.push(group.partyTokenId);
    }
    for (const tokenId of allIds) {
        const tokenDoc = canvas.scene.tokens.get(tokenId);
        if (tokenDoc) {
            await tokenDoc.update({
                [`flags.${MOD_ID}.groupId`]: group.id,
                [`flags.${MOD_ID}.tokenId`]: tokenId,
                [`flags.${MOD_ID}.role`]:    tokenId === group.partyTokenId ? 'party' : 'member'
            });
        }
    }
}
