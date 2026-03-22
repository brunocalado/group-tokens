import { Config } from './config.js';
import { Logger } from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Token movement engine — crunch, explode, teleport, spread, spiral vectors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crunch: collapse all member tokens into the group/leader token position.
 * @param {{ partyToken: Token, memberTokens: Token[] }} involvedTokens
 * @param {Token} targetToken - The crunch anchor
 * @returns {Promise<void>}
 */
export async function crunchParty(involvedTokens, targetToken) {
    const isLeader = involvedTokens.memberTokens.some(t => t.id === involvedTokens.partyToken.id);

    canvas.tokens.releaseAll();

    playActionAudio('audioFile4Crunch');

    // Moves a single token to the target position, then immediately hides it at 0,0 upon arrival.
    const mergeToken = async (token) => {
        await teleport([getTokenTeleportUpdate(token, targetToken.position, targetToken.document.elevation, false)]);
        await teleport([getTokenTeleportUpdate(token, {x: 0, y: 0}, null, true)]);
    };

    if (isLeader) {
        // Leader Mode: fly all non-leader members to the leader concurrently
        const nonLeaderMembers = involvedTokens.memberTokens.filter(
            t => t.id !== involvedTokens.partyToken.id
        );

        await Promise.all(nonLeaderMembers.map(token => mergeToken(token)));

        involvedTokens.partyToken.control({releaseOthers: true});

    } else {
        // Classic Mode: concurrently move the hidden Party Token to target AND fly members to target
        const partyTokenPromise = teleport([getTokenTeleportUpdate(involvedTokens.partyToken, targetToken.position, targetToken.document.elevation, true)]);
        const mergePromises = involvedTokens.memberTokens.map(token => mergeToken(token));

        await Promise.all([partyTokenPromise, ...mergePromises]);

        // Once all members have arrived and been hidden, reveal the Party Token
        await teleport([getTokenTeleportUpdate(involvedTokens.partyToken, targetToken.position, null, false)]);

        involvedTokens.partyToken.control({releaseOthers: true});
    }
}

/**
 * Explode: spread member tokens outward from the group/leader token position.
 * @param {{ partyToken: Token, memberTokens: Token[] }} involvedTokens
 * @param {Token} targetToken - The explode anchor
 * @returns {Promise<void>}
 */
export async function explodeParty(involvedTokens, targetToken) {
    if (!canvas.ready) return;

    const isLeader = involvedTokens.memberTokens.some(t => t.id === involvedTokens.partyToken.id);

    canvas.tokens.releaseAll();

    playActionAudio('audioFile4Explode');

    if (isLeader) {
        // Leader Mode: spread non-leader members around the leader
        const nonLeaderMembers = involvedTokens.memberTokens.filter(
            t => t.id !== involvedTokens.partyToken.id
        );

        // Unhide all members at the leader's position first
        let tokenUpdates = [];
        for (const memberToken of nonLeaderMembers) {
            tokenUpdates.push(getTokenTeleportUpdate(memberToken, targetToken.position, targetToken.document.elevation, false));
        }
        await teleport(tokenUpdates);

        // Compute leader size — starting ring places members outside the leader's footprint
        const gs = canvas.grid.size;
        const { w: lw, h: lh } = getTokenSizeInCells(targetToken);
        const leaderStartRing = Math.ceil(Math.max(lw, lh) / 2);

        // Leader center cell (in grid-cell coordinates).
        // Math.floor avoids floating-point drift when a token sits exactly on a cell boundary.
        const leaderCellX = Math.floor(targetToken.document.x / gs);
        const leaderCellY = Math.floor(targetToken.document.y / gs);
        const leaderCenterCellX = leaderCellX + Math.floor(lw / 2);
        const leaderCenterCellY = leaderCellY + Math.floor(lh / 2);

        // IDs of members not yet placed — treated as non-blocking by isCellOccupied
        const reservedIds = new Set(nonLeaderMembers.map(t => t.id));
        const spiralPositions = generateSpiralPositions(nonLeaderMembers.length, leaderStartRing);

        for (let i = 0; i < nonLeaderMembers.length; i++) {
            const memberToken = nonLeaderMembers[i];
            reservedIds.delete(memberToken.id);
            const targetCell = {
                x: leaderCenterCellX + spiralPositions[i].x,
                y: leaderCenterCellY + spiralPositions[i].y
            };
            memberToken.control({ releaseOthers: true });
            await spreadToken(memberToken, targetCell, new Set(reservedIds));
        }

        for (const memberToken of involvedTokens.memberTokens) {
            memberToken.control({ releaseOthers: false });
        }

    } else {
        // Classic Mode: unhide members at party token position, hide party token, spread members
        const gs = canvas.grid.size;

        // Capture anchor position before teleporting the party token away
        const { w: lw, h: lh } = getTokenSizeInCells(involvedTokens.partyToken);
        // Math.floor avoids floating-point drift; same rationale as Leader Mode cell calc.
        const anchorCellX = Math.floor(involvedTokens.partyToken.document.x / gs) + Math.floor(lw / 2);
        const anchorCellY = Math.floor(involvedTokens.partyToken.document.y / gs) + Math.floor(lh / 2);

        let tokenUpdates = [];
        for (const memberToken of involvedTokens.memberTokens) {
            tokenUpdates.push(getTokenTeleportUpdate(memberToken, involvedTokens.partyToken.position, involvedTokens.partyToken.document.elevation, false));
        }
        tokenUpdates.push(getTokenTeleportUpdate(involvedTokens.partyToken, { x: 0, y: 0 }, null, true));
        await teleport(tokenUpdates);

        // Start from ring 1 — classic mode has no large leader on canvas anymore
        const spiralPositions = generateSpiralPositions(involvedTokens.memberTokens.length, 1);
        const reservedIds = new Set(involvedTokens.memberTokens.map(t => t.id));

        for (let i = 0; i < involvedTokens.memberTokens.length; i++) {
            const memberToken = involvedTokens.memberTokens[i];
            reservedIds.delete(memberToken.id);
            const targetCell = {
                x: anchorCellX + spiralPositions[i].x,
                y: anchorCellY + spiralPositions[i].y
            };
            memberToken.control({ releaseOthers: true });
            await spreadToken(memberToken, targetCell, new Set(reservedIds));
        }

        for (const memberToken of involvedTokens.memberTokens) {
            memberToken.control({ releaseOthers: false });
        }
    }
}

/**
 * Gather: animate member tokens walking toward the leader and positioning around them.
 * Unlike crunch, members remain visible — this regroups the formation without hiding anyone.
 * Only works when the group is exploded (members visible and spread out).
 * @param {{ partyToken: Token, memberTokens: Token[] }} involvedTokens
 * @param {Token} targetToken - The leader/anchor token
 * @returns {Promise<void>}
 */
export async function gatherParty(involvedTokens, targetToken) {
    if (!canvas.ready) return;

    const isLeader = involvedTokens.memberTokens.some(t => t.id === involvedTokens.partyToken.id);

    canvas.tokens.releaseAll();

    // Play audio for all clients
    playActionAudio('audioFile4GetOverHere');

    const gs = canvas.grid.size;
    const { w: lw, h: lh } = getTokenSizeInCells(targetToken);
    const leaderStartRing = Math.ceil(Math.max(lw, lh) / 2);

    const leaderCellX = Math.floor(targetToken.document.x / gs);
    const leaderCellY = Math.floor(targetToken.document.y / gs);
    const leaderCenterCellX = leaderCellX + Math.floor(lw / 2);
    const leaderCenterCellY = leaderCellY + Math.floor(lh / 2);

    // Determine which members to gather
    const membersToGather = isLeader
        ? involvedTokens.memberTokens.filter(t => t.id !== involvedTokens.partyToken.id && !t.document.hidden)
        : involvedTokens.memberTokens.filter(t => !t.document.hidden);

    if (membersToGather.length === 0) return;

    // Read speed setting: fast | normal | slow
    const speed = Config.setting('gatherSpeed') || 'fast';

    // IDs of members not yet placed — treated as non-blocking by isCellOccupied
    const reservedIds = new Set(membersToGather.map(t => t.id));
    const spiralPositions = generateSpiralPositions(membersToGather.length, leaderStartRing);

    // Compute target positions for all members first, then move them all simultaneously
    const movePromises = [];

    for (let i = 0; i < membersToGather.length; i++) {
        const memberToken = membersToGather[i];
        reservedIds.delete(memberToken.id);

        const targetCell = {
            x: leaderCenterCellX + spiralPositions[i].x,
            y: leaderCenterCellY + spiralPositions[i].y
        };

        movePromises.push(gatherToken(memberToken, targetCell, new Set(reservedIds), 48, speed));
    }

    // Move all members simultaneously for a natural gathering effect
    await Promise.all(movePromises);

    // Select all members after gathering
    for (const memberToken of involvedTokens.memberTokens) {
        memberToken.control({ releaseOthers: false });
    }
}

/**
 * Spread in Circle: animate member tokens walking to evenly-distributed positions
 * within a circle of `radius` grid cells around the leader.
 * Each member targets a unique angular slot at ~70% of the radius, then uses
 * A* pathfinding to walk there naturally.
 * @param {{ partyToken: Token, memberTokens: Token[] }} involvedTokens
 * @param {Token} targetToken - The leader/anchor token
 * @param {number} radius - Circle radius in grid cells
 * @returns {Promise<void>}
 */
export async function spreadInCircle(involvedTokens, targetToken, radius) {
    if (!canvas.ready) return;

    const isLeader = involvedTokens.memberTokens.some(t => t.id === involvedTokens.partyToken.id);

    canvas.tokens.releaseAll();

    // Play audio for all clients
    playActionAudio('audioFile4GetInPosition');

    const gs = canvas.grid.size;
    const { w: lw, h: lh } = getTokenSizeInCells(targetToken);

    const leaderCellX = Math.floor(targetToken.document.x / gs);
    const leaderCellY = Math.floor(targetToken.document.y / gs);
    const leaderCenterCellX = leaderCellX + Math.floor(lw / 2);
    const leaderCenterCellY = leaderCellY + Math.floor(lh / 2);

    // Determine which members to reposition
    const membersToSpread = isLeader
        ? involvedTokens.memberTokens.filter(t => t.id !== involvedTokens.partyToken.id && !t.document.hidden)
        : involvedTokens.memberTokens.filter(t => !t.document.hidden);

    if (membersToSpread.length === 0) return;

    const speed = Config.setting('gatherSpeed') || 'fast';

    // Place each member at a random position within the radius
    const count = membersToSpread.length;
    const movePromises = [];

    for (let i = 0; i < count; i++) {
        const memberToken = membersToSpread[i];

        // Random angle and random distance from 1 cell up to the full radius
        const angle = Math.random() * Math.PI * 2;
        const dist = 1 + Math.floor(Math.random() * radius);

        const idealCellX = leaderCenterCellX + Math.round(dist * Math.cos(angle));
        const idealCellY = leaderCenterCellY + Math.round(dist * Math.sin(angle));

        movePromises.push(
            positionTokenInCircle(memberToken, { x: idealCellX, y: idealCellY },
                { x: leaderCenterCellX, y: leaderCenterCellY }, radius, speed)
        );
    }

    await Promise.all(movePromises);

    // Select all members after positioning
    for (const memberToken of involvedTokens.memberTokens) {
        memberToken.control({ releaseOthers: false });
    }
}

/**
 * Moves a single token to the best available free cell near `idealCell`,
 * constrained within `radius` cells of `center`. Uses spiral search from the
 * ideal position, A* pathfinding, and the gather speed setting.
 * @param {Token} memberToken
 * @param {{x: number, y: number}} idealCell - Preferred target in grid cells
 * @param {{x: number, y: number}} center - Leader center in grid cells
 * @param {number} radius - Max distance from center in grid cells
 * @param {string} speed - Movement speed preset
 * @param {number} [maxSearch=48] - Max spiral positions to try
 * @returns {Promise<void>}
 */
async function positionTokenInCircle(memberToken, idealCell, center, radius, speed, maxSearch = 48) {
    const tokenDoc = memberToken.document;
    if (!tokenDoc) return;

    const gs = canvas.grid.size;
    const preset = GATHER_SPEED[speed] ?? GATHER_SPEED.fast;

    const startCell = {
        x: Math.floor(tokenDoc.x / gs),
        y: Math.floor(tokenDoc.y / gs)
    };

    const candidates = generateSpiralPositions(maxSearch, 0);

    for (const offset of candidates) {
        const cellX = idealCell.x + offset.x;
        const cellY = idealCell.y + offset.y;

        // Enforce circle constraint: must be within radius of leader center
        const dx = cellX - center.x;
        const dy = cellY - center.y;
        if (Math.sqrt(dx * dx + dy * dy) > radius) continue;

        const snapped = snapPoint(cellX * gs, cellY * gs);

        // Must not overlap another token
        if (isCellOccupied(memberToken, snapped.x, snapped.y)) continue;

        // A* pathfinding from current position to target
        const path = findPath(startCell, { x: cellX, y: cellY });
        if (!path || path.length < 2) continue;

        Logger.debug(`(positionTokenInCircle) [${memberToken.name}]: walking ${path.length} cells to (${cellX}, ${cellY}) [speed=${speed}]`);

        if (preset.stepByStep) {
            for (let i = 1; i < path.length; i++) {
                const cell = path[i];
                const sp = snapPoint(cell.x * gs, cell.y * gs);
                await tokenDoc.move(
                    [{ x: sp.x, y: sp.y }],
                    { method: "api", showRuler: false, constrainOptions: { ignoreWalls: true }, animation: { duration: preset.animPerCell } }
                );
                if (preset.delay > 0 && i < path.length - 1) {
                    await new Promise(r => setTimeout(r, preset.delay));
                }
            }
        } else {
            const simplified = simplifyPath(path);
            const waypoints = simplified.slice(1).map(cell => {
                const sp = snapPoint(cell.x * gs, cell.y * gs);
                return { x: sp.x, y: sp.y };
            });
            await tokenDoc.move(waypoints, {
                method: "api",
                showRuler: false,
                constrainOptions: { ignoreWalls: true },
                animation: { duration: Math.min(preset.animPerCell * path.length, preset.maxAnim) }
            });
        }
        return;
    }

    Logger.warn(false, `(positionTokenInCircle) [${memberToken.name}]: no valid position found within circle, leaving in place.`);
}

/**
 * Speed presets for gather movement.
 * - fast: all waypoints in a single move() call, 150ms per cell (max 3s)
 * - normal: step-by-step with 200ms pause between each cell
 * - slow: step-by-step with 400ms pause between each cell
 */
const GATHER_SPEED = {
    fast:   { stepByStep: false, animPerCell: 150, maxAnim: 3000, delay: 0 },
    normal: { stepByStep: true,  animPerCell: 200, maxAnim: 0,    delay: 200 },
    slow:   { stepByStep: true,  animPerCell: 300, maxAnim: 0,    delay: 400 }
};

/**
 * Plays an audio file for all connected clients.
 * Reads the file path from the given setting key; skips if empty.
 * @param {string} settingKey - Config setting key (e.g. 'audioFile4GetOverHere')
 */
export function playActionAudio(settingKey) {
    const audioPath = (Config.setting(settingKey) || '').trim();
    if (!audioPath) return;
    foundry.audio.AudioHelper.play({
        src: audioPath, volume: 1, autoplay: true, loop: false
    }, true);
}

/**
 * Moves a single token to the best available free cell nearest to `targetCellPos`
 * using A* pathfinding to avoid walls. The token walks cell-by-cell through
 * waypoints for a natural keyboard-walking appearance.
 * @param {Token} memberToken
 * @param {{x: number, y: number}} targetCellPos - Desired position in grid cells
 * @param {Set<string>} reservedIds - IDs of tokens being gathered in this same batch
 * @param {number} [maxSearch=48] - Max spiral positions to try before giving up
 * @param {string} [speed='fast'] - Movement speed preset: 'fast' | 'normal' | 'slow'
 * @returns {Promise<void>}
 */
async function gatherToken(memberToken, targetCellPos, reservedIds = new Set(), maxSearch = 48, speed = 'fast') {
    const tokenDoc = memberToken.document;
    if (!tokenDoc) return;

    const gs = canvas.grid.size;
    const preset = GATHER_SPEED[speed] ?? GATHER_SPEED.fast;

    // Current cell position of the token
    const startCell = {
        x: Math.floor(tokenDoc.x / gs),
        y: Math.floor(tokenDoc.y / gs)
    };

    const candidates = generateSpiralPositions(maxSearch, 0);

    for (const offset of candidates) {
        const goalCell = {
            x: targetCellPos.x + offset.x,
            y: targetCellPos.y + offset.y
        };

        const snapped = snapPoint(goalCell.x * gs, goalCell.y * gs);

        // Check destination is not occupied by another token
        if (isCellOccupied(memberToken, snapped.x, snapped.y, reservedIds)) continue;

        // A* pathfinding from current position to goal, respecting walls
        const path = findPath(startCell, goalCell);

        if (!path || path.length < 2) {
            // No wall-aware path found — skip this candidate and try the next spiral cell
            continue;
        }

        Logger.debug(`(gatherToken) [${memberToken.name}]: walking ${path.length} cells to (${goalCell.x}, ${goalCell.y}) [speed=${speed}]`);

        if (preset.stepByStep) {
            // Normal / Slow: move one cell at a time with pauses between steps
            // Use full (unsimplified) path so every cell is a visible step
            for (let i = 1; i < path.length; i++) {
                const cell = path[i];
                const sp = snapPoint(cell.x * gs, cell.y * gs);
                await tokenDoc.move(
                    [{ x: sp.x, y: sp.y }],
                    { method: "api", showRuler: false, constrainOptions: { ignoreWalls: true }, animation: { duration: preset.animPerCell } }
                );
                if (preset.delay > 0 && i < path.length - 1) {
                    await new Promise(r => setTimeout(r, preset.delay));
                }
            }
        } else {
            // Fast: simplify path to turning points and send all waypoints at once
            const simplified = simplifyPath(path);
            const waypoints = simplified.slice(1).map(cell => {
                const sp = snapPoint(cell.x * gs, cell.y * gs);
                return { x: sp.x, y: sp.y };
            });
            await tokenDoc.move(waypoints, {
                method: "api",
                showRuler: false,
                constrainOptions: { ignoreWalls: true },
                animation: { duration: Math.min(preset.animPerCell * path.length, preset.maxAnim) }
            });
        }
        return;
    }

    Logger.warn(false, `(gatherToken) [${memberToken.name}]: no reachable free cell found within ${maxSearch} attempts, leaving in place.`);
}

/**
 * Move members to saved formation offsets relative to the leader.
 * Reuses the same gather movement pattern (A* pathfinding + speed settings).
 * @param {{ partyToken: Token, memberTokens: Token[] }} involvedTokens
 * @param {Token} targetToken - The leader/anchor token
 * @param {object} formation - Map of memberId → { dx, dy } offsets in grid cells
 * @returns {Promise<void>}
 */
export async function moveToFormation(involvedTokens, targetToken, formation) {
    if (!canvas.ready) return;

    canvas.tokens.releaseAll();

    playActionAudio('audioFile4LoadFormation');

    const gs = canvas.grid.size;
    const { w: lw, h: lh } = getTokenSizeInCells(targetToken);

    const leaderCellX = Math.floor(targetToken.document.x / gs);
    const leaderCellY = Math.floor(targetToken.document.y / gs);
    const leaderCenterCellX = leaderCellX + Math.floor(lw / 2);
    const leaderCenterCellY = leaderCellY + Math.floor(lh / 2);

    const isLeader = involvedTokens.memberTokens.some(t => t.id === involvedTokens.partyToken.id);
    const membersToMove = isLeader
        ? involvedTokens.memberTokens.filter(t => t.id !== involvedTokens.partyToken.id && !t.document.hidden)
        : involvedTokens.memberTokens.filter(t => !t.document.hidden);

    if (membersToMove.length === 0) return;

    const speed = Config.setting('gatherSpeed') || 'fast';
    const movePromises = [];

    for (const memberToken of membersToMove) {
        const offset = formation[memberToken.id];
        if (!offset) continue;

        const targetCell = {
            x: leaderCenterCellX + offset.dx,
            y: leaderCenterCellY + offset.dy
        };

        movePromises.push(walkToFormationCell(memberToken, targetCell, speed));
    }

    await Promise.all(movePromises);

    for (const memberToken of involvedTokens.memberTokens) {
        memberToken.control({ releaseOthers: false });
    }
}

/**
 * A* pathfinding on the grid, respecting walls.
 * Uses 8-directional movement (cardinal + diagonal) for natural paths.
 * @param {{x: number, y: number}} startCell - Start position in grid cells
 * @param {{x: number, y: number}} goalCell - Goal position in grid cells
 * @param {number} [maxIterations=800] - Safety limit to prevent runaway searches
 * @returns {{x: number, y: number}[]|null} Array of cell positions from start to goal, or null if unreachable
 */
function findPath(startCell, goalCell, maxIterations = 800) {
    const gs = canvas.grid.size;
    const key = (x, y) => `${x},${y}`;

    // 8 directions: cardinal then diagonal
    const dirs = [
        { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
        { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }
    ];

    // Chebyshev distance heuristic (matches 8-directional movement cost)
    const heuristic = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

    const startKey = key(startCell.x, startCell.y);
    const goalKey = key(goalCell.x, goalCell.y);

    // Open set as a Map for O(1) lookup; we scan for min-f (acceptable for typical path lengths)
    const openSet = new Map();
    openSet.set(startKey, { x: startCell.x, y: startCell.y, g: 0, f: heuristic(startCell, goalCell) });

    const closedSet = new Set();
    const cameFrom = new Map();

    let iterations = 0;

    while (openSet.size > 0 && iterations < maxIterations) {
        iterations++;

        // Find node with lowest f-score
        let current = null;
        let currentKey = null;
        for (const [k, node] of openSet) {
            if (!current || node.f < current.f) {
                current = node;
                currentKey = k;
            }
        }

        // Reached the goal — reconstruct path
        if (currentKey === goalKey) {
            const path = [];
            let ck = currentKey;
            while (ck) {
                const [cx, cy] = ck.split(',').map(Number);
                path.unshift({ x: cx, y: cy });
                ck = cameFrom.get(ck);
            }
            return path;
        }

        openSet.delete(currentKey);
        closedSet.add(currentKey);

        for (const dir of dirs) {
            const nx = current.x + dir.x;
            const ny = current.y + dir.y;
            const nk = key(nx, ny);

            if (closedSet.has(nk)) continue;

            // Wall collision check between cell centers
            const fromCenter = { x: current.x * gs + gs / 2, y: current.y * gs + gs / 2 };
            const toCenter = { x: nx * gs + gs / 2, y: ny * gs + gs / 2 };
            const wallHit = CONFIG.Canvas.polygonBackends.move.testCollision(
                fromCenter, toCenter, { type: "move", mode: "any" }
            );
            if (wallHit) continue;

            // Diagonal moves cost ~1.414, cardinal moves cost 1
            const moveCost = (dir.x !== 0 && dir.y !== 0) ? 1.414 : 1;
            const tentativeG = current.g + moveCost;

            const existing = openSet.get(nk);
            if (existing && tentativeG >= existing.g) continue;

            cameFrom.set(nk, currentKey);
            openSet.set(nk, { x: nx, y: ny, g: tentativeG, f: tentativeG + heuristic({ x: nx, y: ny }, goalCell) });
        }
    }

    return null; // No path found within iteration limit
}

/**
 * Simplifies a cell path by removing intermediate points along straight segments.
 * Keeps only turning points (where direction changes), reducing waypoint count
 * while preserving the exact route.
 * @param {{x: number, y: number}[]} path
 * @returns {{x: number, y: number}[]}
 */
function simplifyPath(path) {
    if (path.length <= 2) return path;

    const simplified = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
        const prev = path[i - 1];
        const curr = path[i];
        const next = path[i + 1];
        // Keep this point only if direction changes
        const dx1 = curr.x - prev.x;
        const dy1 = curr.y - prev.y;
        const dx2 = next.x - curr.x;
        const dy2 = next.y - curr.y;
        if (dx1 !== dx2 || dy1 !== dy2) {
            simplified.push(curr);
        }
    }
    simplified.push(path[path.length - 1]);
    return simplified;
}

/**
 * Teleports tokens using blink movement to bypass walls.
 * Temporarily switches each token's movementAction to "blink", moves it,
 * then restores the previous movementAction.
 * @param {object[]} tokenUpdates - Array of { _id, x, y, elevation, hidden }
 * @returns {Promise<void>}
 */
export async function teleport(tokenUpdates) {
    for (const update of tokenUpdates) {
        const tokenDoc = canvas.scene.tokens.get(update._id);
        if (!tokenDoc) continue;

        await tokenDoc.update({ hidden: update.hidden, elevation: update.elevation });

        const actionKey = "blink";
        if (!CONFIG.Token?.movement?.actions?.[actionKey]) {
            Logger.error(false, `${Config.localize("errMsg.movementActionNotFound")}: ${actionKey}.\n${Config.localize("errMsg.pleaseReportThisError")}`);
            return;
        }
        const previousAction = tokenDoc.movementAction;
        try {
            if (previousAction !== actionKey) await tokenDoc.update({ movementAction: actionKey });
            await tokenDoc.move([{ x: update.x, y: update.y }], {
                method: "config",
                showRuler: false,
                autoRotate: false,
                constrainOptions: { ignoreWalls: true }
            });
        } finally {
            try {
                await tokenDoc.update({ movementAction: previousAction });
            } catch (err) {
                Logger.error(false, "Failed to restore movementAction:", err);
            }
        }
    }
}

/**
 * Moves a token directly to its exact formation cell using A* pathfinding.
 * Unlike gatherToken, this function has no spiral fallback and no isCellOccupied check —
 * formation positions are authoritative. If the token is already at the target it returns
 * immediately (avoiding the path.length < 2 → spurious-move bug). Falls back to a direct
 * snap move if A* cannot find a path.
 * @param {Token} memberToken
 * @param {{x: number, y: number}} targetCell - Exact target in grid cells
 * @param {string} speed - Movement speed preset
 * @returns {Promise<void>}
 */
async function walkToFormationCell(memberToken, targetCell, speed) {
    const tokenDoc = memberToken.document;
    if (!tokenDoc) return;

    const gs = canvas.grid.size;
    const preset = GATHER_SPEED[speed] ?? GATHER_SPEED.fast;

    const startCell = {
        x: Math.floor(tokenDoc.x / gs),
        y: Math.floor(tokenDoc.y / gs)
    };

    // Already at the target — nothing to do
    if (startCell.x === targetCell.x && startCell.y === targetCell.y) return;

    const path = findPath(startCell, targetCell);
    const snapped = snapPoint(targetCell.x * gs, targetCell.y * gs);

    if (!path || path.length < 2) {
        // A* couldn't find a path — move directly, ignoring walls
        await tokenDoc.move([{ x: snapped.x, y: snapped.y }], {
            method: "api", showRuler: false,
            constrainOptions: { ignoreWalls: true },
            animation: { duration: preset.maxAnim ?? 3000 }
        });
        return;
    }

    Logger.debug(`(walkToFormationCell) [${memberToken.name}]: walking ${path.length} cells to (${targetCell.x}, ${targetCell.y}) [speed=${speed}]`);

    if (preset.stepByStep) {
        for (let i = 1; i < path.length; i++) {
            const sp = snapPoint(path[i].x * gs, path[i].y * gs);
            await tokenDoc.move([{ x: sp.x, y: sp.y }], {
                method: "api", showRuler: false,
                constrainOptions: { ignoreWalls: true },
                animation: { duration: preset.animPerCell }
            });
            if (preset.delay > 0 && i < path.length - 1) {
                await new Promise(r => setTimeout(r, preset.delay));
            }
        }
    } else {
        const simplified = simplifyPath(path);
        const waypoints = simplified.slice(1).map(cell => {
            const sp = snapPoint(cell.x * gs, cell.y * gs);
            return { x: sp.x, y: sp.y };
        });
        await tokenDoc.move(waypoints, {
            method: "api", showRuler: false,
            constrainOptions: { ignoreWalls: true },
            animation: { duration: Math.min(preset.animPerCell * path.length, preset.maxAnim) }
        });
    }
}

/**
 * Moves a single token to the best available free cell nearest to `targetCellPos`.
 * If `targetCellPos` is blocked (wall or token overlap), walks the spiral outward
 * until a free cell is found (up to `maxSearch` attempts).
 * @param {Token} memberToken
 * @param {{x: number, y: number}} targetCellPos - Desired position in grid cells (absolute scene coords)
 * @param {Set<string>} reservedIds - IDs of tokens being spread in this same batch (treat as non-blocking)
 * @param {number} [maxSearch=48] - Max spiral positions to try before giving up
 * @returns {Promise<void>}
 */
export async function spreadToken(memberToken, targetCellPos, reservedIds = new Set(), maxSearch = 48) {
    const tokenDoc = memberToken.document;
    if (!tokenDoc) return;

    const gs = canvas.grid.size;
    const { w: tw, h: th } = getTokenSizeInCells(memberToken);

    // Try the desired cell first, then spiral outward from it
    const candidates = generateSpiralPositions(maxSearch, 0);

    for (const offset of candidates) {
        const cellX = targetCellPos.x + offset.x;
        const cellY = targetCellPos.y + offset.y;
        const px = cellX * gs;
        const py = cellY * gs;

        const snapped = snapPoint(px, py);

        // Wall collision: check from current center to candidate center
        const fromCenter = memberToken.center;
        const toCenter = {
            x: snapped.x + (tw * gs) / 2,
            y: snapped.y + (th * gs) / 2
        };
        const wallHit = CONFIG.Canvas.polygonBackends.move.testCollision(
            fromCenter, toCenter, { type: "move", mode: "any" }
        );
        if (wallHit) continue;

        // Token overlap check using top-left pixel position
        if (isCellOccupied(memberToken, snapped.x, snapped.y, reservedIds)) continue;

        Logger.debug(`(spreadToken) [${memberToken.name}]: placing at cell (${cellX}, ${cellY}) => px (${snapped.x}, ${snapped.y})`);
        await tokenDoc.move(
            [{ x: snapped.x, y: snapped.y }],
            { method: "api", showRuler: true, constrainOptions: { ignoreWalls: false }, animation: { duration: 400 } }
        );
        return;
    }

    Logger.warn(false, `(spreadToken) [${memberToken.name}]: no free cell found within ${maxSearch} attempts, leaving in place.`);
}

/**
 * Builds a teleport update object for a single token.
 * @param {Token} token
 * @param {{x: number, y: number}} targetPosition
 * @param {number|null} targetElevation
 * @param {boolean} hidden
 * @returns {object}
 */
export function getTokenTeleportUpdate(token, targetPosition, targetElevation, hidden) {
    const effectiveTargetPosition = (targetPosition != null) ? targetPosition : token.position;
    const effectiveTargetElevation = (targetElevation != null) ? targetElevation : token.document.elevation;
    return {
        _id: token.document._id,
        x: effectiveTargetPosition.x,
        y: effectiveTargetPosition.y,
        elevation: effectiveTargetElevation,
        hidden: hidden
    };
}

/**
 * Wraps `canvas.grid.getSnappedPoint` using TOP_LEFT_VERTEX mode (0x10 = 16),
 * which snaps to the top-left corner of the nearest grid cell — the correct
 * anchor for token placement. VERTEX mode (1) was incorrect for tokens > 1×1
 * because it snaps to grid intersections without guaranteeing cell alignment.
 * @param {number} x
 * @param {number} y
 * @returns {{x: number, y: number}}
 */
export function snapPoint(x, y) {
    // GRID_SNAPPING_MODE.TOP_LEFT_VERTEX (0x10 = 16) ensures the result is the
    // top-left corner of the cell, not an arbitrary vertex intersection.
    const mode = CONST.GRID_SNAPPING_MODE?.TOP_LEFT_VERTEX ?? 0x10;
    return canvas.grid.getSnappedPoint({ x, y }, { mode });
}

/**
 * Generates an outward spiral of grid-cell positions starting at ring `startRing`.
 * Each ring N covers all cells at Chebyshev distance N from origin (0,0).
 * Returns up to `count` positions, in clockwise order per ring.
 * @param {number} count      - How many positions to generate
 * @param {number} startRing  - First ring to populate (0 = origin cell, 1 = adjacent, etc.)
 * @returns {{x: number, y: number}[]}
 */
export function generateSpiralPositions(count, startRing = 1) {
    const positions = [];
    let ring = startRing;

    while (positions.length < count) {
        const r = ring;
        const perimeter = [];
        for (let x = -r; x <= r; x++)   perimeter.push({ x, y: -r });
        for (let y = -r + 1; y <= r; y++) perimeter.push({ x: r, y });
        for (let x = r - 1; x >= -r; x--) perimeter.push({ x, y: r });
        for (let y = r - 1; y >= -r + 1; y--) perimeter.push({ x: -r, y });
        for (const p of perimeter) {
            positions.push(p);
            if (positions.length >= count) break;
        }
        ring++;
    }
    return positions;
}

/**
 * Returns the size of a token in grid cells as { w, h }.
 * Foundry stores width/height as cell counts on token.document.
 * Falls back to 1×1 if the document is unavailable.
 * @param {Token} token
 * @returns {{ w: number, h: number }}
 */
function getTokenSizeInCells(token) {
    const w = token.document?.width ?? 1;
    const h = token.document?.height ?? 1;
    return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/**
 * Checks whether placing `movingToken` at pixel position (px, py) would overlap
 * any other visible token on the canvas.
 * Uses bounding-box intersection in grid-cell space.
 * @param {Token} movingToken
 * @param {number} px - Target top-left x in pixels
 * @param {number} py - Target top-left y in pixels
 * @param {Set<string>} [excludeIds] - Token IDs to ignore (e.g. members being spread simultaneously)
 * @returns {boolean}
 */
function isCellOccupied(movingToken, px, py, excludeIds = new Set()) {
    const gs = canvas.grid.size;
    const { w: mw, h: mh } = getTokenSizeInCells(movingToken);

    const mx1 = px / gs;
    const my1 = py / gs;
    const mx2 = mx1 + mw;
    const my2 = my1 + mh;

    for (const other of canvas.tokens.placeables) {
        if (other.id === movingToken.id) continue;
        if (excludeIds.has(other.id)) continue;
        if (other.document.hidden) continue;

        const ox1 = other.document.x / gs;
        const oy1 = other.document.y / gs;
        const { w: ow, h: oh } = getTokenSizeInCells(other);
        const ox2 = ox1 + ow;
        const oy2 = oy1 + oh;

        // AABB overlap — touching edges don't count
        if (mx1 < ox2 && mx2 > ox1 && my1 < oy2 && my2 > oy1) return true;
    }
    return false;
}

/**
 * "Kill them All!" movement: sends groups of member tokens toward arbitrary
 * target tokens (enemies), clustering around each one via the same A* + spiral
 * placement used by gatherParty. All members move simultaneously.
 *
 * @param {Token[][]} memberGroups - memberGroups[i] = members assigned to targetTokens[i]
 * @param {Token[]}   targetTokens - Enemy/target tokens to gather around
 * @returns {Promise<void>}
 */
export async function gatherToTargets(memberGroups, targetTokens) {
    if (!canvas.ready) return;
    const gs = canvas.grid.size;
    const speed = Config.setting('gatherSpeed') || 'fast';

    const allMovers = memberGroups.flat();
    if (allMovers.length === 0) return;

    // Shared reserved set — cleared as each member is assigned a destination
    const reservedIds = new Set(allMovers.map(t => t.id));
    const movePromises = [];

    for (let gi = 0; gi < targetTokens.length; gi++) {
        const targetToken = targetTokens[gi];
        const members = memberGroups[gi];
        if (!members || members.length === 0) continue;

        const { w: tw, h: th } = getTokenSizeInCells(targetToken);
        const startRing = Math.ceil(Math.max(tw, th) / 2);
        const targetCellX = Math.floor(targetToken.document.x / gs) + Math.floor(tw / 2);
        const targetCellY = Math.floor(targetToken.document.y / gs) + Math.floor(th / 2);
        const spiralPositions = generateSpiralPositions(members.length, startRing);

        for (let i = 0; i < members.length; i++) {
            const memberToken = members[i];
            reservedIds.delete(memberToken.id);
            const targetCell = {
                x: targetCellX + spiralPositions[i].x,
                y: targetCellY + spiralPositions[i].y
            };
            movePromises.push(gatherToken(memberToken, targetCell, new Set(reservedIds), 48, speed));
        }
    }

    await Promise.all(movePromises);
}
