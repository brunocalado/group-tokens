import { Logger } from './logger.js';

const MOD_ID = "group-tokens";
const MOD_PATH = `/modules/${MOD_ID}`;
const MOD_TITLE = "Group Tokens";
const MOD_DESCRIPTION = "Easily collapse arbitrary groups of scene tokens into a single group token, and vice versa. Manage unlimited groups with up to 25 members each.";

// ─────────────────────────────────────────────────────────────────────────────
// GroupDataModel — schema validation for each group entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the shape of a single group stored in the 'groups' world setting.
 * Each group maps a party token to its member tokens via Foundry document IDs.
 */
class GroupDataModel extends foundry.abstract.DataModel {
    /** @returns {object} */
    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            id:             new fields.StringField({ required: true, blank: false }),
            sceneId:        new fields.StringField({ required: true, blank: false }),
            partyTokenId:   new fields.StringField({ initial: '' }),
            memberTokenIds: new fields.ArrayField(new fields.StringField()),
            formation:      new fields.ObjectField({ required: false })
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GroupConfigMenu — shell that immediately opens the Dashboard
// ─────────────────────────────────────────────────────────────────────────────
class GroupConfigMenu extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "gt-group-config-shell",
        window: { title: "Group Tokens" }
    };
    async _renderHTML()  { return null; }
    async _replaceHTML() {}

    /**
     * Immediately closes the shell and opens the Dashboard.
     * Triggered by the Foundry settings menu button.
     */
    async _onRender(_ctx, _opts) {
        this.close({ animate: false });
        window.GroupTokensDashboard?.open();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// InstructionsMenu — settings-menu shell that opens InstructionsApp
// ─────────────────────────────────────────────────────────────────────────────
class InstructionsMenu extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "gt-instructions-shell",
        window: { title: "Group Tokens" }
    };
    async _renderHTML()  { return null; }
    async _replaceHTML() {}
    async _onRender(_ctx, _opts) {
        this.close({ animate: false });
        InstructionsApp.open();
    }

    static async openDialog() {
        InstructionsApp.open();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// InstructionsApp — AppV2-based instructions window (same pattern as Dashboard)
// ─────────────────────────────────────────────────────────────────────────────
class InstructionsApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "gt-instr-window",
        classes: ["gt-instructions-app"],
        window: { title: "Group Tokens — Instructions", resizable: true },
        position: { width: 480, height: 520 },
        actions: {
            "close-dialog": function() { this.close(); }
        }
    };

    static PARTS = {
        main: { template: "modules/group-tokens/templates/instructions-dialog.hbs" }
    };

    static open() {
        new InstructionsApp().render(true);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// ActionsSettingsMenu — shell that opens the tabbed Actions Settings dialog
// ─────────────────────────────────────────────────────────────────────────────
class ActionsSettingsMenu extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "gt-actions-settings-shell",
        window: { title: "Group Tokens" }
    };
    async _renderHTML()  { return null; }
    async _replaceHTML() {}
    async _onRender(_ctx, _opts) {
        this.close({ animate: false });
        window.ActionsSettings?.open();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HudActorTypeFilterMenu — shell that opens the Actor Type Filter dialog
// ─────────────────────────────────────────────────────────────────────────────
class HudActorTypeFilterMenu extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "gt-hud-actor-type-filter-shell",
        window: { title: "Group Tokens" }
    };
    async _renderHTML()  { return null; }
    async _replaceHTML() {}
    async _onRender(_ctx, _opts) {
        this.close({ animate: false });
        window.ActorTypeFilter?.open();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
export class Config {
    static data = {
        modID: MOD_ID,
        modPath: MOD_PATH,
        modTitle: MOD_TITLE,
        modDescription: MOD_DESCRIPTION
    };
    static NO_AUDIO_FILE = `modules/${MOD_ID}/assets/audio/audio_null.wav`;

    /** @type {boolean} Set to true by bootstrap after all prerequisites are ready */
    static ready = false;

    /**
     * Registers all module settings, menus, and keybindings.
     * Called during the Foundry 'setup' hook via initSubmodules().
     */
    static init() {

        // ── Menu: Instructions (top — always visible to all users) ──────
        game.settings.registerMenu(MOD_ID, 'instructions', {
            name: 'Instructions',
            label: 'How to use',
            hint: 'Step-by-step guide on how to use Group Tokens.',
            icon: 'fas fa-book',
            type: InstructionsMenu,
            restricted: false
        });

        // ── Menu: Group Configuration ──────────────────────────────────────
        game.settings.registerMenu(MOD_ID, 'groupConfig', {
            name: 'Group Configuration',
            label: 'Configure Groups',
            hint: 'View configured groups and manage them via the Dashboard.',
            icon: 'fas fa-object-group',
            type: GroupConfigMenu,
            restricted: true
        });

        // ── Menu: Actions Settings ──────────────────────────────────────────
        game.settings.registerMenu(MOD_ID, 'actionsSettings', {
            name: 'Actions & Sounds',
            label: 'Actions & Sounds',
            hint: 'Configure movement and audio settings for all group actions.',
            icon: 'fas fa-sliders-h',
            type: ActionsSettingsMenu,
            restricted: true
        });

        // ── Menu: Token HUD Actor Type Filter ──────────────────────────────
        game.settings.registerMenu(MOD_ID, 'hudActorTypeFilter', {
            name: 'Token HUD Filter',
            label: 'Filter by Actor Type',
            hint: 'Choose which actor types show the Group Tokens button in the Token HUD.',
            icon: 'fas fa-filter',
            type: HudActorTypeFilterMenu,
            restricted: true
        });

        // ── Actor types for which the Token HUD button is suppressed ──────
        game.settings.register(MOD_ID, 'hudActorTypeFilter', {
            name: Config.localize('setting.hudActorTypeFilter.name'),
            hint: Config.localize('setting.hudActorTypeFilter.hint'),
            scope: 'world',
            config: false,
            type: Array,
            default: []
        });

        // ── Single array setting for all group data ────────────────────────
        game.settings.register(MOD_ID, 'groups', {
            name: Config.localize('setting.groups.name'),
            hint: Config.localize('setting.groups.hint'),
            scope: 'world',
            config: false,
            type: Array,
            default: []
        });

        // All action/sound settings are managed via the tabbed
        // Actions Settings dialog — hidden from the default settings panel.
        Config.registerSettings({
            gatherSpeed: {
                scope: 'world', config: false, type: String,
                default: 'normal',
                choices: {
                    fast:   Config.localize('setting.gatherSpeed.choices.fast'),
                    normal: Config.localize('setting.gatherSpeed.choices.normal'),
                    slow:   Config.localize('setting.gatherSpeed.choices.slow')
                }
            },
            getInPositionRadius: {
                scope: 'world', config: false, type: Number,
                default: 6,
                range: { min: 3, max: 100, step: 1 }
            },
            audioFile4GetOverHere: {
                scope: 'world', config: false, type: String,
                default: `modules/${MOD_ID}/assets/audio/get-over-here.mp3`
            },
            audioFile4GetInPosition: {
                scope: 'world', config: false, type: String,
                default: `modules/${MOD_ID}/assets/audio/get-over-here.mp3`
            },
            audioFile4LoadFormation: {
                scope: 'world', config: false, type: String,
                default: `modules/${MOD_ID}/assets/audio/get-over-here.mp3`
            },
            audioFile4Crunch: {
                scope: 'world', config: false, type: String, filePicker: 'audio',
                default: `modules/${MOD_ID}/assets/audio/audio_crunch.wav`
            },
            audioFile4Explode: {
                scope: 'world', config: false, type: String, filePicker: 'audio',
                default: `modules/${MOD_ID}/assets/audio/audio_explode.wav`
            },
            audioFile4KillThemAll: {
                scope: 'world', config: false, type: String,
                default: `modules/${MOD_ID}/assets/audio/get-over-here.mp3`
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Group CRUD helpers
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Returns all stored groups, removing any whose scene no longer exists.
     * @returns {object[]}
     */
    static getGroups() {
        const raw = game.settings.get(MOD_ID, 'groups') ?? [];
        const cleaned = raw.filter(g => game.scenes.get(g.sceneId));
        if (cleaned.length !== raw.length) {
            game.settings.set(MOD_ID, 'groups', cleaned);
            Logger.debug(`(Config.getGroups) Cleaned ${raw.length - cleaned.length} orphaned group(s).`);
        }
        return cleaned;
    }

    /**
     * Overwrites the entire groups array in settings.
     * @param {object[]} groups
     * @returns {Promise<void>}
     */
    static async saveGroups(groups) {
        await game.settings.set(MOD_ID, 'groups', groups);
        Logger.debug('(Config.saveGroups) Saved', groups.length, 'group(s).');
    }

    /**
     * Finds a single group by its stable unique ID.
     * @param {string} id
     * @returns {object|null}
     */
    static getGroup(id) {
        return Config.getGroups().find(g => g.id === id) ?? null;
    }

    /**
     * Creates a new group entry and persists it.
     * Generates a stable unique ID via foundry.utils.randomID().
     * @param {object} data - { sceneId, partyTokenId, memberTokenIds }
     * @returns {Promise<object>} The newly created group object
     */
    static async createGroup(data) {
        const group = {
            id: foundry.utils.randomID(),
            sceneId: data.sceneId,
            partyTokenId: data.partyTokenId ?? '',
            memberTokenIds: data.memberTokenIds ?? [],
            formation: data.formation ?? null
        };
        // Validate shape via GroupDataModel before persisting
        new GroupDataModel(group);
        const groups = Config.getGroups();
        groups.push(group);
        await Config.saveGroups(groups);
        Logger.debug('(Config.createGroup) Created group:', group.id);
        return group;
    }

    /**
     * Merges a delta object into an existing group identified by ID.
     * @param {string} id - Group ID
     * @param {object} delta - Fields to merge (e.g. { partyTokenId, memberTokenIds })
     * @returns {Promise<void>}
     */
    static async updateGroup(id, delta) {
        const groups = Config.getGroups();
        const idx = groups.findIndex(g => g.id === id);
        if (idx === -1) {
            Logger.warn(false, `(Config.updateGroup) Group not found: ${id}`);
            return;
        }
        Object.assign(groups[idx], delta);
        // Validate merged shape via GroupDataModel before persisting
        new GroupDataModel(groups[idx]);
        await Config.saveGroups(groups);
    }

    /**
     * Removes a group by ID.
     * @param {string} id
     * @returns {Promise<void>}
     */
    static async deleteGroup(id) {
        const groups = Config.getGroups().filter(g => g.id !== id);
        await Config.saveGroups(groups);
        Logger.debug('(Config.deleteGroup) Deleted group:', id);
    }

    /**
     * Resolves a token document ID to its display name within a given scene.
     * Falls back to '[unknown]' if the token cannot be found.
     * @param {string} sceneId
     * @param {string} tokenId
     * @returns {string}
     */
    static resolveTokenName(sceneId, tokenId) {
        if (!tokenId) return '[none]';
        // Prefer live canvas token when viewing the same scene
        if (canvas?.scene?.id === sceneId) {
            const liveToken = canvas.tokens.get(tokenId);
            if (liveToken) return liveToken.name;
        }
        // Fallback: read from the scene document directly
        const scene = game.scenes.get(sceneId);
        const tokenDoc = scene?.tokens?.get(tokenId);
        return tokenDoc?.name ?? '[unknown]';
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Generic settings helpers (for non-group settings)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Batch-registers multiple settings with automatic localization.
     * @param {object} settingsData
     */
    static registerSettings(settingsData) {
        Object.entries(settingsData).forEach(([key, data]) => {
            const name = Config.localize(`setting.${key}.name`);
            const hint = Config.localize(`setting.${key}.hint`);
            game.settings.register(Config.data.modID, key, { name, hint, ...data });
            Logger.debug('(Config.registerSettings) registered:', name);
        });
    }

    /**
     * Reads a single module setting by key.
     * @param {string} key
     * @param {boolean} [verbose=false]
     * @returns {*}
     */
    static setting(key, verbose = false) {
        if (verbose) Logger.debug(`(Config.setting) get: ${key}`);
        return game.settings.get(Config.data.modID, key);
    }

    /**
     * Writes a single module setting by key.
     * @param {string} key
     * @param {*} newValue
     * @returns {Promise<void>}
     */
    static async modifySetting(key, newValue) {
        await game.settings.set(Config.data.modID, key, newValue);
        Logger.debug('(Config.modifySetting) changed:', key, '=>', newValue);
    }

    /**
     * Localizes a key under the module's i18n namespace.
     * @param {string} key
     * @returns {string}
     */
    static localize(key) {
        return game.i18n.localize(`${Config.data.modID}.${key}`);
    }

    /**
     * Formats a localized string with variable substitution.
     * @param {string} key
     * @param {object} data
     * @returns {string}
     */
    static format(key, data) {
        return game.i18n.format(`${Config.data.modID}.${key}`, data);
    }

    /**
     * Promise-based delay utility.
     * @param {number} msec
     * @returns {Promise<void>}
     */
    static async sleep(msec) {
        Logger.debug(`(Config.sleep) Waiting ${msec}ms...`);
        return new Promise(resolve => setTimeout(resolve, msec));
    }

}
