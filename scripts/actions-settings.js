import { Config } from './config.js';
import { Logger } from './logger.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Actions Settings — Tabbed AppV2 dialog for configuring Get Over Here,
 * Get in Position, and Group/Ungroup sound settings.
 *
 * Changes are buffered in memory and only persisted on Save.
 * Cancel discards all pending changes and closes the dialog.
 */
export class ActionsSettings extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @type {ActionsSettings|null} */
    static #instance;

    /** @type {Map<string, *>} Buffered setting changes (key → new value) */
    #pending = new Map();

    static DEFAULT_OPTIONS = {
        id: "gt-actions-settings-window",
        classes: ["gt-actions-settings-app"],
        window: {
            title: "Group Tokens — Actions Settings",
            resizable: true
        },
        position: { width: 860, height: 460 },
        actions: {
            "switch-tab":     ActionsSettings.#onSwitchTab,
            "buffer-setting": ActionsSettings.#onBufferSetting,
            "buffer-range":   ActionsSettings.#onBufferRange,
            "pick-file":      ActionsSettings.#onPickFile,
            "save-dialog":    ActionsSettings.#onSave,
            "cancel-dialog":  ActionsSettings.#onCancel
        }
    };

    static PARTS = {
        main: { template: "modules/group-tokens/templates/actions-settings-dialog.hbs" }
    };

    static init() {
        window.ActionsSettings = ActionsSettings;
        Logger.info("ActionsSettings initialized.");
    }

    /**
     * Opens the dialog as a singleton. GM only.
     */
    static async open() {
        if (!game.user.isGM) {
            ui.notifications.warn(`[${Config.data.modTitle}] GM only.`);
            return;
        }
        if (!ActionsSettings.#instance) ActionsSettings.#instance = new ActionsSettings();
        ActionsSettings.#instance.#pending.clear();
        ActionsSettings.#instance.render(true);
    }

    // ── Data ─────────────────────────────────────────────────────────

    async _prepareContext(_options) {
        return {
            gatherSpeed:              Config.setting('gatherSpeed'),
            getInPositionRadius:      Config.setting('getInPositionRadius'),
            audioFile4GetOverHere:    Config.setting('audioFile4GetOverHere'),
            audioFile4GetInPosition:  Config.setting('audioFile4GetInPosition'),
            audioFile4LoadFormation:  Config.setting('audioFile4LoadFormation'),
            audioFile4KillThemAll:    Config.setting('audioFile4KillThemAll'),
            audioFile4Crunch:         Config.setting('audioFile4Crunch'),
            audioFile4Explode:        Config.setting('audioFile4Explode')
        };
    }

    // ── Actions ──────────────────────────────────────────────────────

    static #onSwitchTab(event, target) {
        const tabId = target.dataset.tab;
        const root = target.closest('#gt-actions-settings-root');

        root.querySelectorAll('.gt-as-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
        root.querySelectorAll('.gt-as-panel').forEach(p => p.classList.toggle('active', p.dataset.tab === tabId));
    }

    /** Buffer a text/select change without persisting */
    static #onBufferSetting(event, target) {
        ActionsSettings.#instance?.#pending.set(target.name, target.value);
    }

    /** Buffer a range change and live-update the displayed value */
    static #onBufferRange(event, target) {
        const value = Number(target.value);
        const display = target.closest('.gt-as-range-row')?.querySelector('.gt-as-range-value');
        if (display) display.textContent = value;
        ActionsSettings.#instance?.#pending.set(target.name, value);
    }

    /** Open FilePicker; buffer the chosen path (don't persist yet) */
    static #onPickFile(event, target) {
        const settingKey = target.dataset.target;
        const current = ActionsSettings.#instance?.#pending.get(settingKey)
                     ?? Config.setting(settingKey);
        const FP = foundry.applications.apps.FilePicker.implementation;
        const fp = new FP({
            type: 'audio',
            current,
            callback: (path) => {
                ActionsSettings.#instance?.#pending.set(settingKey, path);
                const root = target.closest('#gt-actions-settings-root');
                const input = root?.querySelector(`input[name="${settingKey}"]`);
                if (input) input.value = path;
            }
        });
        fp.render(true);
    }

    /** Persist all buffered changes and close */
    static async #onSave(event, target) {
        const inst = ActionsSettings.#instance;
        if (!inst) return;

        for (const [key, value] of inst.#pending) {
            await Config.modifySetting(key, value);
        }
        inst.#pending.clear();

        const el = target.closest('#gt-actions-settings-root')?.querySelector('#gt-as-save-status');
        if (el) el.textContent = "Saved!";

        setTimeout(() => inst.close(), 400);
    }

    /** Discard all buffered changes and close */
    static #onCancel() {
        const inst = ActionsSettings.#instance;
        if (!inst) return;
        inst.#pending.clear();
        inst.close();
    }
}
