# Group Tokens — API Reference

All public functions are available on the `PartyCruncher` global (`window.PartyCruncher`).
Every method listed here is **GM-only** — calling from a non-GM client shows a warning and returns immediately.

You can get a group's ID by clicking the copy icon next to the group name in the Dashboard.

---

## PartyCruncher.toggleParty(groupId?)

Toggle a group between **grouped** (crunched) and **ungrouped** (exploded) state.
The module auto-detects the current state and performs the opposite action.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupId` | `string` or `null` | `null` | The group to toggle. When omitted, uses the first group on the current scene. |

```js
// Toggle the first group on this scene
PartyCruncher.toggleParty()

// Toggle a specific group by ID
PartyCruncher.toggleParty("abc123")
```

**What happens:**
- **Crunch** — all members fly into the leader token and become hidden.
- **Explode** — all members reappear in a spiral pattern around the leader.

---

## PartyCruncher.findParty(groupId?)

Select all tokens belonging to a group and pan the camera to them.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupId` | `string` or `null` | `null` | The group to find. When omitted, uses the first group on the current scene. |

```js
PartyCruncher.findParty()
PartyCruncher.findParty("abc123")
```

**What happens:**
- If the group is **ungrouped**, selects and pans to the member tokens.
- If the group is **grouped**, selects and pans to the leader token.
- If the GM is viewing a different scene, automatically navigates to the group's scene first.

---

## PartyCruncher.getOverHere(groupId?)

Gather all visible members around the leader using animated movement.
Members walk toward the leader using A\* pathfinding that respects walls.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupId` | `string` or `null` | `null` | The group to gather. When omitted, uses the first group on the current scene. |

```js
PartyCruncher.getOverHere()
PartyCruncher.getOverHere("abc123")
```

> Only works when the group is ungrouped (members visible on the canvas).

---

## PartyCruncher.getInPosition(groupId?)

Spread visible members into a circle formation around the leader.
Each member walks to an evenly-distributed position using A\* pathfinding.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupId` | `string` or `null` | `null` | The group to spread. When omitted, uses the first group on the current scene. |

```js
PartyCruncher.getInPosition()
PartyCruncher.getInPosition("abc123")
```

The circle radius is controlled by the **Get in Position Radius** setting (default: 30 grid cells, configurable from 3 to 100 in *Actions & Sounds*).

> Only works when the group is ungrouped (members visible on the canvas).

---

## PartyCruncher.killThemAll(groupId?)

Send visible group members toward GM-targeted enemy tokens using animated A\* movement.
Members split round-robin across multiple targets and cluster around each one without overlapping existing tokens.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupId` | `string` or `null` | `null` | The group to act on. When omitted, uses the first group on the current scene. |

```js
PartyCruncher.killThemAll()
PartyCruncher.killThemAll("abc123")
```

**Requirements:**
- The group must be ungrouped (members visible on the canvas).
- At least one token must be targeted by the GM (`game.user.targets`).
- A slider dialog opens to choose how many members to send (1 → all visible members).

**What happens:**
- With **1 target** — all selected members cluster around it.
- With **multiple targets** — members are distributed round-robin; each sub-group clusters around their assigned target.

---

## PartyCruncher.saveFormation(groupId?)

Save the current positions of all visible members relative to the leader.
The formation is stored persistently in the group data and survives page reloads.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupId` | `string` or `null` | `null` | The group whose formation to save. When omitted, uses the first group on the current scene. |

```js
PartyCruncher.saveFormation()
PartyCruncher.saveFormation("abc123")
```

**Requirements:**
- The group must be ungrouped (members visible).
- Members must be spread out — tokens stacked directly on the leader are skipped.

---

## PartyCruncher.loadFormation(groupId?)

Move visible members to their previously saved formation positions.
Uses the same animated A\* pathfinding movement as Get Over Here.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupId` | `string` or `null` | `null` | The group whose formation to load. When omitted, uses the first group on the current scene. |

```js
PartyCruncher.loadFormation()
PartyCruncher.loadFormation("abc123")
```

> A formation must have been saved first (via `saveFormation` or the HUD button). If no formation exists, a warning is shown.

---

## PartyCruncher.groupParty(groupId?, preSelectedTokenIds?, preferredTokenId?)

Create a new group or update an existing one from selected tokens.
Opens a dialog to pick the leader token.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `groupId` | `string` or `null` | `null` | Pass an existing group ID to update it, or `null` to create a new group. |
| `preSelectedTokenIds` | `string[]` or `null` | `null` | Token IDs to use as members. When `null`, uses the currently selected tokens on the canvas. |
| `preferredTokenId` | `string` or `null` | `null` | Token ID to pre-select as leader in the dropdown. |

```js
// Create a group from the currently selected tokens
PartyCruncher.groupParty()

// Update an existing group with specific token IDs
PartyCruncher.groupParty("abc123", ["token1", "token2", "token3"], "token1")
```

> At least 2 tokens must be selected (or provided via `preSelectedTokenIds`).

---

## PartyCruncher.Dashboard()

Open the Group Tokens Dashboard window.

```js
PartyCruncher.Dashboard()
```

This is the only method that bypasses the busy-state guard — the Dashboard is read-only and can always be opened, even during animations.

---

## Notes

### Busy State

Only one animation can run at a time. If you call a method while another is still running, the call is ignored with a "please wait" warning. You can check the current state:

```js
PartyCruncher.isBusy()  // returns true or false
```

### Scene Fallback

When any method is called without a `groupId`, it automatically resolves to the **first group configured on the current scene**. If no groups exist on the scene, a warning is shown.

### Movement Speed

The animated movement speed for Get Over Here, Kill Them All, Get in Position, and Load Formation is controlled by the **Gather Speed** setting:

| Value | Behavior |
|-------|----------|
| `fast` | All waypoints sent in one move call, 150ms per cell (max 3s total) |
| `normal` | Step-by-step, 200ms animation + 200ms pause per cell |
| `slow` | Step-by-step, 300ms animation + 400ms pause per cell |

Configure in *Module Settings &#8594; Actions & Sounds*.
