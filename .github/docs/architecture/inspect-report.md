# Inspect Implementation Progression Report

> **Branch:** `wip#fragcoord-inspect`
> **Scope:** This report covers only the inspect-feature commit range above `master`, from merge-base `fd6be52c63c35229cf9592aa12035065f24f4fb4` through `HEAD`.
> **Method:** Every section below is based on local `git show` / `git diff` inspection of the actual commits in that range, not on commit subjects alone.
> **Focus:** The inspect-specific control path and runtime path: `package.json`, `src/extension.ts`, `src/webviewcontentprovider.ts`, `src/inspectpanel.ts`, `src/shadertoymanager.ts`, `resources/inspect_panel.html`, `resources/webview_base.html`, `resources/webview/shader_inspect.js`, and `test/inspect_runtime.test.ts`.
> **Exclusions:** No attempt is made to retell repository-wide history before the merge-base or unrelated feature branches, except where a chore commit directly affected the inspect implementation workflow or reference corpus.

---

## Table of Contents

1. [Executive summary](#1-executive-summary)
2. [Timeline](#2-timeline)
3. [Architecture snapshot of the final result](#3-architecture-snapshot-of-the-final-result)
4. [Detailed commit-by-commit progression](#4-detailed-commit-by-commit-progression)
5. [Implementation themes and recurring patterns](#5-implementation-themes-and-recurring-patterns)
6. [Reread order / most load-bearing commits](#6-reread-order--most-load-bearing-commits)
7. [Conclusion](#7-conclusion)

---

## 1. Executive summary

The inspect branch does **not** land the variable inspector as a single monolithic feature. It grows it in ten functional steps and four chore steps: first as a three-party IPC scaffold, then as a correctness pass for shader-source discovery and reload persistence, then as a set of render-loop subfeatures (hover readback, histogram), and finally as a hardening/polish pass that turns the feature from “works in the happy path” into a stateful, replay-safe subsystem.

Three architectural moves define the branch:

1. **A separate inspect panel was introduced as a first-class UI peer to the preview webview**, rather than as an overlay stuffed into the preview itself. That forced the extension host to become the message hub between editor selection, preview runtime, and panel UI.
2. **`ShaderToyManager` gradually became the state authority** for inspect. The initial version only forwarded selection and control messages; by the end of the branch it checkpointed variable, line, inferred type, mapping mode, compare mode, hover enablement, histogram enablement, and histogram interval, and replayed that bundle after preview rebuilds or panel recreation.
3. **The preview-side engine evolved from naive, directly-coupled readback to a disciplined post-render pipeline.** Hover readback moved to `afterFrame()`, histogram generation moved from repeated point samples to one framebuffer snapshot plus deferred CPU binning, timer-driven refresh was normalized into explicit 1Hz / 5Hz / 10Hz presets, and the final stage aligned histogram analysis with asynchronous full-frame evaluation plus timing telemetry.

The final result at `37952f7` is a coherent inspect architecture with a clean split of responsibilities:

- **Extension host:** selection capture, persisted inspect state, IPC fan-out/fan-in.
- **Preview runtime (`shader_inspect.js`):** type inference, shader rewriting, in-place material mutation, post-render readback, and async full-frame histogram evaluation.
- **Inspect panel:** control surface and telemetry surface, with explicit `panelReady`/`syncState` rehydration.

That split is the branch’s real achievement. The visible UI is only the surface expression of a deeper contract between state replay, preview shader mutation, and post-render telemetry.

---

## 2. Timeline

| # | Date | SHA | Commit | Primary architectural move |
|---|---|---|---|---|
| 1 | 2026-03-04 | `42cb6b2` | `stage1: INSPECT panel scaffold, IPC wiring, and selection-to-preview variable sync` | Introduced the entire inspect stack: command, panel, preview runtime, message routing, and selection-driven rewrite trigger. |
| 2 | 2026-03-04 | `606a6ae` | `stage2: fix inspector shader source lookup for master script-tag pipeline` | Switched source discovery from textarea-only to the actual master script-tag pipeline, with fallback. |
| 3 | 2026-03-05 | `236288f` | `stage3: fix inspector state loss after webview reload` | Added first persistence layer for selected variable/line and replay after preview rebuilds. |
| 4 | 2026-03-05 | `1b4c216` | `chore: agent setup preliminaries` | Added in-repo architecture/planning docs and skills that later inspect work clearly leaned on. |
| 5 | 2026-03-05 | `679d253` | `chore: fragcoord refs avail as submodule` | Added direct local access to FragCoord reference material via submodule. |
| 6 | 2026-03-05 | `440b4be` | `stage4: add inspector hover subfeature with panel toggle and live pixel readback` | Added hover readback, line-aware type resolution, and post-render pixel sampling. |
| 7 | 2026-03-05 | `b935bc2` | `stage5A: add live inspector histogram with CPU sampling and panel rendering` | Added the first histogram UI/data path, initially via sparse grid sampling. |
| 8 | 2026-03-06 | `9a76384` | `stage5B: optimize inspector histogram pipeline` | Replaced repeated point reads with one framebuffer snapshot plus deferred CPU binning and timer/dirty refresh. |
| 9 | 2026-03-06 | `6a8e9ab` | `chore: PRs worktrees added` | Added local PR worktree gitlinks; no inspect runtime change. |
| 10 | 2026-03-06 | `bdda780` | `chore: untrack local PR worktree gitlinks` | Reversed the tracked worktree gitlinks and ignored `/worktree/`; no inspect runtime change. |
| 11 | 2026-03-06 | `d754920` | `stage5C: stabilize inspect preview state and rendering` | Centralized inspect callback wiring, added `panelReady`/`syncState`, switched to in-place material rewrite, and added runtime tests. |
| 12 | 2026-03-06 | `5803782` | `stage5D: streamline inspect panel status and histogram toggle` | Made histogram enablement a persisted first-class control and simplified panel status/error presentation. |
| 13 | 2026-03-06 | `203e05d` | `stage5E: add inspect histogram refresh presets` | Added preset refresh intervals, interval persistence, normalization on both ends, and replay-order cleanup. |
| 14 | 2026-03-06 | `37952f7` | `stage5F: align histogram with async full-frame evaluation` | Kept the preset cadence surface intact while upgrading histogram analysis to queued async full-frame binning with timing telemetry. |

---

## 3. Architecture snapshot of the final result

### 3.1 Final topology

```text
VS Code editor selection
        │
        ▼
ShaderToyManager (extension host state hub)
        ├──────────────► InspectPanel webview
        │                  • variable metadata
        │                  • mapping / compare controls
        │                  • hover toggle
        │                  • histogram toggle
        │                  • histogram interval presets
        │
        └──────────────► Preview webview
                           • shader_inspect.js
                           • shader rewrite + recompile
                           • hover pixel readback
                           • histogram capture
                           • status / telemetry emission
```

The core design choice is that the preview webview and the inspect panel **never talk directly**. All traffic is mediated by `ShaderToyManager`, which owns the persisted state and decides what gets replayed after a rebuild.

### 3.2 Final layer breakdown

| Layer | Responsibility at `HEAD` | Key files |
|---|---|---|
| Command surface | Expose inspect as a VS Code command | `package.json`, `src/extension.ts` |
| Preview document assembly | Inject the inspect runtime into preview HTML | `src/webviewcontentprovider.ts`, `resources/webview_base.html` |
| State authority / hub | Cache inspect settings, listen to selection changes, relay messages, replay state after rebuilds | `src/shadertoymanager.ts` |
| Panel IPC facade | Create and own the separate inspector panel, translate webview messages to callbacks, push state into the panel | `src/inspectpanel.ts` |
| Panel UI | Render control surface and telemetry surface; emit `panelReady`, mapping, compare, hover, histogram, interval messages | `resources/inspect_panel.html` |
| Preview engine | Infer types, rewrite shader source, mutate final material in place, read pixels after render, asynchronously bin the full framebuffer, emit status/pixel/histogram telemetry | `resources/webview/shader_inspect.js` |
| Regression harness | Assert runtime contracts outside VS Code UI | `test/inspect_runtime.test.ts` |

### 3.3 Final persisted state in `ShaderToyManager`

By the end of the branch, the manager caches the full user-visible inspect configuration:

- `_lastInspectorVariable`
- `_lastInspectorLine`
- `_lastInspectorType`
- `_lastInspectorMapping`
- `_lastCompareEnabled`
- `_lastHoverEnabled`
- `_lastHistogramEnabled`
- `_lastHistogramIntervalMs`

That list is the best concise description of what “inspect state” means at the end of the branch. The earlier commits each add pieces of that surface.

### 3.4 Final message surface

#### Panel → Host

| Message | Purpose |
|---|---|
| `setMapping` | Change inspect color mapping (`linear` / `sigmoid` / `log`, min/max, out-of-range highlighting) |
| `setCompare` | Toggle compare-mode rewrite |
| `setHoverEnabled` | Enable/disable hover pixel readback |
| `setHistogramEnabled` | Enable/disable histogram capture |
| `setHistogramInterval` | Request one of the normalized refresh presets |
| `panelReady` | Signal that the panel webview is loaded and can receive replayed state |
| `navigateToLine` | Ask host to reveal a file/line |

#### Host → Panel

| Message | Purpose |
|---|---|
| `syncState` | Replay mapping / compare / hover / histogram / interval state |
| `updateVariable` | Push selected expression, line, and inferred type |
| `inspectorStatus` | Push current inspect status/error message |
| `pixelValue` | Push hover readback RGBA + position |
| `histogram` | Push histogram payload for canvas rendering |

#### Host → Preview

| Message | Purpose |
|---|---|
| `inspectorOn` / `inspectorOff` | Activate/deactivate inspect mode |
| `setInspectorVariable` | Select variable/expression and line |
| `setInspectorMapping` | Update color mapping parameters |
| `setInspectorCompare` | Toggle compare rewrite |
| `setInspectorHover` | Toggle hover readback |
| `setInspectorHistogram` | Toggle histogram capture |
| `setInspectorHistogramInterval` | Update refresh cadence |

#### Preview → Host

| Message | Purpose |
|---|---|
| `inspectorStatus` | Report success/error state and inferred variable/type |
| `inspectorPixel` | Report hover pixel readback |
| `inspectorHistogram` | Report histogram bins, stats, and evaluation timing |

### 3.5 Final preview-side execution path

1. User selects a word or expression in the editor.
2. `ShaderToyManager.startSelectionListener()` captures the text and 1-based line, caches it, and forwards it to both preview and panel.
3. In the preview, `shader_inspect.js`:
   - finds the active shader source via `getShaderSource()`,
   - translates the editor line with `getPreambleOffset()` if a preamble exists,
   - infers type via the FragCoord-derived resolver pipeline,
   - rewrites the final fragment shader via `rewriteForInspector()` or `rewriteForCompare()`,
   - runs the rewritten text through `prepareFragmentShader()` when available,
   - mutates the **existing** final material in place,
   - marks it dirty and forces one frame.
4. `resources/webview_base.html` calls `window.ShaderToy.inspector.afterFrame()` after the final render pass, when GL state is valid.
5. `afterFrame()` performs:
   - single-pixel hover readback when enabled,
   - full-frame histogram snapshot when the dirty flag is set.
6. Histogram generation is finalized as:
   - one `gl.readPixels(0, 0, w, h, ...)` into a reusable buffer,
   - queued secondary-buffer capture when a previous CPU pass is still running,
   - generation/cancel logic so stale async work is discarded cleanly,
   - deferred CPU binning during idle time over the **full framebuffer** in chunks,
   - 128 bins per channel,
   - 3-point smoothing before emission,
   - `timeMs` telemetry so the panel can show evaluation cost alongside sample count.
7. The panel redraws from host-fed telemetry and restores its own UI state via `syncState` when recreated.

### 3.6 Final test anchor

`test/inspect_runtime.test.ts` does **not** try to validate the full UI. Instead it protects the runtime contracts that matter most:

- inspector rewrites the original material **in place**,
- inspector restoration returns the original fragment shader,
- histogram enablement toggles correctly,
- histogram refresh interval defaults to `1000` ms and can switch to `200` and `100` ms,
- histogram evaluation bins the full framebuffer and reports timing metadata.

That is a deliberately architectural test surface: it asserts lifecycle and state transitions rather than pixel-perfect visuals.

---

## 4. Detailed commit-by-commit progression

### 4.1 `42cb6b2` — `stage1: INSPECT panel scaffold, IPC wiring, and selection-to-preview variable sync`

**Touched files**

- `package.json`
- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `resources/webview_base.html`
- `src/extension.ts`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`
- `src/webviewcontentprovider.ts`

**What changed**

This commit is the real birth of the feature. It did not merely add a command and a placeholder UI; it landed the complete first version of the inspect architecture across all layers:

- `package.json` contributed a new command: `shader-toy.showInspectPanel`.
- `src/extension.ts` registered that command and delegated it to `ShaderToyManager.showInspectPanel()`.
- `src/webviewcontentprovider.ts` began injecting `resources/webview/shader_inspect.js` into the preview template.
- `resources/webview_base.html` added an inspect-specific message bridge, forwarding:
  - `setInspectorVariable`
  - `setInspectorMapping`
  - `inspectorOn`
  - `inspectorOff`
  - `setInspectorCompare`
  into `window.ShaderToy.inspector.handleMessage(...)`.
- `src/inspectpanel.ts` introduced a dedicated VS Code webview panel class, with callbacks for mapping and compare toggles plus host-to-panel methods for variable/status/pixel updates.
- `src/shadertoymanager.ts` became the initial IPC hub: it opened the panel, listened for selection changes, forwarded selected expressions to the preview, and relayed preview-side status/pixel telemetry back into the panel.
- `resources/inspect_panel.html` created the initial control surface: status dot, selected variable display, type badge, mapping controls, compare toggle, pixel readback display, and help text.
- `resources/webview/shader_inspect.js` landed the actual preview-side engine:
  - FragCoord-style type inference helpers,
  - swizzle and declaration resolution,
  - function-signature parsing,
  - mapping generation,
  - shader rewriting for both inspect and compare mode,
  - message-driven state (`_active`, `_variable`, `_line`, `_mapping`, `_compareMode`),
  - a public `window.ShaderToy.inspector` API.

**Why it mattered**

This commit established the feature as a **three-sided system**, not a single widget:

- the **editor** is the selection source,
- the **preview** is the only place that can rewrite and render shader output,
- the **inspect panel** is the durable control/telemetry surface.

That forced the extension host into a broker role from the very first implementation. Without that broker, the feature would either have required invasive preview UI changes or direct panel-to-preview coupling.

**Effect on the implementation arc**

Stage1 front-loaded a huge amount of real logic. The branch thereafter is mostly about making this initial system actually reliable on the real codebase:

- stage2 fixes the wrong shader-source lookup assumption,
- stage3 fixes rebuild-state loss,
- stage4 adds post-render readback,
- stages 5A–5E add and then harden histogram behavior,
- stage5C finally makes the preview mutation strategy and panel rehydration robust.

The most important reading insight is that the branch starts with a **mostly functional but not yet production-stable** architecture.

---

### 4.2 `606a6ae` — `stage2: fix inspector shader source lookup for master script-tag pipeline`

**Touched files**

- `resources/webview/shader_inspect.js`

**What changed**

The `getShaderSource()` implementation in the preview runtime changed from a textarea-only lookup to a dual-path lookup:

- first try `script[type="x-shader/x-fragment"]`,
- if none are present, fall back to `textarea[data-shadertoy="shader"]`.

The lookup still takes the **last** matching element as the final/image buffer source.

**Why it mattered**

The initial inspect engine was written against a hot-reload-style textarea assumption. The actual master preview pipeline uses fragment shader `<script>` tags. That meant stage1 could be architecturally impressive and still fail on the branch it was meant to run on.

This is a classic transplant bug: the imported engine was correct in its own origin assumptions, but the host integration point was wrong.

**Effect on the implementation arc**

Stage2 is small in diff size but foundational in practical effect. It converts the stage1 scaffold from “ported machinery” into “machinery that can operate on the branch’s actual preview assembly contract.” It also implicitly documents an important compatibility boundary: inspect is expected to tolerate multiple preview-source hosting strategies.

---

### 4.3 `236288f` — `stage3: fix inspector state loss after webview reload`

**Touched files**

- `src/shadertoymanager.ts`

**What changed**

This commit introduced the first host-side persistence layer for inspect:

- new cached fields:
  - `_lastInspectorVariable`
  - `_lastInspectorLine`
- the selection listener now stores the last selected expression and line before forwarding them.
- `resendInspectorState()` was added and invoked after preview rebuild paths:
  - `migrateToNewContext(...)`
  - active document reloads
  - active editor changes
- replay logic sent:
  - `inspectorOn`
  - `setInspectorVariable`

**Why it mattered**

The preview HTML is not permanent. The extension rebuilds the webview on save, on editor change, and on context migration. In the stage1 design, inspect existed only as live messages; the moment the preview webview was recreated, inspect effectively forgot what it was supposed to inspect.

That is the first point where the branch explicitly acknowledges that inspect is not just a render-time mode; it is a **stateful session** that must survive preview lifecycle churn.

**Effect on the implementation arc**

Stage3 marks the moment `ShaderToyManager` stops being just a router and begins becoming an authority. The state surface is still tiny—variable and line only—but the pattern is set:

- cache host-side state,
- replay it after rebuild,
- do not trust the preview to remain alive.

That exact pattern is expanded in stage5C, stage5D, and stage5E until it becomes the final inspect-state checkpoint.

---

### 4.4 `1b4c216` — `chore: agent setup preliminaries`

**Touched files**

- `.github/README.md`
- `.github/docs/architecture/shadertoy-report.md`
- `.github/docs/architecture/shadertoyPRs-overview.md`
- `.github/docs/architecture/shadertoyPanels-overview.md`
- `.github/docs/planning/fragcoord(0.7.1)-PLAN#errors.md`
- `.github/docs/planning/fragcoord(0.7.1)-PLAN#frames.md`
- `.github/docs/planning/fragcoord(0.7.1)-PLAN#heatmap.md`
- `.github/docs/planning/fragcoord(0.7.1)-PLAN#inspect.md`
- `.github/docs/planning/fragcoord-overview(0.7.1).md`
- `.github/docs/planning/fragcoord-transplant-plan(0.7.1).md`
- `.github/skills/fragcoord/SKILL.md`
- `.github/skills/shader-toy/SKILL.md`

**What changed**

This was a documentation/reference import commit, not a runtime commit. It brought a local architecture/planning corpus into the branch, including:

- repository architecture reports,
- a panel-machinery overview,
- FragCoord planning docs,
- project skills for FragCoord and shader-toy.

`.github/README.md` also explicitly framed these materials as support infrastructure for in-repo FragCoord transplant work.

**Why it mattered**

It did not change inspect behavior, but it materially changed how subsequent inspect work could be reasoned about and executed. From this point onward, the branch contains its own local reference package for:

- expected architecture style,
- prior panel machinery,
- FragCoord inspect transplant intent and terminology.

In other words: the branch stopped depending purely on memory or external lookup and started carrying its reference frame with it.

**Effect on the implementation arc**

This commit helps explain why the later inspect work feels increasingly deliberate. Stage1 had already landed a large port. After this commit, the branch gains explicit local documentation and skills that make future polish work more repeatable and easier to audit. For future engineers, this commit is not load-bearing for runtime, but it is load-bearing for **understanding why the subsequent commits are structured the way they are**.

---

### 4.5 `679d253` — `chore: fragcoord refs avail as submodule`

**Touched files**

- `.gitmodules`
- `references/fragcoord` (git submodule)

**What changed**

The branch added a new submodule:

- path: `references/fragcoord`
- URL: `https://github.com/ChemistAion/fragcoord`

**Why it mattered**

This made the upstream FragCoord reference corpus locally available as versioned source material, rather than only as planning text or ad hoc external reference. For a feature like inspect—which is visibly a transplant/adaptation rather than a greenfield subsystem—that matters.

**Effect on the implementation arc**

Again, no runtime behavior changed. But from an engineering-process perspective this commit lowered the cost of precise comparison against the source implementation, which is especially relevant for later subfeatures such as hover readback and histogram evolution. It is one of the branch’s “documentation gravity” commits: it pulls implementation work closer to a documented reference model.

---

### 4.6 `440b4be` — `stage4: add inspector hover subfeature with panel toggle and live pixel readback`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `resources/webview_base.html`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`

**What changed**

This commit added the first genuinely render-loop-coupled inspect subfeature: hover readback.

On the panel/UI side:

- `resources/inspect_panel.html` changed the pixel readback block into a toggleable subfeature via `hoverToggle`.
- the panel began dimming the pixel section when hover was disabled.
- `src/inspectpanel.ts` added `setOnHoverChanged(...)`.
- `src/shadertoymanager.ts` added `_lastHoverEnabled` and routed hover changes to the preview.

On the preview/runtime side:

- `shader_inspect.js` added `_hoverEnabled`.
- hover logic was rewritten from immediate `mousemove`-time readback into a two-step model:
  1. `mousemove` stores `_mouseX`, `_mouseY`, `_mouseInCanvas`,
  2. `afterFrame()` performs `gl.readPixels(...)` only after rendering completes.
- `resources/webview_base.html` added the `afterFrame()` hook at the end of the render pass.

The commit also significantly improved type resolution:

- `resolveVariableType(source, name, targetLine)` became line-aware.
- `inferType(...)` began accepting a target line.
- `getPreambleOffset(source)` was introduced to translate editor line numbers into source line numbers after injected preamble content.

**Why it mattered**

There are two separate fixes hiding inside this one commit.

First, hover readback required a valid GL state. Reading pixels directly from the mouse handler is structurally brittle; reading them from the end of the render loop is correct. That is the branch’s first clean statement of a broader rule later reused by histogram work: **inspect telemetry should happen after the final pass, not inside the input path**.

Second, line-aware type resolution fixed a correctness problem that the initial stage1 engine did not address well: a selected identifier can be shadowed or shifted by injected shader preamble. Once the branch started trying to inspect specific editor selections in real code, line context became necessary.

**Effect on the implementation arc**

Stage4 broadens inspect from “shader rewrite with a control panel” into “shader rewrite plus per-frame telemetry.” It also introduces a new class of persisted knob—hover enablement—which later becomes part of the general replay bundle.

One subtle but important reading point: this commit defines the hover feature’s UI and preview runtime, but the preview command forwarder for `setInspectorHover` is only fully normalized later in stage5C. So stage4 is where the hover subfeature conceptually arrives; stage5C is where it becomes fully integrated into the replay-safe command path.

---

### 4.7 `b935bc2` — `stage5A: add live inspector histogram with CPU sampling and panel rendering`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`

**What changed**

This commit introduced histogram support as a new preview-to-panel telemetry channel.

Panel/UI additions:

- the old help section was removed and replaced with a histogram section,
- a canvas (`histogramCanvas`) and min/sample/max stats were added,
- `drawHistogram(...)` rendered 128-bin RGB channel data as layered filled shapes,
- `src/inspectpanel.ts` gained `postHistogram(...)`,
- `src/shadertoymanager.ts` started relaying `inspectorHistogram` from preview to panel.

Preview/runtime additions:

- `shader_inspect.js` added `_histogramEnabled` and `_histogramFrame`,
- `afterFrame()` began invoking histogram generation every ten frames,
- histogram generation used a **32×32 sparse grid**:
  - sample 1024 points,
  - call `gl.readPixels(px, py, 1, 1, ...)` for each point,
  - accumulate 128 bins per channel,
  - compute `autoMin` / `autoMax`,
  - smooth with a 3-point pass,
  - emit `inspectorHistogram`.

**Why it mattered**

Hover readback answers “what is the current value under the cursor?” Histogram answers a different question: “what is the distribution of inspected output over the frame?” That is a much richer debugging tool because it reveals clipping, flattening, range collapse, and color-channel occupancy that a single pixel cannot.

Architecturally, this commit also expands the message contract: inspect is no longer just a control plane plus a scalar telemetry plane. It now carries a structured data payload.

**Effect on the implementation arc**

Stage5A is the first version of the histogram architecture, but it is clearly a first pass:

- always-on,
- frame-count driven,
- many small `readPixels()` calls,
- GPU and CPU work still coupled to frame cadence.

That matters because stage5B is best read not as a cosmetic optimization, but as a rewrite of the histogram execution model.

---

### 4.8 `9a76384` — `stage5B: optimize inspector histogram pipeline`

**Touched files**

- `resources/webview/shader_inspect.js`

**What changed**

This commit rewrote histogram capture and processing around a different cost model.

The old model:

- every tenth frame,
- 32×32 sparse grid,
- many one-pixel `readPixels()` calls directly inside histogram computation.

The new model:

- replace `_histogramFrame` with:
  - `_histogramDirty`
  - `_histogramTimer`
  - `_histogramPixelBuf`
- `afterFrame()` only acts when `_histogramDirty` is set.
- `snapshotForHistogram()` performs one full-frame `gl.readPixels(0, 0, w, h, ...)` into a cached `Uint8Array`.
- `binHistogram(pixels, totalPixels)` performs CPU-only binning after the readback:
  - stride across the buffer to cap work at roughly 4096 analyzed pixels,
  - accumulate 128 bins per channel,
  - compute min/max,
  - smooth and emit.
- `requestHistogramUpdate()` marks the next frame as needing capture.
- `startHistogramTimer()` starts a fixed 500 ms refresh cadence.
- variable changes, mapping changes, compare toggles, and hot reload now explicitly dirty the histogram so it refreshes on semantic changes, not just on frame count.

**Why it mattered**

The important change is not “full-frame readback instead of grid sampling” in isolation. It is the deliberate split between:

- **one bounded GPU synchronization point**, and
- **deferred CPU processing**.

In stage5A the histogram cost was distributed across many little GL reads. In stage5B the branch accepts one deliberate GPU stall, then moves the rest of the work out of the render path.

That is a real architectural maturation, not just a micro-optimization.

**Effect on the implementation arc**

Stage5B establishes the lasting histogram pattern that survives to `HEAD`:

- timer decides **when** to refresh,
- dirty flag decides whether the next post-render hook should capture,
- CPU binning happens outside the draw path,
- inspect-triggered state changes immediately request a new histogram.

Later commits add control surfaces around this machinery, but they do not replace its basic structure. This is one of the branch’s most load-bearing commits.

---

### 4.9 `6a8e9ab` — `chore: PRs worktrees added`

**Touched files**

- `worktree/pr217`
- `worktree/pr218`

**What changed**

This commit added two gitlinks under `worktree/`, pointing at local PR worktrees.

**Why it mattered**

It did not matter to inspect runtime behavior. It mattered only to local repository organization on the branch.

**Effect on the implementation arc**

Architecturally, none. Historically, it is still useful to record because it creates a short-lived detour in the branch between the main histogram optimization and the subsequent stabilization/polish work. It is one of the reasons the commit stream contains a small amount of non-feature noise even though the branch is strongly inspect-focused.

---

### 4.10 `bdda780` — `chore: untrack local PR worktree gitlinks`

**Touched files**

- `.gitignore`
- `worktree/pr217` (deleted)
- `worktree/pr218` (deleted)

**What changed**

This commit reversed the previous worktree gitlink tracking:

- removed both tracked gitlinks,
- added `/worktree/` to `.gitignore`.

**Why it mattered**

Again, no inspect runtime change. The repo was cleaned up so local worktree artifacts stopped participating in tracked history.

**Effect on the implementation arc**

This commit effectively restores the branch to a cleaner shape before the next substantive inspect hardening commit. Its main value in this report is simply to mark that there is **no feature-level inspect delta** between stage5B and stage5C other than short-lived repository hygiene noise.

---

### 4.11 `d754920` — `stage5C: stabilize inspect preview state and rendering`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `resources/webview_base.html`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`
- `test/inspect_runtime.test.ts`

**What changed**

This is the branch’s largest hardening commit and arguably the architectural turning point after stage1.

#### Panel-side state sync

- `resources/inspect_panel.html` added:
  - `applyInspectorState(mapping, compareEnabled, hoverEnabled)`,
  - `syncState` handling,
  - initial `panelReady` emission after startup,
  - `setHoverUi(...)` for consistent restored UI state.
- `src/inspectpanel.ts` added:
  - `onDidDisposeCallback`,
  - `onReadyCallback`,
  - `setOnDidDispose(...)`,
  - `setOnReady(...)`,
  - `postInspectorState(...)`.

This created an explicit panel lifecycle handshake:
1. panel loads,
2. panel emits `panelReady`,
3. host replays current inspect state into the panel.

#### Host-side consolidation

- `src/shadertoymanager.ts` added:
  - `DEFAULT_INSPECTOR_MAPPING`,
  - `_lastInspectorType`,
  - `_lastInspectorMapping`,
  - `_lastCompareEnabled`,
- and moved callback registration into a new `configureInspectPanel()` method called from the constructor.

That matters because stage1/4 registered callbacks from `showInspectPanel()`, which is structurally prone to repeated registration and inconsistent setup sequencing. Stage5C turns panel wiring into a one-time manager configuration concern.

It also added:

- `stopSelectionListener()`,
- `resendInspectPanelState()`,
- broader `resendInspectorState()` replay:
  - mapping,
  - compare,
  - hover,
  - variable,
  - then activation,
- improved `inspectorStatus` handling that preserves last-known variable/type if a message omits them.

#### Preview-side rendering stabilization

This commit also changed the most important preview-side rendering contract:

- it introduced `_originalFragmentShaders`,
- added `markShaderMaterialDirty(material)`,
- stopped constructing a fresh `THREE.ShaderMaterial` for inspect,
- started rewriting the **existing final buffer material in place**,
- restored the original fragment shader text on inspector shutdown,
- updated `currentShader` to the final buffer identity before recompilation.

The in-place rewrite comment in the diff is the right summary: the goal was to keep the render loop, uniform references, texture bindings, and other update paths all pointed at the same material object.

Finally, `resources/webview_base.html` added forwarding for `setInspectorHover`, completing the preview dispatch path for that setting.

#### Test introduction

`test/inspect_runtime.test.ts` was added and began asserting:

- rewrite of the original material in place,
- restoration of the original shader on `inspectorOff`.

**Why it mattered**

Stage5C fixes three different structural problems:

1. **panel reload drift** — panel controls and display could be recreated without a clean state replay;
2. **preview object instability** — creating a new material object for inspect was a fragile fit for the existing render loop;
3. **callback sprawl** — panel wiring lived in the “show panel” path instead of in stable manager setup.

This is the commit where inspect stops feeling like a set of staged experiments and starts feeling like a subsystem with deliberate lifecycle management.

**Effect on the implementation arc**

If stage3 made `ShaderToyManager` the seed of a persistence layer, stage5C completes that move for the non-histogram state surface. If stage1 proved the rewrite engine could exist, stage5C proves it can coexist with the existing preview render loop without object churn.

This is also the commit where inspect gets its first real regression harness, which is an important signal: from here on, the branch starts protecting architectural contracts explicitly.

---

### 4.12 `5803782` — `stage5D: streamline inspect panel status and histogram toggle`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `resources/webview_base.html`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`
- `test/inspect_runtime.test.ts`

**What changed**

This commit did two things: UI simplification and histogram state elevation.

#### UI simplification

- removed the standalone status section,
- introduced `.variable-error` inside the variable block,
- introduced `applyStatus(...)` so the status dot and inline error message became the only status surface,
- added opacity transitions for pixel and histogram sections,
- turned the histogram header into a checkbox-based toggle instead of a passive label.

This tightens the inspect panel considerably: status is now visually associated with the inspected symbol rather than living in a separate block.

#### Histogram as a first-class persisted setting

- `resources/inspect_panel.html` started sending `setHistogramEnabled`,
- `src/inspectpanel.ts` added `setOnHistogramChanged(...)`,
- `postInspectorState(...)` expanded to include `histogramEnabled`,
- `src/shadertoymanager.ts` added `_lastHistogramEnabled`, routed the toggle to the preview, and replayed it to both panel and preview,
- `resources/webview_base.html` began forwarding `setInspectorHistogram`,
- `shader_inspect.js` added `setInspectorHistogram` handling and exposed `isHistogramEnabled()`.

The key architectural change is that histogram stopped being an always-on side effect of inspect mode and became a separately managed state bit.

#### Test expansion

The runtime tests were extended to verify histogram enable/disable behavior.

**Why it mattered**

Up to this point, histogram existed but control over it was underdeveloped. That is tolerable for experimentation, but not for a feature that now has a real panel, replay logic, and a cost model.

This commit makes histogram participation explicit. It also reduces panel clutter by collapsing status into the variable block and turning the histogram section into a controllable telemetry area instead of a permanently active widget.

**Effect on the implementation arc**

Stage5D is less algorithmically dramatic than stage5B or stage5C, but it closes an important architecture gap: **histogram enablement becomes part of inspect state** rather than a hidden implementation decision. That is necessary groundwork for the final interval-preset work in stage5E.

---

### 4.13 `203e05d` — `stage5E: add inspect histogram refresh presets`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `resources/webview_base.html`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`
- `test/inspect_runtime.test.ts`

**What changed**

This commit finalized the histogram-control surface around explicit preset cadences.

#### Panel/UI

- added three preset buttons:
  - `1Hz` (`1000` ms)
  - `5Hz` (`200` ms)
  - `10Hz` (`100` ms)
- added:
  - `DEFAULT_HISTOGRAM_INTERVAL_MS = 1000`
  - `currentHistogramIntervalMs`
  - `normalizeHistogramInterval(...)`
  - `setHistogramIntervalUi(...)`
- extended `applyInspectorState(...)` to include `histogramIntervalMs`
- emitted `setHistogramInterval` from button clicks.

#### Preview/runtime

- added `_histogramIntervalMs = 1000`,
- added its own `normalizeHistogramInterval(...)`,
- switched the timer from hard-coded `500` ms to `_histogramIntervalMs`,
- handled `setInspectorHistogramInterval`,
- exposed `getHistogramIntervalMs()` for tests.

#### Host-side replay and ordering

- `src/inspectpanel.ts` added `setOnHistogramIntervalChanged(...)`,
- `postInspectorState(...)` now includes `histogramIntervalMs`,
- `src/shadertoymanager.ts` added:
  - `DEFAULT_HISTOGRAM_INTERVAL_MS`,
  - `_lastHistogramIntervalMs`,
  - interval callback wiring,
  - interval replay to both panel and preview.

Most importantly, `resendInspectorState()` was reordered so that the host now replays:

1. mapping,
2. compare,
3. hover,
4. histogram enablement,
5. histogram interval,
6. variable selection,
7. **then** `inspectorOn`.

That ordering is subtle but important. It means the preview activates only after its full configuration has been re-established, so timer startup and first capture use the correct state.

#### Test expansion

The runtime test harness grew a `setInterval` spy and interval getter assertions to prove:

- default interval is `1000` ms,
- `inspectorOn` starts the timer at the default cadence,
- interval changes to `200` and `100` ms are accepted and restart correctly.

**Why it mattered**

By the end of stage5D, histogram was toggleable but still effectively fixed in cadence. For a readback-heavy telemetry feature, cadence is part of the feature contract: it changes both responsiveness and cost.

This commit avoids unbounded user input by using preset normalization on **both** panel and preview sides. That is a very good design choice for a debugging tool: the option space is explicit, replay-safe, and easy to reason about.

**Effect on the implementation arc**

Stage5E closes the loop on inspect-state completeness. After this commit, every user-facing inspect control is:

- representable in host state,
- replayable into the panel,
- replayable into the preview,
- bounded by normalization logic,
- at least partially protected by tests.

This is the point where the branch’s control surface becomes configuration-complete. The next commit keeps that state model intact, but reshapes the histogram evaluation path behind it for higher fidelity and better observability.

---

### 4.14 `37952f7` — `stage5F: align histogram with async full-frame evaluation`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `test/inspect_runtime.test.ts`

**What changed**

This commit keeps the stage5E control surface intact and instead rewrites the **execution semantics** of histogram analysis.

#### Panel/UI telemetry

- `resources/inspect_panel.html` keeps the existing histogram widget and preset controls, but changes the footer text from a plain pixel-count label to a richer status string:
  - `Samples: ${h.samples}px / Time: ${h.timeMs.toFixed(2)}ms`

That small UI delta matters because it exposes two things the previous implementation hid:

- whether the histogram is sampling or fully analyzing,
- how expensive the evaluation actually was.

#### Preview/runtime pipeline alignment

The main work is in `resources/webview/shader_inspect.js`.

New helper/control primitives were added:

- `getNowMs()` for monotonic timing,
- `scheduleHistogramWork(...)` for `requestIdleCallback` / `setTimeout` fallback scheduling,
- `ensureHistogramBuffer(...)` for primary vs queued pixel-buffer reuse,
- `smoothHistogram(...)`,
- `postHistogram(...)`,
- `startHistogramProcessing(...)`,
- `drainQueuedHistogram()`,
- `cancelHistogramWork()`.

The histogram state surface also expanded:

- `_histogramQueuedPixelBuf`
- `_histogramQueuedTotalPixels`
- `_histogramQueuedGeneration`
- `_histogramQueuedStartedAtMs`
- `_histogramHasQueuedFrame`
- `_histogramProcessing`
- `_histogramGeneration`

Those fields turn histogram work into a managed asynchronous pipeline rather than a best-effort side task.

The runtime behavior changes are the real point:

- `snapshotForHistogram()` still performs exactly one full-frame `gl.readPixels(...)` call, but now decides whether to:
  - start binning immediately, or
  - queue the captured framebuffer while an older CPU binning pass is still in flight.
- `startHistogramProcessing(...)` no longer strides through a capped subset of pixels. It bins **every pixel** in the framebuffer, but does so incrementally in deadline-aware chunks.
- generation checks (`generation !== _histogramGeneration`) allow stale async work to self-cancel if inspect is disabled, histogram is disabled, or a newer capture supersedes the old one.
- `cancelHistogramWork()` invalidates current and queued work on `inspectorOff` and on histogram disablement.
- `postHistogram(...)` now emits `timeMs` in addition to bins, samples, `autoMin`, and `autoMax`.

This is a subtle but major semantic shift: stage5B made histogram cheaper to run, but stage5F makes it **faithful to the whole frame** while still respecting responsiveness.

#### Test expansion

`test/inspect_runtime.test.ts` was extended far beyond the earlier toggle/timer assertions:

- the harness now provides:
  - a fake `canvas`,
  - a fake `gl` with deterministic `readPixels(...)`,
  - a fake `vscode.postMessage(...)` capture,
  - a fake `performance.now()`.
- the new histogram test asserts:
  - exactly one full-frame `readPixels(...)` call,
  - all framebuffer pixels are analyzed,
  - `autoMin` / `autoMax` are correct,
  - `timeMs` is included and reported.

This is the first test that directly protects the histogram data path itself, not just the surrounding control surface.

**Why it mattered**

Stage5B established the right overall cost model—one readback plus deferred CPU work—but it still approximated the distribution by striding over a bounded sample set. That was a pragmatic optimization, but it left two gaps:

1. **fidelity gap** — the histogram described an approximation of the frame rather than the whole frame;
2. **observability gap** — the panel showed sample count but not evaluation cost.

Stage5F closes both gaps without regressing the branch’s earlier control work:

- cadence remains bounded by the stage5E presets,
- histogram enablement remains explicit from stage5D,
- host replay/state ownership remains unchanged from stage5C–5E,
- only the preview-side evaluation pipeline becomes deeper.

The queued-generation design is especially important. Once CPU binning is asynchronous, newer captures can arrive before older work completes. Without generation invalidation and queued handoff, the panel could show stale histograms or waste time finishing irrelevant work.

**Effect on the implementation arc**

Stage5F is the final histogram-algorithm step in the current history:

- stage5A proved the feature was valuable,
- stage5B made the cost model sane,
- stage5D made it user-toggleable,
- stage5E made cadence explicit and replay-safe,
- stage5F made the analysis itself full-frame, asynchronous, and measurable.

That means the branch now ends with a histogram subsystem that is not only configurable, but also more honest about both data fidelity and runtime cost.

---

## 5. Implementation themes and recurring patterns

### 5.1 The extension host becomes the inspect state authority

The branch starts with `ShaderToyManager` as a relay and ends with it as a checkpoint/replay authority. That transition is the dominant architectural theme of the history.

A good way to see the progression is by state surface growth:

- stage3: variable + line
- stage4: hover enablement
- stage5C: mapping + compare + type
- stage5D: histogram enablement
- stage5E: histogram interval

By `HEAD`, the manager is effectively the inspect session model.

### 5.2 `webview_base.html` stays intentionally thin

The preview template does not become an inspect brain. It remains a narrow bridge with two inspect-specific jobs:

1. forward a bounded set of inspect commands into `window.ShaderToy.inspector.handleMessage(...)`,
2. call `afterFrame()` after the final render pass.

That is a sound layering decision. The logic lives in `shader_inspect.js`; the template remains the transport hook.

### 5.3 The preview engine moves from object replacement to object mutation

One of the most important course corrections is stage5C’s move from constructing a new `THREE.ShaderMaterial` to mutating the original final material in place.

That choice aligns inspect with the extension’s existing render-loop assumptions:

- uniforms remain shared,
- texture bindings remain attached,
- render-loop references remain stable,
- restore is simpler because the original shader text is cached and reapplied.

This pattern is worth carrying forward for any future preview-side instrumentation feature.

### 5.4 Readback work is pulled onto the post-render boundary

Hover and histogram both converge on the same architectural rule:

- input events update intent/state,
- render loop does rendering,
- post-render hook performs readback.

That separation matters because GL readback depends on render completion and because it prevents input handlers from turning into rendering side-effect sites.

### 5.5 Histogram work evolves from “proof of value” to “cost-shaped pipeline”

The histogram progression is especially instructive:

- stage5A proves the UI/data value of the feature,
- stage5B rewrites the execution model around one readback + deferred CPU work,
- stage5D adds user enable/disable state,
- stage5E adds bounded cadence presets,
- stage5F upgrades the deferred path from sampled approximation to queued async full-frame evaluation with timing telemetry.

That is a healthy feature maturation pattern: first demonstrate usefulness, then shape cost, then expose controls, and finally tighten fidelity plus observability.

### 5.6 Settings are normalized at both ends of the IPC boundary

Histogram interval is the clearest example, but the pattern shows up elsewhere too: panel state is not blindly trusted. The panel and preview both normalize or bound inputs.

That makes the system more robust against stale UI state, malformed messages, and replay-order issues.

### 5.7 Testing targets contracts, not rendering aesthetics

The runtime tests introduced late in the branch do not try to prove visually perfect inspector output. Instead they protect the contracts most likely to regress:

- in-place rewrite,
- restoration,
- enable/disable toggles,
- timer configuration,
- full-frame histogram evaluation and timing payloads.

That is a pragmatic and architecture-aware choice for a webview/WebGL feature.

### 5.8 The chore commits show a reference-driven transplant workflow

The non-runtime commits are not random noise:

- one adds architecture docs and skills,
- one adds the upstream FragCoord reference as a submodule,
- two briefly add and then remove local worktree gitlinks.

The first two, especially, show that inspect work on this branch was being treated as a documented transplant exercise rather than as an isolated hack.

---

## 6. Reread order / most load-bearing commits

If someone needs to reacquire this feature quickly, the best reread order is not strictly chronological. The following sequence front-loads the most explanatory commits.

### 6.1 `42cb6b2` — the whole initial shape

Read this first to understand the original contract surface:

- command registration,
- panel creation,
- preview runtime injection,
- selection listener,
- core preview-side rewrite engine.

This is still the best single commit for learning what inspect fundamentally is.

### 6.2 `236288f` — the first persistence inflection point

Read this second to understand why the host must replay inspect state after preview rebuilds. Without this commit, the feature is conceptually simpler but behaviorally broken after save/reload flows.

It introduces the seed of the final manager-as-authority model.

### 6.3 `440b4be` — post-render readback and line-aware selection fidelity

Read this third because it introduces two ideas that recur later:

- **post-render readback** via `afterFrame()`,
- **editor-line to source-line translation** via `getPreambleOffset()` and target-line-aware type resolution.

Those are the two main correctness constraints behind hover and precise per-selection inspection.

### 6.4 `9a76384` — the first histogram cost-model rewrite

Read this next to understand where the histogram pipeline first becomes viable as a repeated telemetry feature. It is the commit that replaces many point reads with one capture plus deferred CPU work.

If future work touches inspect performance, this is one of the first commits to revisit.

### 6.5 `d754920` — lifecycle consolidation and in-place material mutation

This is probably the most important hardening commit in the series.

Read it for:

- `panelReady` / `syncState`,
- one-time `configureInspectPanel()` wiring,
- `resendInspectPanelState()` / richer `resendInspectorState()`,
- in-place material mutation,
- original fragment-shader restoration,
- first inspect runtime tests.

It explains most of why the final system is stable.

### 6.6 `203e05d` — final state closure and replay-order cleanup

Read this next to understand the finished control surface before the final histogram-evaluation alignment:

- preset interval buttons,
- interval normalization on both sides,
- interval persistence,
- replay order ending with `inspectorOn`.

It is the best commit for seeing how the branch closes its remaining configuration gaps cleanly.

### 6.7 `37952f7` — async full-frame histogram alignment

Read this last to understand the current endpoint of the branch’s histogram work:

- queued async CPU binning,
- generation-based cancellation,
- full-frame rather than strided histogram analysis,
- evaluation-time telemetry in the panel,
- tests that finally exercise the histogram payload itself.

This is the commit that turns the histogram from “well-controlled and efficient enough” into “well-controlled, efficient enough, and materially closer to the real framebuffer distribution.”

---

## 7. Conclusion

This commit range is best understood as the construction of an **inspect subsystem contract**, not merely the construction of a panel. The branch begins by proving that FragCoord-style inspect machinery can be transplanted into the preview, then spends the rest of its life making that machinery line-accurate, replay-safe, render-loop-correct, operationally affordable, and finally more faithful in its histogram evaluation model.

The final architecture at `37952f7` is strong because it settles on a clear split:

- the **manager** owns state and replay,
- the **preview runtime** owns rewriting, readback, and async histogram evaluation,
- the **panel** owns controls and telemetry presentation.

That split is the durable outcome of the branch. Future engineering work on inspect should preserve it, especially the host-side checkpointing model, the thin `webview_base.html` bridge, and the post-render readback discipline established across stages 4 through 5F.
