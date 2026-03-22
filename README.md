# Group Tokens for Foundry VTT

Merge any group of tokens into a single leader token and split them back apart with one click. Perfect for traveling parties, NPC squads, escort missions, or any set of tokens that should move as one.

- Unlimited groups, up to **25 members** each
- One-click **group / ungroup** from the Token HUD
- Animated movement with **A\* pathfinding** (respects walls)
- **Save & Load Formations** so your party always lines up the way you want
- **Scene Transfer** — move an entire group to another scene, preserving HP, items, and effects
- Built for **Foundry VTT V13+**

---

## Quick Start

### 1. Create a Group

1. Select **2 or more tokens** on the canvas.
2. Right-click any of them and click the **Group Tokens** icon in the Token HUD (right column).
3. Click **Create Group**.
4. Pick which token will be the **leader** — it stays visible when the group is collapsed; every other token hides behind it.

### 2. Group / Ungroup (Toggle)

Right-click the leader token &#8594; Group Tokens icon &#8594; **Toggle Group**.

- **Group (Crunch)** — members fly into the leader and disappear.
- **Ungroup (Explode)** — members reappear around the leader in a spiral pattern.

The module auto-detects the current state, so you only need one button.

### 3. Get Over Here!

After ungrouping, members may be scattered across the map. Right-click the leader &#8594; **Get Over Here!** to call them back. They walk toward the leader using A\* pathfinding that respects walls.

### 4. Get in Position!

Right-click the leader &#8594; **Get in Position!** to spread members into a circle formation around the leader. The radius is configurable in *Actions & Sounds* settings (default: 30 grid cells).

### 5. Save & Load Formation

Once your members are arranged exactly where you want them:

1. Right-click the leader &#8594; **Save Formation** — stores each member's position relative to the leader.
2. Later, right-click the leader &#8594; **Load Formation** — members walk back to their saved spots using the same animated pathfinding as Get Over Here.

The *Load Formation* button only appears after a formation has been saved. Formations persist across sessions.

### 6. Add or Remove Tokens

- **Add:** right-click an ungrouped token &#8594; Group Tokens icon &#8594; **Add to Group #N**.
- **Remove:** select one or more tokens &#8594; right-click &#8594; Group Tokens icon &#8594; **Remove from Group**.

### 7. Dashboard

Open the Dashboard from the Token HUD (every context menu has an **Open Dashboard** button) or from *Module Settings &#8594; Configure Groups*.

From the Dashboard you can:

- **Toggle** any group (group/ungroup)
- **Find** a group (select and pan to its tokens)
- **Transfer** a group to another scene
- **Expand** a group to see its members
- **Promote** a member to leader
- **Remove** individual members
- **Clear** (delete) a group entirely
- **Copy Group ID** for use in macros

---

## Scene Transfer

Groups can be moved between scenes in two ways:

1. **Copy / Paste** — copy the leader token and paste it into another scene. The module intercepts the action, shows a confirmation dialog, and transfers all members automatically.
2. **Dashboard** — click the Transfer button next to any group and pick a destination scene.

All token data (HP, items, active effects on unlinked tokens) is fully preserved. Tokens are removed from the origin scene after a successful transfer. Groups arrive in collapsed (crunched) state — ungroup at the destination to spread members out.

---

## Kill them All!

Send group members to attack GM-targeted enemy tokens directly from the canvas:

1. With the group ungrouped, **target one or more enemy tokens** as the GM.
2. Right-click the leader &#8594; Group Tokens icon &#8594; **Kill them All!**
3. A slider dialog opens — choose how many members to send (1 to all visible members).
4. Members animate toward the targets using the same pathfinding as Get Over Here.
   - **1 target** — all selected members cluster around it.
   - **Multiple targets** — members are distributed round-robin across each target.

> The button only appears when the group is ungrouped and at least one GM target is set.

---

## Sounds

Open *Module Settings &#8594; Actions & Sounds* to configure:

| Setting | Description |
|---------|-------------|
| Gather Speed | How fast members walk during Get Over Here / Load Formation (`fast`, `normal`, `slow`) |
| Get in Position Radius | Circle radius in grid cells (3 – 100, default 30) |
| Audio — Get Over Here | Sound effect when gathering members |
| Audio — Get in Position | Sound effect when spreading members |
| Audio — Load Formation | Sound effect when loading a formation |
| Audio — Group (Crunch) | Sound effect on group collapse |
| Audio — Ungroup (Explode) | Sound effect on group expand |
| Audio — Kill them All | Sound effect when sending members to attack targets |

---

## Visual Markers

The module draws small badges and colored borders on group tokens so you can tell at a glance who belongs to which group:

- **Leader tokens** get a red border and a crown badge.
- **Member tokens** get a blue border and a pawn badge.

These markers are visible to the GM only and update automatically as tokens are added, removed, or moved.

---

## Macros & API

All features are accessible from macros and the browser console via the `PartyCruncher` global. See **[API.md](API.md)** for the full reference.

Quick examples:

```js
// Toggle the first group on the current scene
PartyCruncher.toggleParty()

// Open the Dashboard
PartyCruncher.Dashboard()

// Save the current formation
PartyCruncher.saveFormation("group-id-here")
```

You can copy a group's ID from the Dashboard (small copy icon next to each group name).

---

## Good to Know

- Only the **GM** can create, toggle, and manage groups.
- A group can have up to **25 members**.
- Token identification uses **Foundry document IDs**, not names — duplicate token names are fine.
- All configuration is stored as **world settings** (shared across all GMs in the world).
- Groups whose scene has been deleted are automatically cleaned up.
- The Token HUD button can be hidden for specific actor types via *Module Settings &#8594; Actor Type Filter*.

## 🚀 Installation

Install via the Foundry VTT Module browser or use this manifest link:

```
https://raw.githubusercontent.com/brunocalado/group-tokens/main/module.json
```

## ⚖️ Credits & License

* **Code License:** GNU GPLv3.

* **get-over-here.mp3:** [https://pixabay.com/service/license-summary/](https://pixabay.com/service/license-summary/)

* **audio_explode:** Navadaux for the "explode" sound provided via freesound.org, released under CCO 1.0 license

* **audio_crunch:** Glaneur de sons for the "crunch" sound provided via freesound.org, released under CC BY 3.0 license

* **Disclaimer:** This is a fork from this [Link](https://github.com/coffiarts/FoundryVTT-crunch-my-party).