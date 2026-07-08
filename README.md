# Spatial Narrative — Geo Passage Navigator

A location-aware interactive fiction system built on [SugarCube 2](https://www.motoslave.net/sugarcube/2/). Passages unlock by physical proximity, shift their text by compass heading, and evolve over dwell time. The whole story lives in a single `.twee` file. A browser-based authoring tool lets you place and edit geo nodes on a live map and push directly to GitHub.

**Live reader:** `index.html` (root) — compiled SugarCube story  
**Authoring tool:** `author/index.html` — map-based passage editor  
**Story source:** `story/main.twee` — single-file Twee source of record

---

## How It Works

The system runs entirely in the browser. There is no server. GPS and compass data come from the device's native APIs (`navigator.geolocation`, `DeviceOrientationEvent`). A 1-second heartbeat loop (`setup.geo.heartbeat`) continuously checks position, heading, candidate proximity, dwell time, and directional rules, then updates the display DOM directly — no SugarCube passage navigation happens during play.

### The four display layers

| Layer | What controls it |
|---|---|
| **Active passage** | The geo node whose radius the player has dwelled inside long enough |
| **Displayed passage** | Either the active passage, its `@then` stage-two variant (after `@after` ms), or a `@dir` directional variant |
| **Compass** | Points toward all geo nodes linked from the active passage (or all Start-linked nodes in pre-active mode) |
| **Pre-active mode** | Before any passage is dwelled into: compass shows all Start-linked nodes with real GPS bearings as soon as location locks |

---

## Repository Structure

```
/
├── index.html          # Compiled SugarCube reader (Twine output, do not hand-edit)
├── story/
│   └── main.twee       # All story content — the single source of truth
├── author/
│   └── index.html      # Browser-based authoring tool
├── media/              # Images and audio files referenced by @image / @audio
├── vendor/             # Local copies of any vendored JS (SugarCube, etc.)
├── archive/            # Old or experimental builds
└── manifest.json       # Web app manifest for PWA / home screen install
```

---

## Passage Syntax

Every geo-tagged passage starts with `@` directives before its body text. All directives are optional except `@geo`.

```twee
:: PassageName [geo optional-extra-tags]
@geo LAT,LNG,RADIUS_METRES
@lede Short italic line shown above the body.
@dwell MILLISECONDS
@facing DEGREES
@after MILLISECONDS
@then OtherPassageName
@image filename.jpg
@audio filename.mp3
@dir START_DEG-END_DEG:TargetPassageName

Body text goes here. Plain prose.

[[LinkedPassage]]
[[AnotherLinkedPassage]]
```

> **Links and the compass:** `[[PassageName]]` links in a geo passage body are what the compass reads. `getLinkedTargets()` parses them from the passage text at runtime. The authoring tool manages links as a dedicated **Linked Passages** field — separate from prose body — to ensure they are always serialised correctly.

### Directive reference

| Directive | Description | Default |
|---|---|---|
| `@geo lat,lng,r` | Geographic anchor. `r` = trigger radius in metres. | Required for geo tag |
| `@lede text` | Short italic subtitle rendered above the body. | None |
| `@dwell ms` | Milliseconds the player must remain inside the radius before the passage activates. | 12000 ms |
| `@facing deg` | Override the global heading threshold (35°) for this passage's directional visibility. | 35° |
| `@after ms` | Milliseconds after activation before switching to the `@then` passage. | None |
| `@then Name` | Second-stage passage displayed once `@after` elapses. | None |
| `@image file` | Image filename relative to `media/`. Shown below body text. | None |
| `@audio file` | Audio filename relative to `media/`. Shown as `<audio controls>`. | None |
| `@dir S-E:Name` | If heading is in the arc S°→E°, display `Name` instead of the base passage. | None (multiple allowed) |

### Passage naming conventions

- **Base passage:** `PlaceName` — the primary geo node
- **Stage-two:** `PlaceName_late` — shown after `@after` ms via `@then`
- **Directional variants:** `PlaceName_north`, `PlaceName_east`, etc. — shown via `@dir`
- **Tag groups:** Add extra tags after `geo` to group related nodes (e.g. `[geo g8]`, `[geo harbour]`)

Directional and stage-two passages do **not** need a `@geo` directive — they inherit their parent's location context.

---

## The Start Passage

`Start` is a non-geo passage that acts as the story's map index. Every top-level geo node should be linked here with `[[PassageName]]`. These links drive the **pre-active** compass — before any passage is dwelled into, the compass shows all Start-linked nodes using real GPS bearings so the author can verify the full node set before field testing.

```twee
:: Start

[[FerryTerminal]]
[[ClockTower]]
[[Waterline]]
```

---

## Compass Behaviour

### Pre-active mode (GPS locked, no passage dwelled into yet)
- `refreshVisible` builds `v.visible` from all Start-linked geo points using real bearings from `v.current`
- Facing threshold is **not** applied — all nodes appear regardless of direction
- Compass markers rotate correctly as heading and position update

### Active mode (passage dwelled into)
- `refreshVisible` builds `v.visible` from geo points linked via `[[...]]` in the active passage
- Facing threshold applied as normal
- If the linked set becomes empty (between passages, heading away), `v.lastLinked` preserves the last known set with updated bearings — markers remain visible in grey (stale state) until the next passage activates

### Stale fallback
- Stale markers render grey (`.marker.stale`) with a note in the target list
- Bearings are recalculated from current position each tick so dots track movement even in stale state

---

## State Variables (`$geo`)

All runtime state lives in a single SugarCube variable initialised in `StoryInit`.

| Key | Type | Description |
|---|---|---|
| `watchId` | int / null | `navigator.geolocation.watchPosition` ID |
| `current` | `{lat, lng}` / null | Latest GPS fix |
| `heading` | number / null | Device compass heading in degrees |
| `active` | point object / null | The passage whose dwell threshold has been met |
| `candidate` | point object / null | Nearest passage inside its radius, not yet dwelled |
| `candidateSince` | timestamp / null | When the current candidate was first entered |
| `visible` | array | Geo nodes currently shown on compass |
| `lastLinked` | array | Last non-empty linked set; used as stale fallback between passages |
| `unlocked` | array | Names of all passages ever activated (persistent within session) |
| `displayed` | string / null | Name of the passage currently shown in the UI |
| `displayedBase` | string / null | Base name (before directional override) |
| `stageSince` | timestamp / null | When the current displayed stage started |
| `mode` | string | Human-readable mode label (`Idle`, `GPS live`, `Simulated walk`, etc.) |
| `dwellMs` | number | Global default dwell time (12000) |
| `headingThreshold` | number | Global heading cone width in degrees (35) |
| `gray` | bool | Gray mode filter toggle |
| `error` | string | Last error message, shown in statusbar |

---

## Core JavaScript Functions (`setup.geo`)

All engine logic lives in `setup.geo.*` inside `Story JavaScript`.

| Function | Purpose |
|---|---|
| `parse(text)` | Extracts `@` directives and body from raw passage text |
| `points()` | Returns all `[geo]`-tagged passages with valid coordinates |
| `distance(aLat,aLng,bLat,bLng)` | Haversine distance in metres |
| `bearing(aLat,aLng,bLat,bLng)` | True bearing in degrees |
| `buildVisibleList(points, preActive)` | Shared helper: compute bearing/relative for a point list; skips facing filter when `preActive=true` |
| `chooseCandidatePassage()` | Nearest point inside its radius, or null |
| `updateActiveByDwell()` | Promotes candidate to active once dwell threshold met |
| `getDwellProgress()` | Returns `{name, elapsed, required, pct}` for UI feedback |
| `chooseDirectionalPassage(base)` | Picks a `@dir` variant matching current heading |
| `updateDisplayedPassage()` | Resolves active → `@then` → `@dir` chain |
| `refreshVisible()` | Populates `$geo.visible`; pre-active uses Start links with no facing filter; active uses passage links with `lastLinked` fallback |
| `getShownPassage()` | Returns the parsed passage object currently on screen |
| `renderPassage()` | Writes title, lede, body, image, audio to DOM |
| `renderCompass()` | Draws heading arrow and bearing markers from `v.visible`; grey stale markers when `v.visible[0].stale` |
| `refresh()` | Master update: calls all of the above in order |
| `startGeolocation()` | Starts `watchPosition` |
| `enableOrientation()` | Requests `DeviceOrientationEvent` permission (iOS) and binds listener |
| `simulate()` | Steps through a hardcoded Halifax walk path for desktop testing |
| `toggleGrayMode()` | Applies subtle CSS filter |
| `bindUI()` | Attaches toolbar button listeners (idempotent) |
| `startHeartbeat()` | Starts 1s interval calling `refresh()` (idempotent) |
| `injectAppMeta()` | Injects PWA / iOS home-screen meta tags at runtime |

---

## UI Modes

### Pre-active mode (GPS locked, no dwell yet)
- Compass shows all Start-linked nodes with real bearings — markers move with heading and GPS
- Facing threshold not applied
- Passage display shows "Waiting for a place"

### Dwell mode (inside radius, not yet resolved)
- Passage title shows "Approaching [Name]"
- Body shows dwell progress percentage and countdown in seconds

### Active mode (dwell met)
- Passage title, lede, and body render from the displayed passage
- Compass shows linked nodes filtered by heading threshold
- `@after`/`@then` and `@dir` variants update silently as time and heading change
- Between passages: last linked set shown in grey (stale) until next passage activates

---

## Authoring Tool (`author/index.html`)

A standalone HTML file — no build step, no server.

### Workflow
1. Paste a GitHub Personal Access Token (repo scope) into the token field
2. Click **Load** — parses the live file and places markers on the map
3. **Click the map** to place a new geo passage (name it in the popup)
4. **Click New Passage** in the toolbar to create any passage without a map location — directional variants (`PlaceName_north`), stage-two passages (`PlaceName_late`), or any non-geo passage. Leave the `geo` tag out of the tags field.
5. **Click a marker** to select and edit a geo passage in the Editor tab
6. **Drag a marker** to reposition (lat/lng update live)
7. Edit fields in the Editor tab
8. **Linked Passages field** — tap passage buttons under "Add Link" to add `[[links]]`; tap ✕ on a chip to remove one. Changes write immediately to the passage data.
9. Click **Apply Changes** to commit prose/field edits, then add a commit message and click **Save**

> **Important:** The **Linked Passages** field is separate from Body Text. Links added here serialise as `[[Name]]` lines in the `.twee` output and are what the compass reads at runtime. Do not manually type `[[links]]` in the body textarea — use the Add Link buttons.

### Two ways to create a passage

| Method | Use when |
|---|---|
| **Click the map** | Placing a new geo node at a real-world location |
| **New Passage button** (toolbar) | Creating directional variants (`_north`, `_east`), stage-two passages (`_late`), `Start`-index entries, or any passage with no geographic coordinates |

### Tabs
- **Passages** — searchable list of all passages; click to select
- **Editor** — form-based editor for all `@` fields, directional rules, body text, and linked passages
- **Raw** — live preview of the generated `.twee` block for the selected passage

### iOS / home screen
The authoring tool includes PWA meta tags and a mobile-optimised layout. Add to iOS home screen for full-screen use.

---

## Deploying a Story

The reader is a compiled SugarCube `.html` file. To update it after editing `story/main.twee`:

1. Open `story/main.twee` in [Tweego](https://www.motoslave.net/tweego/) or the [Twine desktop app](https://twinery.org/)
2. Compile to `index.html` in the repo root
3. Push to `main` — GitHub Pages serves the result

> **Note:** GPS and `DeviceOrientationEvent` require HTTPS. GitHub Pages provides this automatically.

---

## Media Files

Place images and audio in the `media/` directory. Reference by filename only:

```twee
@image harbour-terminal.jpg
@audio ferry-ambient.mp3
```

---

## Design Notes

- **Netscape 95 aesthetic** — Windows 95 chrome, `#000080` navy, inset borders, `<marquee>`, Times New Roman body text.
- **No framework dependencies in the reader** — pure SugarCube + vanilla JS. Leaflet is used only in the authoring tool.
- **Passage body is prose, not SugarCube markup** — `@dir` and `@then` handle branching at the engine level.
- **Active passage persists when leaving a radius** — the last resolved passage stays visible until a new one activates.
- **Links drive the compass** — `[[PassageName]]` in a passage's body/links section is what `getLinkedTargets()` parses to build the compass target list.

---

## Current Story: Halifax Nodes

| Passage | Location | Notes |
|---|---|---|
| `FerryTerminal` | 44.6488, -63.5752 | 4 directional variants + late stage |
| `ClockTower` | 44.6476, -63.5728 | North directional variant |
| `Waterline` | 44.6464, -63.5699 | Simple single-stage |
| `Resolutes Club` | 44.6357, -63.5721 | Late stage + east variant; links to `Palula` |
| `Irving` | 44.6353, -63.5710 | Simple single-stage |
| `citadel1` | 44.6470, -63.5782 | Simple single-stage |
| `radstorm` | 44.6529, -63.5847 | Tight facing threshold (25°) + north variant |
| `Oteasare_Gorghe_vessesscen` | 44.6363, -63.5721 | 4 directional variants |
| `G8_WorldTradeCentre` | 44.6423, -63.5722 | G8 cluster; late stage + N/S variants |
| `G8_GrandParade` | 44.6480, -63.5749 | G8 cluster; late stage + cityhall/church variants |
| `G8_Commons` | 44.6430, -63.5869 | G8 cluster; late stage |
| `G8_Harbourfront` | 44.6460, -63.5695 | G8 cluster; N/W variants |
| `G8_CitadelLookout` | 44.6478, -63.5790 | G8 cluster; simple |
| `G8_RoutePoint` | 44.6439, -63.5736 | G8 cluster; simple |
| `Palula` | 44.6361, -63.5721 | Linked from `Resolutes Club` |

---

## Changelog

### July 2026
- **Authoring tool:** **New Passage button** in toolbar — creates any passage without requiring a map click; supports non-geo passages (directional variants, stage-two passages, etc.) with an optional tags field; opens a Win95-style modal dialog; Esc/Enter keyboard shortcuts and backdrop-click to dismiss
- **Authoring tool:** Dedicated **Linked Passages** field with chip UI — links serialised as `[[Name]]` lines, separated from prose body; `parseTwee` extracts existing `[[links]]` from body on load; `applyEdits` migrates any inline `[[links]]` typed in body textarea into the links array automatically
- **Compass pre-active mode:** `refreshVisible` populates `v.visible` from Start-linked geo points using real GPS bearings as soon as position locks, facing threshold skipped so all nodes appear immediately
- **Compass stale fallback:** `v.lastLinked` persists the last active linked set; between passages the compass shows these in grey with live-updated bearings so markers never freeze
- `buildVisibleList(points, preActive)` shared helper extracts bearing/relative computation into one place
- `.marker.stale` CSS class for grey between-passage compass dots
- Browse mode (fixed evenly-spaced angles) removed; compass is always bearing-driven
- PWA meta injection, `@image`/`@audio` support, dwell progress UI, iOS home-screen layout
