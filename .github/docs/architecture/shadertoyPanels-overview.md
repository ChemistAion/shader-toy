# Shader Toy — Additional Webview Panel Machinery

## Scope & method

This document distills the **panel machinery** from the `poc#sequencer` and `wip#sequencer` branches — not the sequencer feature itself, but the **engineering patterns for adding a second (or Nth) VS Code webview panel** as an addon within the shader-toy extension.

The sequencer is used as the reference implementation. The goal is a reusable blueprint for any future feature that requires its own dedicated webview panel (e.g. audio mixer, node editor, debug inspector).

Evidence:
- `origin/poc#sequencer` (9 commits, 30 files, +5633 over `pr#error-lines` merge)
- `origin/wip#sequencer` (14 commits, 43 files, +8604 — includes RC leftovers + polish stages 7–8)
- Both branches diverge from `a8e9231` (Merge PR #201 — `pr#error-lines`)
- Staged progression from panel scaffolding → data bridge → persistence → polish

---

## Executive summary

Adding a second webview panel requires touching **5 distinct layers** of the existing extension machinery, plus introducing a new `src/<feature>/` module namespace. The sequencer implementation proved the pattern and exposed key pitfalls around VS Code editor group placement, panel lifecycle management, and IPC message routing between multiple webviews.

| Layer | What changes | Key files |
|-------|-------------|-----------|
| 1. Panel creation & lifecycle | New panel type, parent tracking, disposal | `shadertoymanager.ts` |
| 2. Panel HTML generation | Standalone HTML document for the new panel | `src/<feature>/<feature>_panel_html.ts` |
| 3. Preview ↔ Panel IPC bridge | Message routing between preview webview and new panel | `shadertoymanager.ts` (hub) |
| 4. Preview webview integration | Button, init script, bridge extension in the existing preview | `webviewcontentprovider.ts` + new extensions |
| 5. UX placement | Editor group management to dock panel below preview | `src/<feature>/ux/vscode_ui_placement.ts` |

---

## Layer 1: Panel creation & lifecycle

### The `SequencerWebview` type pattern

A new panel is modeled as a typed reference that tracks its **parent** preview panel:

```typescript
type SequencerWebview = {
    Panel: vscode.WebviewPanel,
    Parent: vscode.WebviewPanel
};
```

This parent-tracking is essential:
- When the parent preview is disposed → the child panel is disposed too
- When the parent preview is recreated (resource root changes) → the child panel's parent reference is updated
- Toggle logic checks `this.sequencerWebview.Parent === sourcePanel` to avoid cross-preview conflicts

**Singleton pattern:** Only one sequencer panel can be open at a time. Opening for a different preview closes the previous one. This avoids IPC routing ambiguity.

### Lifecycle integration points in `ShaderToyManager`

The sequencer panel hooks into existing lifecycle at 4 specific points:

1. **Dynamic preview creation** (`showGlslPreview`) — after `updateWebview()`, optionally auto-opens the panel:
   ```typescript
   await this.openSequencerPanelIfNeeded(this.webviewPanel.Panel);
   ```

2. **Static preview creation** (`showStaticGlslPreview`) — same auto-open after webview update.

3. **Preview disposal** (both dynamic and static `OnDidDispose`) — tears down the panel:
   ```typescript
   if (this.sequencerWebview && this.sequencerWebview.Parent === newWebviewPanel) {
       this.sequencerWebview.Panel.dispose();
       this.sequencerWebview = undefined;
   }
   ```

4. **Preview recreation** (resource root changes force a new `WebviewPanel`) — re-parents:
   ```typescript
   if (this.sequencerWebview && this.sequencerWebview.Parent === oldPanel) {
       this.sequencerWebview.Parent = newWebviewPanel;
   }
   ```

### Panel creation function

```typescript
private createSequencerWebview = async (previewPanel: vscode.WebviewPanel): Promise<vscode.WebviewPanel> => {
    const extensionRoot = vscode.Uri.file(this.context.getVscodeExtensionContext().extensionPath);

    // UX: best-effort focus/create below group
    await tryFocusOrCreateBelowGroup();

    const panel = vscode.window.createWebviewPanel(
        'shadertoy-sequencer',         // viewType (unique identifier)
        'Sequencer',                    // title
        { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
        {
            enableScripts: true,
            localResourceRoots: [extensionRoot]   // only extension resources
        }
    );
    panel.iconPath = this.context.getResourceUri('thumb.png');

    // Fallback UX: if still in top row, try to move below
    if (panel.viewColumn === vscode.ViewColumn.One || panel.viewColumn === vscode.ViewColumn.Two) {
        tryMovePanelBelowGroup(panel);
    }

    // Set HTML content
    const timelineSrc = this.context.getWebviewResourcePath(panel.webview, 'animation-timeline.min.js');
    const panelScriptSrc = this.context.getWebviewResourcePath(panel.webview, 'webview/sequencer_panel.js');
    panel.webview.html = getSequencerPanelHtml(timelineSrc, panelScriptSrc);

    // Dispose handler
    panel.onDidDispose(() => { ... });

    // IPC handler
    panel.webview.onDidReceiveMessage(async (message) => { ... });

    return panel;
};
```

Key observations:
- The panel gets its **own HTML document** — not the preview template
- `localResourceRoots` only needs the extension root (no shader file roots)
- Scripts are loaded via `<script src="...">` tags with webview resource URIs
- The panel has its own independent IPC handler

---

## Layer 2: Panel HTML generation

### Pattern: `getSequencerPanelHtml()` in `src/sequencer/sequencer_panel_html.ts`

The panel HTML is **not** assembled via `WebviewContentAssembler`. It is a simple function that returns a complete HTML string with template parameters:

```typescript
export const getSequencerPanelHtml = (timelineSrc: string, panelScriptSrc: string): string => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>/* inline CSS */</style>
</head>
<body>
  <div id="toolbar">...</div>
  <div id="content">
    <div id="sequencer_outline"></div>
    <div id="sequencer"></div>
  </div>
  <script src="${timelineSrc}"></script>
  <script src="${panelScriptSrc}"></script>
</body>
</html>`;
};
```

**Design decision:** The assembler/extension/placeholder pipeline was intentionally **not reused** for addon panels. Rationale:
- The preview pipeline is already complex and tightly coupled to the shader rendering template
- Addon panels have different structure (no Three.js, no shader compilation, no uniform GUI)
- A simple function with string interpolation is easier to understand and maintain
- Resources are passed as webview URI strings — the same `context.getWebviewResourcePath()` pattern used elsewhere

**Third-party library injection:** The sequencer uses `animation-timeline.min.js` — bundled in `resources/` with a `SOURCE.txt` attribution file. Loaded via `<script src>`, not the assembler pipeline.

---

## Layer 3: Preview ↔ Panel IPC bridge

### Architecture: Hub-and-spoke via `ShaderToyManager`

The manager acts as a **message hub** between three participants:

```
Preview Webview  ←→  ShaderToyManager  ←→  Sequencer Panel
     (1+)              (singleton)           (0 or 1)
```

There is **no direct communication** between the preview webview and the sequencer panel. All messages route through the extension host (TypeScript side).

### Message directions

**Preview → Manager:**
- `toggleSequencerPanel` — user clicked the sequencer button in preview
- `updateTime` — time tick (manager relays to sequencer panel)
- `setPause` — pause state change (manager relays to sequencer panel)
- `sequencerAddOrReplaceKeyFromUniform` — user clicked "+" on a uniform in preview (adds keyframe at current time)
- `requestRenderOneFrame` — request a one-shot redraw when paused

**Manager → Preview:**
- `sequencerState` — toggle button highlight (active/inactive)
- `sequencerSetUniformValues` — evaluated keyframe values to apply as uniform overrides
- `sequencerTrackUiByUniform` — per-track lock/visibility state for uniform GUI
- `renderOneFrame` — trigger a single frame render while paused
- `setTime` / `setPauseState` — time/pause control from sequencer scrubbing

**Sequencer Panel → Manager:**
- `sequencerSetTime` — user scrubbed the timeline
- `sequencerBeginScrub` / `sequencerEndScrub` — drag interaction state
- `sequencerSetPaused` — play/pause from sequencer toolbar
- `sequencerSetLoop` / `sequencerSetScope` / `sequencerSetSnapSettings` — project settings
- `sequencerSetTrackUi` — per-track visibility/lock/drag state
- `sequencerAddKey` / `sequencerMoveKey` / `sequencerSetKeyValue` / `sequencerDeleteKey` — keyframe edits
- `sequencerExportProject` / `sequencerImportProject` — JSON I/O (manager shows save/open dialogs)

**Manager → Sequencer Panel:**
- `syncTime` — relay current time from preview
- `syncPause` — relay pause state
- `sequencerProject` — full project data (on open, reload, import)
- `sequencerTrackValues` — evaluated per-track values for display

### Time synchronization pattern

The manager implements **throttled time sync** to avoid flooding IPC:

```typescript
private syncSequencerTime = (time: number, force: boolean = false): void => {
    const now = Date.now();
    if (!force && (now - this.lastSequencerTimeSyncAtMs) < 33) return;
    if (!force && Math.abs(time - this.lastSequencerTimeSynced) < 0.0005) return;
    // ... postMessage
};
```

Similarly, sequencer-driven uniform application is throttled:
```typescript
if ((now - this.lastSequencerAppliedAtMs) >= 30 || timeDelta >= 0.02) {
    this.applySequencerAtTime(t);
}
```

### Scrub interaction pattern (pitfall area)

Scrubbing required careful state management to avoid time-tick feedback loops:

1. `sequencerBeginScrub` → manager pauses all previews, sets `sequencerScrubbing = true`
2. During scrub, `updateTime` messages from preview are **ignored** (the scrub position is master)
3. `sequencerEndScrub` → manager restores previous pause state

The `scrubRestorePaused` field preserves whether the user had paused before the scrub started.

### Scope/loop boundary handling (pitfall area)

When playback reaches the end of the configured time scope:
- If `loop === true` → time wraps to scope start (via `wrapTimeIntoScope()`)
- If `loop === false` → auto-pause at end, set `sequencerStoppedAtScopeEnd = true`
- Next Play press → `restartPlaybackFromScopeStart()` (deterministic pause→setTime→unpause sequence)

This required a **deterministic restart sequence** to avoid race conditions with stale `updateTime` ticks.

---

## Layer 4: Preview webview integration

### Extensions added to the preview webview

Following the established extension pattern, the sequencer adds these to the preview:

| Extension | Type | Placeholder/Hook | Purpose |
|-----------|------|-------------------|---------|
| `SequencerButtonStyleExtension` | Style | `/* Sequencer Button Style */` | CSS for the toggle button |
| `SequencerButtonExtension` | Element | `<!-- Sequencer Button Element -->` | `<span>` element for button |
| `WebviewModuleScriptExtension` (sequencer_init.js) | Script | `<!-- Webview sequencer_init.js -->` | Click handler + sequencerState listener |
| `UniformsSequencerBridgeExtension` | Script | `// Uniforms Init` | Bridge for driving uniform values from sequencer |
| `AdvanceTimeExtension` (modified) | Script | (existing) | Added `__forcedTime` latch for sequencer scrubbing |
| `AdvanceTimeIfNotPausedExtension` (modified) | Script | (existing) | Added `renderOneFrame` message handler |

### `sequencer_init.js` — the preview-side init script

This module runs inside the preview webview and:
1. Finds the `#sequencer_button` element
2. Captures the `vscodeApi` early (defensive, since `acquireVsCodeApi()` can only be called once)
3. Posts `toggleSequencerPanel` on click
4. Listens for `sequencerState` messages to toggle the `.active` CSS class

### `UniformsSequencerBridgeExtension` — the uniform value injection bridge

This bridge runs inside the preview webview and:
1. Listens for `sequencerSetUniformValues` messages
2. Finds dat.GUI controllers by uniform name
3. Sets values and triggers shader re-render
4. Respects a `__uniformsMaster` flag (`'gui'` when paused, `'sequencer'` when playing) to avoid clobbering manual GUI edits

### `AdvanceTimeExtension` modifications

Two key additions for panel interaction:
1. **`__forcedTime` latch** — when the sequencer sets a specific time (scrub), the next frame uses that exact time instead of clock-derived time
2. **`renderOneFrame` handler** — allows rendering a single frame while paused (so sequencer-driven uniform changes are visible even when `pauseWholeRender` is enabled)

---

## Layer 5: UX placement

### The problem

VS Code's webview panel API provides `ViewColumn` (column-based layout) but no direct "put this panel below that panel" API. The sequencer needs to appear **below** the preview, like a timeline dock.

### The solution: `vscode_ui_placement.ts`

Two exported functions using best-effort VS Code editor commands:

**`tryFocusOrCreateBelowGroup()`** — called before `createWebviewPanel()`:
1. If only one editor group exists → create a new group below
2. If multiple groups exist → try to focus the group below the current one
3. If focus didn't change (no group below) → create one

**`tryMovePanelBelowGroup(panel)`** — called after creation as a fallback:
1. `panel.reveal()` to ensure the panel is active
2. Try `workbench.action.moveEditorToBelowGroup`
3. If that fails → create a new group below and move there

### Pitfalls discovered

1. **`tabGroups.all.length` check** — the wip version added explicit group count detection to avoid creating unnecessary groups when one already exists below. The poc version had a simpler approach that sometimes created duplicate groups.

2. **`setTimeout(150)` for move** — panel placement commands are asynchronous and the webview needs time to register in the editor group system before it can be moved. Without the delay, the move command operates on the wrong editor.

3. **`waitForUiTick` polling** — after issuing a focus command, the active group may not change synchronously. The poc version polls up to 3 times (50ms each) to detect if the focus actually changed.

4. **Fallback chains** — VS Code commands vary across versions. The implementation tries multiple command variants:
   - `workbench.action.moveEditorToBelowGroup`
   - `moveActiveEditor` with `{ to: 'down', by: 'group' }`
   - `workbench.action.moveActiveEditor` with same args

5. **`forceUX` config** — a `shader-toy.forceUX` setting (default `true`) gates the placement logic, allowing users to disable it if it conflicts with their workspace layout.

---

## Data layer: project persistence & derivation

### Pattern: derive from shader source, merge with stored state

The sequencer project is **derived from parsed `#iUniform` declarations** every time the shader tree is parsed:

```typescript
const customUniforms = webviewContentProvider.getCustomUniforms();
const nextProject = createSequencerProjectFromUniforms(customUniforms, { displayFps: 60 });
const stored = this.loadSequencerProjectForDocument(document);
this.sequencerProject = this.mergeSequencerProject(stored ?? nextProject);
```

The merge logic preserves user edits (keyframes, track settings, scope, snap) while updating the track list to match current shader uniforms. New uniforms get fresh tracks; removed uniforms lose their tracks.

### Storage: `workspaceState`

Persisted via VS Code's `workspaceState` API with a key derived from the document URI:

```typescript
private getSequencerStorageKey = (doc: vscode.TextDocument): string => {
    return `sequencerProject:${doc.uri.toString()}`;
};
```

This survives VS Code restarts but is workspace-scoped. Export/Import JSON provides portability.

### Opt-in via `#iUniform ... sequencer {}`

Stage 5 added a `sequencer` tag to the `#iUniform` parser directive. Only uniforms with this tag get sequencer tracks. The tag accepts an optional `{ ... }` block for future options.

Parser tolerates the typo `sequncer` for backward compatibility with early demos.

---

## Staged implementation progression (reference)

The sequencer was built in stages, each building on the previous:

| Stage | Commit | What it added |
|-------|--------|---------------|
| setup | `afd1393` | Button + element + style extensions in preview; `sequencer_init.js`; panel toggle IPC |
| stage0 | `bca0772` | Panel HTML skeleton; `createSequencerWebview`; basic time sync |
| stage1 | `7843ef5` | Track data model; uniform bridge; time advance modifications; project derivation |
| stage2 | `f1511e4` | Persistence (`workspaceState`); JSON export/import |
| stage3 | `3c7a08d` | Visual polish; animation-timeline library integration |
| stage4 | `f218649` | Uniforms init rewrite (sequencer-aware); bridge refinements |
| stage5 | `740c4b0` | Opt-in `sequencer` tag in `#iUniform` parser; `getCustomUniforms()` |
| stage6 | `a4e44b9` | Outline panel; snap-aligned gauge ticks |
| stage7 | `29388d6` | UX placement improvements; scrub/loop fixes |
| stage8 | `11de860` | Track locking; unavailable track handling |

The first commit (`afd1393`) is the minimal viable panel scaffold — everything needed to show a second webview that talks to the preview. Total for that commit: 11 files.

---

## Pitfalls & regressions addressed

### 1. `acquireVsCodeApi()` can only be called once

**Problem:** The preview webview calls `acquireVsCodeApi()` early. If `sequencer_init.js` tries to call it again, it throws.
**Solution:** `runtime_env.js` was modified to cache the API on `window.ShaderToy.env.vscodeApi`. The init script checks for the cached version first, falling back to a fresh call only if needed.

### 2. Time tick feedback loops during scrubbing

**Problem:** Preview sends `updateTime` → manager syncs to sequencer → sequencer updates time → preview sends `updateTime` with old value → loop.
**Solution:** `sequencerScrubbing` flag causes the manager to **ignore** preview `updateTime` messages during active scrub.

### 3. Stale time after scope-end auto-pause

**Problem:** When loop is off and playback reaches the scope end, the manager auto-pauses. But a stale `updateTime` from the preview (at the old time) can fight the pause and cause a time jump.
**Solution:** `restartPlaybackFromScopeStart()` uses a deterministic sequence: pause → set time → apply sequencer → delay(25ms) → unpause. The delay ensures stale ticks drain before resuming.

### 4. Panel placement in wrong editor group

**Problem:** `vscode.window.createWebviewPanel()` opens in `ViewColumn.Active`, but if no below-group exists yet, the panel ends up beside the preview instead of below it.
**Solution:** The two-phase approach: `tryFocusOrCreateBelowGroup()` before creation, `tryMovePanelBelowGroup()` as fallback after. The `setTimeout(150)` is necessary because the webview hasn't registered in the editor system yet.

### 5. Uniform value conflicts: sequencer vs. GUI

**Problem:** Both the dat.GUI sliders and the sequencer can set uniform values. When paused, the user expects manual slider control. When playing, the sequencer should drive values.
**Solution:** `__uniformsMaster` flag in `window.ShaderToy` switches between `'gui'` (paused) and `'sequencer'` (playing). The bridge extension checks this before applying values. A `__sequencerOverrideOnce` flag allows the sequencer to force-apply once during scrub even when paused.

### 6. Panel disposal race conditions

**Problem:** When the preview is disposed, the sequencer panel must also be disposed. But if the sequencer panel is already being disposed (user closed it), the double-dispose causes errors.
**Solution:** The `onDidDispose` handler checks `this.sequencerWebview.Panel === panel` before acting, and always sets `this.sequencerWebview = undefined` atomically.

### 7. Preview recreation orphans the panel

**Problem:** When shader resource roots change, the preview panel is disposed and recreated. The sequencer panel loses its parent reference.
**Solution:** Before disposing the old preview, the manager captures `carriedSequencer` reference and re-parents it to the new panel after creation.

### 8. `renderOneFrame` while paused with `pauseWholeRender`

**Problem:** When `pauseWholeRender` is enabled and the sequencer scrubs to a new time, the preview doesn't render the updated uniforms because the render loop is completely stopped.
**Solution:** A `renderOneFrame` message triggers exactly one `requestAnimationFrame` cycle in the preview, then stops again. The `AdvanceTimeExtension` was modified to not advance time during this one-shot render.

---

## Blueprint: adding a new panel feature

Based on the sequencer reference implementation, here is the minimal checklist for adding any new panel:

### 1. Create the feature module

```
src/<feature>/
├── <feature>_panel_html.ts      // HTML generation function
├── <feature>_project.ts         // Data model + persistence (if needed)
└── ux/
    └── vscode_ui_placement.ts   // Reuse from sequencer or import
```

### 2. Create webview runtime scripts

```
resources/webview/
├── <feature>_init.js            // Button click + state listener (runs in preview)
└── <feature>_panel.js           // Main panel logic (runs in panel)
```

### 3. Create preview extensions

```
src/extensions/user_interface/
├── <feature>_button_extension.ts
├── <feature>_button_style_extension.ts
```

Plus any bridge extension if the panel needs to drive preview state.

### 4. Wire into `WebviewContentProvider`

- Import and instantiate button/style extensions
- Add `WebviewModuleScriptExtension` for the init script
- Add placeholder comments in `webview_base.html` if needed

### 5. Wire into `ShaderToyManager`

- Define the panel type: `type <Feature>Webview = { Panel, Parent }`
- Add `create<Feature>Webview()` function
- Add `toggle<Feature>Panel()` function
- Hook into preview creation/disposal/recreation lifecycle
- Add IPC message handler in `panel.webview.onDidReceiveMessage()`
- Add new cases in existing preview `onDidReceiveMessage()` for `toggle<Feature>Panel`
- Add relay logic for time/pause sync if needed

### 6. Add third-party libraries (if needed)

- Bundle minified JS in `resources/`
- Add `SOURCE.txt` attribution file
- Load via `<script src>` in panel HTML (not the assembler pipeline)

### 7. Add configuration (if needed)

- Add setting to `package.json` contributes.configuration
- Read via `this.context.getConfig<T>('settingName')`

---

## Key design principles (extracted from sequencer)

1. **Addon panels get their own HTML** — don't force them through the preview assembler pipeline
2. **Hub-and-spoke IPC** — manager is the only message router; panels never talk directly to each other
3. **Parent tracking is mandatory** — every addon panel must know which preview it belongs to
4. **Singleton per feature** — only one instance of each panel type at a time (avoids routing ambiguity)
5. **Time sync is throttled** — ~30fps is enough; don't flood IPC on every `requestAnimationFrame`
6. **Scrub interactions need explicit state flags** — without them, feedback loops are inevitable
7. **UX placement is best-effort** — VS Code doesn't expose reliable panel docking; use command chains with fallbacks and delays
8. **Cache `acquireVsCodeApi()`** — it can only be called once per webview; cache the result early
9. **Preserve user state across reloads** — derive project from source, merge with stored state, persist via `workspaceState`
10. **Respect pause semantics** — when paused, manual controls are master; when playing, automation is master