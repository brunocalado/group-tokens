import { Config } from './config.js';
import { Logger } from './logger.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Actor Type Filter — ApplicationV2 dialog for configuring which actor types
 * show the Group Tokens button in the Token HUD.
 *
 * All types are enabled by default. Unchecking a type prevents the HUD button
 * from appearing for tokens of that actor type.
 */
export class ActorTypeFilter extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @type {ActorTypeFilter|null} */
    static #instance;

    static DEFAULT_OPTIONS = {
        id: "gt-actor-type-filter-window",
        classes: ["gt-actor-type-filter-app"],
        window: {
            title: "Group Tokens — Token HUD Filter",
            resizable: false
        },
        position: { width: 400 },
        actions: {
            "save-dialog":   ActorTypeFilter.#onSave,
            "cancel-dialog": ActorTypeFilter.#onCancel
        }
    };

    static PARTS = {
        main: { template: "modules/group-tokens/templates/actor-type-filter-dialog.hbs" }
    };

    static init() {
        window.ActorTypeFilter = ActorTypeFilter;
        Logger.info("ActorTypeFilter initialized.");
    }

    /**
     * Opens the dialog as a singleton. GM only.
     */
    static async open() {
        if (!game.user.isGM) {
            ui.notifications.warn(`[${Config.data.modTitle}] GM only.`);
            return;
        }
        if (!ActorTypeFilter.#instance) ActorTypeFilter.#instance = new ActorTypeFilter();
        ActorTypeFilter.#instance.render(true);
    }

    // ── Data ─────────────────────────────────────────────────────────

    async _prepareContext(_options) {
        const disabledTypes = Config.setting('hudActorTypeFilter') ?? [];
        const allTypes = (game.documentTypes?.Actor ?? []).filter(t => t !== 'base');

        const actorTypes = allTypes.map(type => {
            const labelKey = CONFIG.Actor?.typeLabels?.[type] ?? type;
            const label = game.i18n.localize(labelKey);
            return {
                type,
                label: label !== labelKey ? label : type,
                enabled: !disabledTypes.includes(type)
            };
        });

        return { actorTypes };
    }

    // ── Actions ──────────────────────────────────────────────────────

    /** Reads checkbox states, persists disabled types, closes. */
    static async #onSave(event, target) {
        const inst = ActorTypeFilter.#instance;
        if (!inst) return;

        const root = target.closest('#gt-actor-type-filter-root');
        const checkboxes = root?.querySelectorAll('input[type="checkbox"][data-type]') ?? [];
        const disabledTypes = [];

        for (const cb of checkboxes) {
            if (!cb.checked) disabledTypes.push(cb.dataset.type);
        }

        await Config.modifySetting('hudActorTypeFilter', disabledTypes);
        inst.close();
    }

    /** Closes without saving. */
    static #onCancel() {
        ActorTypeFilter.#instance?.close();
    }
}
