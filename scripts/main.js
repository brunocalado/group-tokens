import { Logger } from './logger.js';
import { Config } from './config.js';
import { ContextMenu } from "./context-menu.js";
import { Dashboard } from "./dashboard.js";
import { VisualMarkers } from "./visual-markers.js";
import { SceneTransfer } from "./scene-transfer.js";
import { ActionsSettings } from "./actions-settings.js";
import { ActorTypeFilter } from "./actor-type-filter.js";
import { KillThemAll } from "./kill-them-all.js";
import { PartyCruncher } from "./party-cruncher.js";

const SUBMODULES = {
    MODULE: Config,
    logger: Logger
};

/**
 * Global initializer block:
 * First of all, we need to initialize a lot of stuff in correct order:
 */
(async () => {
        console.log("Group Tokens | Initializing Module ...");

        await areDependenciesReady();

        Config.ready = true;
        Logger.infoGreen(`Ready to play! Version: ${game.modules.get(Config.data.modID).version}`);
        Logger.infoGreen(Config.data.modDescription);
    }
)
();

async function areDependenciesReady() {
    return new Promise(resolve => {
        Hooks.once('setup', () => {
            resolve(initSubmodules());
            resolve(initExposedClasses());
        });
    });
}

async function initSubmodules() {
    Object.values(SUBMODULES).forEach(function (cl) {
        cl.init(); // includes loading each module's settings
        Logger.debug("(initSubmodules) Submodule loaded:", cl.name);
    });
}

async function initExposedClasses() {
    // Pre-load Handlebars templates for snappy first-open performance
    await foundry.applications.handlebars.loadTemplates([
        'modules/group-tokens/templates/instructions-dialog.hbs',
        'modules/group-tokens/templates/dashboard.hbs',
        'modules/group-tokens/templates/context-menu-dialog.hbs',
        'modules/group-tokens/templates/scene-transfer-dialog.hbs',
        'modules/group-tokens/templates/scene-picker-dialog.hbs',
        'modules/group-tokens/templates/actions-settings-dialog.hbs',
        'modules/group-tokens/templates/actor-type-filter-dialog.hbs',
        'modules/group-tokens/templates/kill-them-all-dialog.hbs'
    ]);

    window.PartyCruncher = PartyCruncher;
    ContextMenu.init();
    Dashboard.init();
    ActionsSettings.init();
    ActorTypeFilter.init();
    KillThemAll.init();
    VisualMarkers.init();
    SceneTransfer.init();
    Logger.debug("(initExposedClasses) Exposed classes are ready");
}
