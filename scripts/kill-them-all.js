import { Config } from './config.js';
import { Logger } from './logger.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * "Kill them All!" — slider dialog that lets the GM choose how many group
 * members to send toward targeted enemy tokens.
 *
 * Usage:
 *   const { confirmed, count } = await KillThemAll.open(visibleMemberCount, targetCount);
 */
export class KillThemAll extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "gt-kill-them-all-window",
        classes: ["gt-kill-them-all-app"],
        window: {
            title: "Kill them All!",
            resizable: false
        },
        position: { width: 380 },
        actions: {
            "send-dialog":   KillThemAll.#onSend,
            "cancel-dialog": KillThemAll.#onCancel,
            "buffer-range":  KillThemAll.#onBufferRange
        }
    };

    static PARTS = {
        main: { template: "modules/group-tokens/templates/kill-them-all-dialog.hbs" }
    };

    static init() {
        window.KillThemAll = KillThemAll;
        Logger.info("KillThemAll initialized.");
    }

    /**
     * Opens the dialog and resolves with the GM's choice.
     * @param {number} visibleMemberCount - Total visible, non-leader members available
     * @param {number} targetCount        - Number of GM-targeted tokens
     * @returns {Promise<{ confirmed: boolean, count: number }>}
     */
    static open(visibleMemberCount, targetCount) {
        return new Promise(resolve => {
            const dialog = new KillThemAll(visibleMemberCount, targetCount, resolve);
            dialog.render(true);
        });
    }

    /**
     * @param {number}   visibleMemberCount
     * @param {number}   targetCount
     * @param {Function} resolve - Promise resolver
     */
    constructor(visibleMemberCount, targetCount, resolve) {
        super();
        this._visibleMemberCount = visibleMemberCount;
        this._targetCount = targetCount;
        this._resolve = resolve;
        this._resolved = false;
    }

    async _prepareContext(_options) {
        return {
            visibleMemberCount: this._visibleMemberCount,
            targetCount:        this._targetCount,
            defaultCount:       this._visibleMemberCount
        };
    }

    /** Resolve the promise when the window is closed without clicking Send. */
    async close(options) {
        if (!this._resolved) {
            this._resolved = true;
            this._resolve({ confirmed: false, count: 0 });
        }
        return super.close(options);
    }

    // ── Actions ──────────────────────────────────────────────────────

    static #onSend(event, target) {
        const inst = /** @type {KillThemAll} */ (this);
        const root = target.closest('#gt-kill-them-all-root');
        const slider = root?.querySelector('input[type="range"]');
        const count = slider ? Number(slider.value) : inst._visibleMemberCount;
        if (!inst._resolved) {
            inst._resolved = true;
            inst._resolve({ confirmed: true, count });
        }
        inst.close();
    }

    static #onCancel() {
        const inst = /** @type {KillThemAll} */ (this);
        if (!inst._resolved) {
            inst._resolved = true;
            inst._resolve({ confirmed: false, count: 0 });
        }
        inst.close();
    }

    /** Live-update the displayed count as the slider moves. */
    static #onBufferRange(event, target) {
        const value = Number(target.value);
        const root = target.closest('#gt-kill-them-all-root');
        const display = root?.querySelector('.gt-kta-range-value');
        const countDisplay = root?.querySelector('#gt-kta-count-display');
        if (display) display.textContent = value;
        if (countDisplay) countDisplay.textContent = value;
    }
}
