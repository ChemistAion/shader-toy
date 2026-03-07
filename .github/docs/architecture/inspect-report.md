# Inspect Implementation Progression Report

> **Branch:** `wip#fragcoord-inspect`
> **Scope:** This report covers only the inspect-feature commit range above `master`, from merge-base `fd6be52c63c35229cf9592aa12035065f24f4fb4` through `HEAD`.
> **Method:** Every section below is based on local `git show` / `git diff` inspection of the actual commits in that range, not on commit subjects alone.
> **Focus:** The inspect-specific control path and runtime path: `package.json`, `src/extension.ts`, `src/webviewcontentprovider.ts`, `src/inspectpanel.ts`, `src/inspectselection.ts`, `src/shadertoymanager.ts`, `resources/inspect_panel.html`, `resources/webview_base.html`, `resources/webview/shader_inspect.js`, `test/inspect_runtime.test.ts`, `test/inspectselection.test.ts`, and `test/webview_split.test.ts`.
> **Exclusions:** No attempt is made to retell repository-wide history before the merge-base or unrelated feature branches, except where a chore commit directly affected the inspect implementation workflow or reference corpus. Routine follow-up maintenance commits to this report are not enumerated individually.

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

The inspect branch does **not** land the variable inspector as a single monolithic feature. It grows it in twenty-one functional steps and five chore steps: first as a three-party IPC scaffold, then as a correctness pass for shader-source discovery and reload persistence, then as a set of render-loop subfeatures (hover readback, histogram, split-view verification), and finally as a late hardening/polish pass that turns the feature from “works in the happy path” into a stateful, replay-safe subsystem that respects preview mode, pause semantics, and histogram load limits.

Five architectural moves define the branch:

1. **A separate inspect panel was introduced as a first-class UI peer to the preview webview**, rather than as an overlay stuffed into the preview itself. That forced the extension host to become the message hub between editor selection, preview runtime, and panel UI.
2. **`ShaderToyManager` gradually became the state authority** for inspect. The initial version only forwarded selection and control messages; by the end of the branch it checkpointed variable, line, inferred type, mapping mode, compare mode, compare split, hover enablement, histogram enablement, histogram interval, and histogram sample stride, while replaying that bundle after preview rebuilds or panel recreation.
3. **The preview-side engine evolved from naive, directly-coupled readback to a disciplined post-render pipeline.** Hover readback moved to `afterFrame()`, histogram generation moved from repeated point samples to one framebuffer snapshot plus deferred CPU binning, timer-driven refresh was normalized into explicit 1Hz / 5Hz / 10Hz presets, later stages trimmed histogram overhead, downsampled raw capture, split observed-domain measurement from crop interpretation, tightened inspectability to numeric scalar/vector families with type-aware UI semantics, and finally replaced backlog-prone histogram queuing with explicit stall reporting.
4. **Compare mode stopped being a whole-frame alternate rewrite and became a verification surface.** Stage5M moves compare into a final-pass split renderer with a persisted split slider, so the original shader output and the inspected visualization can be read side by side on the same frozen or live frame. Stage5P then hardens that interaction so compare and hover redraws do not silently advance paused simulations.
5. **Inspect portability was made explicit instead of implicit.** Stage5N teaches the HTML assembly path to omit inspector runtime, routing, and readback hooks from standalone exports while preserving the full inspect stack in the VS Code workbench preview.

The final result at `58fca24` is a coherent inspect architecture with a clean split of responsibilities:

- **Extension host:** selection capture, selection normalization, persisted inspect state, IPC fan-out/fan-in.
- **Preview document assembly:** inject inspect runtime and hooks only for the VS Code preview path, while omitting them from standalone exports.
- **Preview runtime (`shader_inspect.js`):** type inference, shader rewriting, in-place material mutation, final-pass compare interception, post-render readback, raw-range histogram capture, observed-domain histogram analysis, downsampled/stride-aware evaluation, paused frozen-frame redraws, and stall-aware histogram emission.
- **Inspect panel:** control surface and telemetry surface, with explicit `panelReady`/`syncState` rehydration, compare split controls, crop overlays, histogram guidance overlays, component-aware pixel/histogram semantics, and visible stall reporting.

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
| 15 | 2026-03-06 | `6edfee4` | `chore: INSPECT implementation full scope report` | Added the full-scope inspect progression report and indexed it in `.github/README.md`; no inspect runtime change. |
| 16 | 2026-03-06 | `704fe4c` | `stage5G: align histogram capture with raw inspector range` | Switched histogram capture from mapped screen output to a dedicated raw float inspector pass aligned with the active mapping range. |
| 17 | 2026-03-06 | `356fffd` | `stage5H: adopt cropped-domain histogram overlays` | Shifted histogram display to the observed raw domain and added panel-side crop guides / mapping overlays so the active mapping range can be read against that domain. |
| 18 | 2026-03-06 | `d143f20` | `stage5I: add histogram sample-stride controls` | Added live sample-stride controls, wired them through panel → host → preview state replay, and made histogram density an explicit user-controlled trade-off. |
| 19 | 2026-03-06 | `0b8367f` | `stage5J: tighten histogram processing overhead` | Removed per-update smoothing/copy overhead, hoisted repeated domain work out of the inner loop, and changed timing to reflect active histogram work rather than idle delay. |
| 20 | 2026-03-06 | `683a025` | `stage5K: downsample histogram capture and defaults` | Downsampled raw histogram capture to match the sample-scale presets, and moved the defaults to 5Hz / 1:8 for a cheaper always-on profile. |
| 21 | 2026-03-06 | `5f6040e` | `stage5L: tighten inspect type families and UI semantics` | Narrowed inspectability to numeric scalar/vector families, normalized swizzle picks, introduced a host-side selection gate, and made panel/histogram semantics match the inspected component count. |
| 22 | 2026-03-07 | `4561f42` | `stage5M: add compare split view` | Replaced full-frame compare rewriting with a persisted side-by-side split view that scissor-renders original output against inspected output on the final pass. |
| 23 | 2026-03-07 | `dc7e4b0` | `stage5N: drop inspector from portable preview` | Made inspect explicitly VS Code-scoped by omitting inspector runtime, routing, and hooks from standalone exported HTML while keeping the workbench preview unchanged. |
| 24 | 2026-03-07 | `98fc03e` | `stage5O: tighten inspect panel controls` | Compressed the inspect panel layout so compare split and range-related controls sit with their logical peers instead of on fragmented rows. |
| 25 | 2026-03-07 | `b2d2350` | `stage5P: freeze paused inspect redraws` | Routed inspect-driven redraws through a frozen final-pass path so hover and compare updates respect paused simulation state. |
| 26 | 2026-03-07 | `58fca24` | `stage5R: finish stalled histogram evaluations` | Replaced queued histogram overlap handling with drop-and-report stall semantics, letting active evaluations finish while surfacing overload in the panel. |

---

## 3. Architecture snapshot of the final result

### 3.1 Final topology

```text
VS Code editor selection
        │
        ▼
ShaderToyManager (extension host state hub)
        ├──────────────► Inspect selection gate
        │                  • normalize editor picks
        │                  • reject unsupported targets
        │                  • infer supported families
        ├──────────────► InspectPanel webview
        │                  • variable metadata
        │                  • mapping / compare / compare-split controls
        │                  • hover toggle
        │                  • histogram toggle
        │                  • histogram interval presets
        │                  • histogram sample-stride controls
        │                  • crop / mapping overlays
        │                  • component-aware value display
        │                  • stall indication
        │
        └──────────────► Preview webview
                           • shader_inspect.js (VS Code preview only)
                           • shader rewrite + recompile
                           • final-pass compare split render
                           • hover pixel readback
                           • histogram capture
                           • raw float histogram pass
                           • observed-domain analysis
                           • downsampled capture defaults
                           • paused frozen-frame redraws
                           • type-aware histogram payloads
                           • stalled-histogram reporting
                           • status / telemetry emission
```

The core design choice is that the preview webview and the inspect panel **never talk directly**. All traffic is mediated by `ShaderToyManager`, which owns the persisted state and decides what gets replayed after a rebuild.

### 3.2 Final layer breakdown

| Layer | Responsibility at `HEAD` | Key files |
|---|---|---|
| Command surface | Expose inspect as a VS Code command | `package.json`, `src/extension.ts` |
| Preview document assembly | Assemble preview HTML from placeholders and inject inspect-specific runtime/hooks only where the preview mode requires them | `src/webviewcontentprovider.ts`, `resources/webview_base.html` |
| Portable preview gating | Omit inspector message routing, final-pass interception, `afterFrame()` readback, and `shader_inspect.js` from standalone exports | `src/webviewcontentprovider.ts`, `resources/webview_base.html`, `test/webview_split.test.ts` |
| State authority / hub | Cache inspect settings, listen to selection changes, relay messages, replay state after rebuilds | `src/shadertoymanager.ts` |
| Selection gate | Normalize editor selections into supported inspect targets before they reach the preview runtime | `src/inspectselection.ts`, `src/shadertoymanager.ts` |
| Panel IPC facade | Create and own the separate inspector panel, translate webview messages to callbacks, push state into the panel | `src/inspectpanel.ts` |
| Panel UI | Render control surface and telemetry surface; emit `panelReady`, mapping, compare, compare-split, hover, histogram, interval, and sample-stride messages; draw crop overlays and mapping guides over histogram data; adapt value/histogram display to the inspected component count; surface histogram stalls visibly | `resources/inspect_panel.html` |
| Preview engine | Infer types, rewrite shader source, mutate final material in place, intercept the final pass for compare split rendering, read pixels after render, capture raw histogram values through a float pass when available, scan/bin the observed raw domain asynchronously, downsample capture according to defaults/presets, preserve paused frames during inspect-only redraws, and emit type-aware stall-aware histogram telemetry | `resources/webview/shader_inspect.js` |
| Regression harness | Assert runtime, selection, and preview-assembly contracts outside VS Code UI | `test/inspect_runtime.test.ts`, `test/inspectselection.test.ts`, `test/webview_split.test.ts` |

### 3.3 Final persisted state in `ShaderToyManager`

By the end of the branch, the manager caches the full user-visible inspect configuration:

- `_lastInspectorVariable`
- `_lastInspectorLine`
- `_lastInspectorType`
- `_lastInspectorMapping`
- `_lastCompareEnabled`
- `_lastCompareSplit`
- `_lastHoverEnabled`
- `_lastHistogramEnabled`
- `_lastHistogramIntervalMs`
- `_lastHistogramSampleStride`

That list is the best concise description of what “inspect state” means at the end of the branch. The earlier commits each add pieces of that surface.

### 3.4 Final message surface

#### Panel → Host

| Message | Purpose |
|---|---|
| `setMapping` | Change inspect color mapping (`linear` / `sigmoid` / `log`, min/max, out-of-range highlighting) |
| `setCompare` | Toggle compare split-view presentation |
| `setCompareSplit` | Update the persisted compare split position from the panel slider |
| `setHoverEnabled` | Enable/disable hover pixel readback |
| `setHistogramEnabled` | Enable/disable histogram capture |
| `setHistogramInterval` | Request one of the normalized refresh presets |
| `setHistogramSampleStride` | Request one of the normalized histogram sample-density presets |
| `panelReady` | Signal that the panel webview is loaded and can receive replayed state |
| `navigateToLine` | Ask host to reveal a file/line |

#### Host → Panel

| Message | Purpose |
|---|---|
| `syncState` | Replay mapping / compare / compare-split / hover / histogram / interval / sample-stride state |
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
| `setInspectorCompare` | Toggle compare split-view rendering |
| `setInspectorCompareSplit` | Update the split position used by final-pass compare rendering |
| `setInspectorHover` | Toggle hover readback |
| `setInspectorHistogram` | Toggle histogram capture |
| `setInspectorHistogramInterval` | Update refresh cadence |
| `setInspectorHistogramSampleStride` | Update histogram sample density |

#### Preview → Host

| Message | Purpose |
|---|---|
| `inspectorStatus` | Report success/error state and inferred variable/type |
| `inspectorPixel` | Report hover pixel readback |
| `inspectorHistogram` | Report type-aware histogram bins, observed domain, component count, evaluation timing, and whether overlapping refreshes stalled the stream |

### 3.5 Final preview-side execution path

1. User selects a word or expression in the editor.
2. `ShaderToyManager.startSelectionListener()` captures the text and 1-based line, normalizes it through `resolveInspectableSelection(...)`, caches the normalized variable/type, and forwards only supported inspect targets to both preview and panel.
3. In the preview, `shader_inspect.js`:
    - finds the active shader source via `getShaderSource()`,
    - translates the editor line with `getPreambleOffset()` if a preamble exists,
    - revalidates the selection against its own supported-type gate,
    - infers or confirms the inspectable type,
    - normalizes vector component picks to their owning vector when needed,
    - rewrites the final fragment shader via the inspect builder using the resolved vec4 visualization expression,
    - runs the rewritten text through `prepareFragmentShader()` when available,
    - mutates the **existing** final material in place,
    - synchronizes a clone of the original final material for compare rendering,
    - marks it dirty and requests one frame.
4. During the final render loop, `resources/webview_base.html` first gives `window.ShaderToy.inspector.renderBuffer(...)` a chance to intercept the presentation pass. When compare mode is active on the final buffer, the preview:
    - renders the **original** output on the left side of the split,
    - renders the inspected/mapped output on the right side,
    - uses scissor + viewport bounds derived from `_compareSplit`,
    - updates the compare divider/labels overlay against the live canvas bounds.
5. `resources/webview_base.html` then calls `window.ShaderToy.inspector.afterFrame()` after the final render pass, when GL state is valid.
6. `afterFrame()` performs:
   - single-pixel hover readback when enabled,
   - full-frame histogram snapshot when the dirty flag is set.
7. Histogram generation is finalized as:
    - raw float capture through a dedicated histogram material + `THREE.WebGLRenderTarget` when float framebuffers are available,
    - fallback screen-space `gl.readPixels(0, 0, w, h, ...)` when raw capture is unavailable,
    - reusable byte/float buffers with only one active CPU histogram pass at a time,
    - generation/cancel logic so stale async work is discarded cleanly when inspect state truly changes,
    - overlap handling that drops newer snapshot requests while active processing is still running and records that stall instead of building a backlog,
    - active-processing timing that excludes idle scheduling gaps,
    - downsampled raw capture resolution tied to the sample-scale presets on the float path,
    - deferred CPU histogram work during idle time over the sampled framebuffer domain in chunks,
    - a two-phase scan/bin pass so the observed raw domain is measured first and only then binned,
    - optional sample-stride presets (`1`, `8`, `64`) that thin both the scan and the bin pass,
    - 128 bins per channel,
    - no per-update smoothing/copy pass before histogram emission,
    - component-aware domain scanning/binning so scalar, vec2, vec3, and vec4 targets only report the channels they actually contain,
    - `timeMs`, observed-domain range, and `stalled` telemetry so the panel can show evaluation cost, render crop overlays against that domain, and surface overload explicitly.
8. When the preview is paused and inspect still requests a redraw (hover movement, compare split adjustments, or an immediate histogram refresh), the request is routed through `freezeSimulationOnNextForcedRender`; the render loop skips time/date advancement, fly controls, audio, keyboard/mouse updates, ping-pong swaps, and frame advancement, then redraws only the final presentation pass.
9. The panel redraws from host-fed telemetry, restores its own UI state via `syncState` when recreated, keeps compare split / cadence / stride controls in sync, overlays crop guides / mapping curves against the observed histogram domain, renders only the value channels relevant to the inspected type, and shows a red `STALL` marker when histogram updates are dropped under load.

### 3.6 Final test anchor

`test/inspect_runtime.test.ts`, `test/inspectselection.test.ts`, and `test/webview_split.test.ts` do **not** try to validate the full UI. Instead they protect the runtime, selection, and assembly contracts that matter most:

- compare mode intercepts the final render pass and scissor-renders original vs. inspected halves according to the persisted split position,
- inspector rewrites the original material **in place**,
- inspector restoration returns the original fragment shader,
- histogram enablement toggles correctly,
- histogram refresh interval defaults to `200` ms and can switch to `1000` and `100` ms,
- histogram evaluation reports the observed raw domain for panel-side cropping,
- histogram sample stride defaults to `8` and switches across bounded presets,
- histogram sample stride reduces the analyzed sample count and the raw capture size when enabled,
- paused hover and compare-split updates request frozen final-pass redraws without advancing paused simulation state,
- overlapping histogram refreshes are dropped rather than queued and the completed payload reports `stalled = true`,
- invalid selections are ignored without clobbering the last valid inspection,
- integer selections are accepted, unsupported bool selections are rejected, and vector component picks normalize to the owning vector,
- standalone HTML omits inspector runtime, message routing, final-pass interception, and `afterFrame()` hooks entirely,
- extension-side selection-gate tests cover declared numerics, defines, swizzles, and invalid/unsupported targets.

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

This is the point where the branch’s control surface becomes configuration-complete. The next four commits keep that state model intact while first deepening the async histogram pipeline, then changing the histogram capture domain, then separating observed-domain measurement from crop presentation, and finally exposing histogram density as another persisted control.

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

That means the histogram subsystem is now configurable, full-frame-aware, and explicit about runtime cost—but it is still capturing mapped output rather than the raw inspector-value domain. The next runtime commit changes exactly that.

---

### 4.15 `6edfee4` — `chore: INSPECT implementation full scope report`

**Touched files**

- `.github/README.md`
- `.github/docs/architecture/inspect-report.md`

**What changed**

This was a documentation-only chore commit that added the first full-scope, commit-by-commit inspect progression report and indexed it from `.github/README.md`.

In practical terms, the branch gained:

- a dedicated architecture report for the inspect implementation progression,
- a stable entry in the helper-doc index so future work can discover that report easily.

**Why it mattered**

Like the earlier doc/reference chores, this did not change inspect runtime behavior. It did, however, strengthen the branch’s self-documentation story. At this point the inspect work is no longer only embodied in code and scattered commit messages; it is also captured in a deliberate narrative artifact that future engineers can reread.

**Effect on the implementation arc**

Runtime-wise, none. Process-wise, it is another sign that this branch is being treated as a referenceable transplant effort rather than a throwaway spike. It also means that stage5G lands immediately after the branch gains a much richer written explanation of its own prior evolution.

---

### 4.16 `704fe4c` — `stage5G: align histogram capture with raw inspector range`

**Touched files**

- `resources/webview/shader_inspect.js`
- `test/inspect_runtime.test.ts`

**What changed**

This commit changes **what data the histogram is built from**.

Up through stage5F, histogram evaluation had become asynchronous and full-frame, but it still binned values from the mapped screen-output path unless a fallback path intervened. Stage5G introduces a dedicated raw-capture pipeline so the histogram can describe the inspected value domain itself.

#### New raw histogram capture path

`resources/webview/shader_inspect.js` gained several new capabilities:

- float-mode buffers:
  - `_histogramFloatBuf`
  - `_histogramQueuedFloatBuf`
- queue metadata that now tracks value domain and display range:
  - `_histogramQueuedValueMode`
  - `_histogramQueuedDisplayMin`
  - `_histogramQueuedDisplayMax`
- dedicated histogram-render resources:
  - `_histogramMaterial`
  - `_histogramTarget`
  - `_lastHistogramSource`

New helpers were added to support that path:

- `canUseRawHistogram()`
- `ensureHistogramByteBuffer(...)`
- `ensureHistogramFloatBuffer(...)`
- `disposeHistogramResources()`
- `syncHistogramMaterial(...)`
- `ensureHistogramTarget(...)`

Taken together, those additions give the histogram path its own render-time substrate instead of forcing it to observe whatever the visible mapped preview happened to emit.

#### Dedicated float pass aligned with mapping range

The core behavioral changes are:

- `updateInspection()` now prepares a second shader source for histogram work and keeps a dedicated histogram material synchronized with the current inspected source.
- `snapshotForHistogram()` now prefers a raw path:
  1. ensure a float render target,
  2. render the histogram material into that target,
  3. read back float pixels via `renderer.readRenderTargetPixels(...)`,
  4. bin them asynchronously.
- if raw capture is unavailable, the previous byte-based fallback remains in place via `gl.readPixels(...)` from the visible framebuffer.

The binning path itself also changes semantics:

- `startHistogramProcessing(...)` now accepts `valueMode`, `displayMin`, and `displayMax`,
- float-mode binning maps values into bins against the **current inspector mapping range** rather than against `0..255` byte space,
- `postHistogram(...)` now emits the display range explicitly instead of deriving min/max from byte extrema.

That last point is important: the histogram panel is no longer implicitly reporting “what byte range happened to be observed.” It is now reporting against the active inspector range, which is what the feature actually asks the user to reason about.

#### Resource lifecycle hardening

Because stage5G introduces dedicated histogram render resources, it also adds cleanup:

- `restoreOriginal()` now disposes histogram resources,
- `onHotReload()` also disposes them before re-inspection.

That keeps the new float-pass path aligned with the same hot-reload/resource-lifecycle discipline that stage5C applied to the main inspector material.

#### Test expansion

`test/inspect_runtime.test.ts` was extended to exercise the raw path directly:

- the harness now provides:
  - a stub `renderer`,
  - float-framebuffer support,
  - `THREE.WebGLRenderTarget`,
  - `THREE.ShaderMaterial`,
  - counters for render-target readback calls.
- the histogram test now asserts:
  - raw render-target capture is used,
  - the screen `gl.readPixels(...)` fallback is **not** used in the supported case,
  - all pixels are analyzed,
  - the histogram reports the configured display range (`-1` to `1` in the test),
  - timing telemetry is still emitted.

This is a much stronger correctness test than the earlier histogram assertion because it validates the intended **capture domain**, not just that some histogram payload appears.

**Why it mattered**

Stage5F solved “how do we process a whole frame asynchronously?” Stage5G solves a different question: **what exactly should the histogram be a histogram of?**

For an inspect tool, the most useful answer is not “whatever mapped screen bytes the preview produced,” but “the raw inspected values interpreted against the current mapping range.” Without this commit, the histogram could be efficient and responsive while still being semantically downstream of the visible mapped output.

Stage5G fixes that by giving histogram capture its own dedicated raw path while preserving the fallback path for environments that cannot support float render-target readback.

**Effect on the implementation arc**

Stage5G is the first major endpoint of histogram maturation:

- stage5A introduced the feature,
- stage5B fixed the cost model,
- stage5D exposed enablement,
- stage5E exposed cadence,
- stage5F made evaluation asynchronous and full-frame,
- stage5G aligned the capture domain with the actual inspector range.

That is the point where histogram stops being merely “a graph of the inspected image” and becomes much closer to “a graph of the inspected values themselves.” But it still conflates two concepts: the **observed raw domain** and the **user’s chosen mapping crop**. The next commit separates those concerns.

---

### 4.17 `356fffd` — `stage5H: adopt cropped-domain histogram overlays`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `test/inspect_runtime.test.ts`

**What changed**

This commit changes both the **meaning** of histogram metadata and the way the panel visualizes it.

#### Panel-side overlay model

`resources/inspect_panel.html` gained a substantial new overlay vocabulary:

- `lastHistogram` caching so the panel can redraw the current histogram when mapping controls change,
- `normalizeCropRange()`,
- `mapValueToX(...)`,
- `clamp(...)`,
- `createOverlayPattern(...)`,
- `drawCropOverlays(...)`,
- `evaluateCurve(...)`,
- `drawMappingCurves(...)`.

Those helpers let the panel do something it could not do before: distinguish between:

- the **observed histogram domain** reported by the preview runtime, and
- the **currently selected mapping crop** entered by the user.

The visual effect is important:

- histogram bars are now drawn over the observed domain,
- crop-excluded regions are shaded with patterned overlays,
- crop boundaries are marked with guide lines,
- the active mapping curve is drawn over the histogram.

This means the panel stops being just a passive chart and becomes an explanatory visualization of how the current mapping parameters relate to the actual inspected value distribution.

#### Preview/runtime semantic shift

The runtime change is subtler but more fundamental.

Before stage5H, `startHistogramProcessing(...)` effectively binned values directly against a preselected display range. After this commit, it moves to a **two-phase scan/bin model**:

1. **scan phase** — walk the sampled pixels and discover `domainMinRaw` / `domainMaxRaw`,
2. **bin phase** — use that observed domain as the stable domain for histogram binning.

Related changes:

- `postHistogram(...)` now reports `domainMin` / `domainMax` rather than the prior display-oriented range semantics,
- byte mode is normalized through `toDisplayValue(...)`,
- collapsed-domain handling is preserved, but now happens relative to the observed domain.

This is a major conceptual refinement: the preview runtime becomes responsible for measuring the distribution honestly, while the panel becomes responsible for showing how the current mapping window sits inside that distribution.

#### Test correction

The runtime test formerly asserting a mapping-clamped max value was updated:

- the histogram test now expects `autoMax` to be `1.5` rather than `1`,
- the test name shifts to “reports the observed raw domain for panel-side cropping.”

That test rename is telling. It captures the exact semantic change of the commit.

**Why it mattered**

Stage5G fixed the histogram capture source, but it still left the histogram chart semantically overloaded: the observed data domain and the user’s mapping crop were still entangled. That makes the chart less explanatory than it could be, because it is hard to tell whether the histogram is showing:

- the actual distribution of inspected values, or
- the range selected by the mapping controls.

Stage5H separates those responsibilities cleanly:

- the runtime reports the observed raw domain,
- the panel overlays the user’s crop and mapping curve on top of that domain.

That is a strong architectural choice because it puts measurement in the runtime and interpretation in the UI.

**Effect on the implementation arc**

Stage5H is the commit where histogram stops being just “raw-domain capture” and becomes “raw-domain capture **plus** an explanatory overlay model.” It is the point where the panel starts communicating not just what values exist, but how the current inspector mapping is transforming or excluding those values.

This is also the moment where histogram presentation becomes meaningfully interactive even without new preview recompilation work: changing mapping values can redraw the interpretation layer immediately from cached histogram data.

---

### 4.18 `d143f20` — `stage5I: add histogram sample-stride controls`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `resources/webview_base.html`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`
- `test/inspect_runtime.test.ts`

**What changed**

This commit turns histogram sampling density into a first-class, persisted inspect control.

#### Panel/UI control surface

`resources/inspect_panel.html` adds a new control cluster inside the histogram canvas area:

- `1:1`
- `1:8`
- `1:64`

These are not refresh-rate controls; they are **sample-stride controls**. The panel also adds:

- `DEFAULT_HISTOGRAM_SAMPLE_STRIDE = 1`,
- `currentHistogramSampleStride`,
- `normalizeHistogramSampleStride(...)`,
- `setHistogramSampleStrideUi(...)`,
- message emission via `setHistogramSampleStride`.

`applyInspectorState(...)` now restores sample stride alongside interval, hover, compare, and histogram enablement, which means this is immediately treated as durable inspector configuration, not as an ad hoc local tweak.

#### Host-state extension

For the first time since stage5E, the host-side inspect state grows again.

`src/inspectpanel.ts` adds:

- `onHistogramSampleStrideChanged`,
- `setOnHistogramSampleStrideChanged(...)`,
- `histogramSampleStride` in `postInspectorState(...)`.

`src/shadertoymanager.ts` adds:

- `DEFAULT_HISTOGRAM_SAMPLE_STRIDE = 1`,
- `_lastHistogramSampleStride`,
- panel callback wiring for `setInspectorHistogramSampleStride`,
- replay of sample stride to both the panel and the preview runtime.

`resources/webview_base.html` forwards the new message to `window.ShaderToy.inspector.handleMessage(...)`.

This is a classic continuation of the manager-as-authority pattern: once the sample stride becomes user-visible, it is immediately promoted into replayable host state.

#### Preview/runtime sampling behavior

`resources/webview/shader_inspect.js` adds:

- `_histogramSampleStride = 1`,
- `normalizeHistogramSampleStride(...)`,
- `getHistogramSampleStride()` for tests,
- message handling for `setInspectorHistogramSampleStride`,
- `requestHistogramUpdateNow()` to cancel in-flight histogram work and force an immediate refresh.

The important algorithmic shift is in `startHistogramProcessing(...)`:

- the processing loop moves from pure `offset += 4` iteration to `pixelIndex += sampleStride`,
- both the **scan phase** and **bin phase** now honor the current sample stride.

That means sample stride is not just a display-time decimation knob; it changes the measurement workload itself. When the stride increases, the runtime both:

- looks at fewer pixels to estimate the observed domain,
- and bins fewer pixels into the histogram.

#### Test expansion

The runtime tests now explicitly cover this new state/control surface:

- default sample stride is `1`,
- setting it to `64` works,
- invalid values normalize back to `1`,
- a stride of `8` reduces the analyzed sample count in the emitted histogram.

This is an important testing step because it proves not just that the control exists, but that it materially changes the runtime behavior it claims to control.

**Why it mattered**

By stage5H, the histogram was semantically much stronger, but the cost/fidelity trade-off was still mostly implicit:

- refresh cadence was configurable,
- histogram enablement was configurable,
- capture domain and overlay semantics were improved,
- but sampling density was still effectively fixed.

Stage5I introduces a user-facing performance dial that is conceptually different from cadence:

- cadence answers **how often** the histogram refreshes,
- sample stride answers **how densely** each refresh samples the frame.

That distinction matters because it gives users another way to tune responsiveness versus fidelity without disabling the feature or slowing it to a crawl.

**Effect on the implementation arc**

Stage5I closes the first pass of the histogram-control surface:

- stage5A introduced the feature,
- stage5B fixed the basic cost model,
- stage5D exposed enablement,
- stage5E exposed cadence,
- stage5F made processing asynchronous and full-frame-aware,
- stage5G corrected the capture source,
- stage5H separated observed-domain measurement from crop presentation,
- stage5I exposed sample density as a first-class, replay-safe knob.

At this point the histogram subsystem is not just configurable; it is configurable along the three axes that actually matter for an inspect tool:

- **what values are being measured**,
- **how those values are presented relative to the mapping crop**,
- **how much work each refresh is allowed to do**.

---

### 4.19 `0b8367f` — `stage5J: tighten histogram processing overhead`

**Touched files**

- `resources/webview/shader_inspect.js`
- `test/inspect_runtime.test.ts`

**What changed**

This commit does not add a new user-facing control. Instead, it tightens the internal cost model of the histogram pipeline that stage5F through stage5I had already assembled.

#### Payload emission becomes cheaper

`resources/webview/shader_inspect.js` removes `smoothHistogram(...)` entirely. The preview runtime no longer:

- allocates a second array per channel for a 3-point smoothing pass,
- copies the smoothed arrays with `Array.from(...)` before posting.

`postHistogram(...)` now emits the working `Float32Array` channel buffers directly.

That is a meaningful shift in emphasis. The branch stops treating the histogram payload as something that needs post-processing polish on every refresh and starts treating it as telemetry that should be emitted with as little extra work as possible.

#### Timing is redefined as active work, not elapsed wait

`startHistogramProcessing(...)` is refactored so the timing model separates:

- **capture time** (`captureTimeMs`) measured during `snapshotForHistogram()`,
- **active CPU processing time** (`activeProcessingMs`) measured per scheduled histogram work slice.

The old `startedAtMs` wall-clock scheme becomes `initialTimeMs + activeProcessingMs`.

That matters because the histogram pass is explicitly asynchronous. Under the older accounting, `timeMs` included idle delay between scheduled chunks, which is not a good representation of how expensive the histogram actually is. After stage5J, the metric means “how much real work was done for this update,” not “how much clock time passed before the last callback finished.”

#### Repeated domain setup leaves the inner loop

The commit also removes repeated `getStableDomain(...)` recomputation from the binning hot path.

Before:

- the scan phase measured raw min/max,
- the bin phase repeatedly rebuilt stable-domain state inside the per-pixel loop.

After:

- the scan phase still measures raw min/max,
- stable-domain setup is computed once when scan finishes,
- the bin phase reuses that precomputed domain.

This is a small structural change, but it is exactly the kind of small structural change that matters in a loop intended to touch large framebuffers repeatedly.

#### Test expectations are updated to match the new telemetry meaning

`test/inspect_runtime.test.ts` updates the histogram timing assertion:

- the test name becomes “reports the observed raw domain with active histogram timing,”
- `timeMs` changes from `1.25` to `3.75`.

The point is not the literal number. The point is that the test now encodes the new meaning of timing telemetry: capture cost plus active processing cost.

**Why it mattered**

By stage5I, the histogram was already feature-rich:

- it captured raw values,
- reported the observed domain,
- overlaid crop interpretation in the panel,
- exposed cadence and sample-density controls.

But that sophistication brought a risk: the telemetry pipeline itself could become noisier and heavier than necessary. Stage5J is a maintenance/hardening commit for that risk. It removes decorative per-update work, tightens inner-loop behavior, and makes performance reporting more honest.

**Effect on the implementation arc**

Stage5J is the first post-control-surface cleanup commit. It does not expand inspect’s capabilities; it sharpens the machinery underneath the capabilities already added. That makes it an important bridge between “we exposed the knobs” and “we made the chosen defaults and runtime cost model sensible enough to leave on.”

---

### 4.20 `683a025` — `stage5K: downsample histogram capture and defaults`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `src/shadertoymanager.ts`
- `test/inspect_runtime.test.ts`

**What changed**

This commit moves the histogram cost discussion from “how many pixels do we analyze after capture?” to “how much do we capture in the first place?” It also changes the default posture of the feature from maximum fidelity to a more balanced live-debugging profile.

#### Defaults shift to 5Hz and 1:8

The default histogram settings are changed consistently across the stack:

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `src/shadertoymanager.ts`

Specifically:

- `DEFAULT_HISTOGRAM_INTERVAL_MS` changes from `1000` to `200`,
- `DEFAULT_HISTOGRAM_SAMPLE_STRIDE` changes from `1` to `8`.

The panel’s active buttons are updated accordingly:

- `5Hz` becomes the default rate,
- `1:8` becomes the default sample density.

This is not merely cosmetic. Because the manager owns replayed inspect state, changing the defaults here changes the branch’s declared opinion about what a sane always-on histogram setting is.

#### Raw histogram capture resolution is tied to sample-stride presets

The largest runtime change lands in `resources/webview/shader_inspect.js`.

New helper:

- `getHistogramCaptureDimensions(width, height, sampleStride)`

The raw float histogram path now computes a capture size from the selected sample stride:

- `1:1` keeps full resolution,
- `1:8` and `1:64` scale the capture target by `1 / sqrt(stride)`,
- the downsampled capture then uses `effectiveSampleStride: 1`.

That is the critical architectural move. Prior to stage5K, sample stride mostly meant “capture the same raw frame, then skip work during scan/bin.” After stage5K, the raw float path can reduce work earlier:

- the render target is smaller,
- the readback is smaller,
- the CPU loop then processes every captured pixel because the downsampling already happened upstream.

In other words, the stride preset becomes a pipeline-shaping control, not just a CPU-loop decimation control.

#### Queued histogram work now remembers the capture-time stride semantics

Queued histogram bookkeeping grows slightly:

- `_histogramQueuedSampleStride` is added,
- `drainQueuedHistogram()` forwards that stride into `startHistogramProcessing(...)`,
- `cancelHistogramWork()` resets it.

This matters because once capture resolution can vary, queued work must preserve the exact capture-time semantics rather than re-reading whatever the current global stride happens to be by the time the deferred CPU pass resumes.

#### The fallback path stays faithful to earlier behavior

The mapped byte fallback path still:

- reads the full screen framebuffer,
- applies normalized sample stride during CPU processing.

That is a good compatibility choice. The more ambitious optimization is scoped to the raw float path where the runtime fully controls the render target.

#### Tests are updated to prove the new default/capture behavior

`test/inspect_runtime.test.ts` expands in three telling ways:

- default interval/sample-stride expectations move to `200` ms and `8`,
- the “full raw-domain” test now explicitly sets stride `1` when it wants all pixels,
- the stride-reduction test now also asserts the raw render-target read size shrinks (for the harness, down to `1x1`).

That last assertion is especially important. It proves the optimization is not just fewer loop iterations after readback; the capture itself has been reduced.

**Why it mattered**

Stage5I made sample density user-controllable, but it still paid most of the raw capture cost before thinning the data in CPU space. Stage5K closes that gap. It lets the cheaper presets actually be cheaper in the render/readback stages too.

At the same time, the defaults move toward a more realistic steady-state posture:

- not “capture every pixel once per second,”
- but “refresh at a moderate cadence from a moderately downsampled capture.”

That is the first commit that makes the histogram defaults feel tuned for continuous use rather than for laboratory-grade fidelity.

**Effect on the implementation arc**

Stage5K turns sample stride into a first-class pipeline characteristic. After this point, histogram cost is shaped at three levels:

- enable/disable,
- cadence,
- capture density.

That is a substantially more mature design than the stage5A/stage5B model.

---

### 4.21 `5f6040e` — `stage5L: tighten inspect type families and UI semantics`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `src/inspectselection.ts` *(new)*
- `src/shadertoymanager.ts`
- `test/inspect_runtime.test.ts`
- `test/inspectselection.test.ts` *(new)*

**What changed**

This is the semantic hardening commit of the late branch. Earlier stages focused on persistence, lifecycle, capture fidelity, and histogram cost. Stage5L tightens the meaning of an inspect target itself and then makes the UI honor that meaning consistently.

#### Inspectability is narrowed to explicit numeric scalar/vector families

`resources/webview/shader_inspect.js` changes the supported-type contract:

- `TYPE_REGEX_STR` drops `bool` and matrix types,
- new helpers appear: `isSupportedInspectableType(...)`, `isVectorType(...)`, `getInspectableComponentCount(...)`,
- `inferLiteralType(...)` and `resolveVariableType(...)` stop defaulting unknowns to `float` and can now return `null`,
- `SIMPLE_VARIABLE_RE` restricts what counts as a valid direct inspect target.

This is a major philosophical shift. Earlier revisions leaned toward optimistic inference: if something vaguely looked inspectable, the runtime often tried to push it through as a float-shaped target. Stage5L says the opposite:

- supported targets are a defined contract,
- unsupported targets are not coerced into that contract,
- unknowns are rejected rather than guessed.

That reduces surprising behavior and removes a whole class of fake-success states.

#### Vector swizzle picks are normalized to the owning vector

Stage5L also tightens how swizzles behave.

The runtime-side resolver and the new host-side selection helper both normalize selections like:

- `uv.x`
- `color.r`

to the owning vector when the base symbol is itself an inspectable vector.

That means a click on a component is interpreted as “inspect this vector family” rather than “silently collapse the inspect target to a scalar and let the panel still pretend in RGBA terms.”

This is a subtle but strong semantics decision. It aligns selection behavior with how the feature wants to visualize data: vectors stay vectors.

#### Invalid/unsupported selections become no-ops

The preview runtime now uses a stricter resolution path before rewriting:

- `tryResolveInspectableVariable(...)` validates the target,
- unsupported or malformed selections simply do nothing,
- the last valid inspected shader remains in place.

This is echoed in the tests:

- invalid keywords such as `for` are ignored,
- unsupported `bool` targets are ignored,
- no extra error/status spam is emitted for those no-op cases.

That is a good operational choice for editor-driven interaction. Cursor movement and selection changes are noisy; turning every unsupported pick into a visible error state would make the feature feel fragile. Stage5L instead treats unsupported selections as ineligible inspect intents.

#### A host-side selection gate is introduced

The most important new file is `src/inspectselection.ts`.

It adds:

- `resolveInspectableSelection(...)`
- `isInspectableSelection(...)`

This helper resolves selections against source text plus target line and handles:

- built-ins,
- uniforms,
- defines,
- in-source declarations,
- swizzle normalization,
- rejection of keywords, expressions, unknown symbols, bools, and matrices.

`src/shadertoymanager.ts` now calls this helper in the editor selection listener before forwarding the selection to preview/panel. The manager also starts posting the normalized variable/type pair rather than the raw selected text.

Architecturally, this is a big deal. Before stage5L, selection capture lived mostly as lightweight plumbing in `ShaderToyManager`. After stage5L, editor selection becomes its own distinct architectural seam with explicit semantics and its own test surface.

#### Panel value display and histogram rendering become component-aware

`resources/inspect_panel.html` stops assuming that every inspected value should always be presented as RGBA.

New helpers:

- `getTypeInfo(...)`
- `formatPixelValues(...)`
- `resetPixelValueLabels()`

Consequences:

- scalar values render as a single “Value” row,
- `vec2`/`ivec2`/`uvec2` render as `X` / `Y`,
- `vec3` families render as `X` / `Y` / `Z`,
- `vec4` families render as `X` / `Y` / `Z` / `W`.

The histogram canvas follows the same rule:

- scalar histograms are drawn as a single neutral channel,
- two-component values show only two channels,
- three-component values show three,
- four-component values add a fourth `binsA` channel.

This is the UI half of the semantic cleanup. Once inspectability is narrowed, the panel stops implying extra channels that are not part of the selected type.

#### Histogram payloads become type-aware too

The runtime-side histogram emission changes with the UI:

- `_inspectorType` is tracked,
- `postHistogram(...)` now includes `componentCount`,
- `binsA` is emitted when needed,
- scan/bin logic only considers the actual inspected component count.

This explains an important test change in `test/inspect_runtime.test.ts`:

- a scalar histogram for `x` now expects `componentCount = 1`,
- `autoMax` drops from `1.5` to `1`.

That is not a regression. It is the direct consequence of no longer letting unrelated channels influence the histogram domain for a scalar target.

#### Test coverage expands in both runtime and selection layers

Stage5L adds a second inspect-focused test file, `test/inspectselection.test.ts`, which covers:

- accepted numeric selections,
- define/uniform usage,
- swizzle normalization,
- rejection of keywords, expressions, unknowns, bools, and matrices.

`test/inspect_runtime.test.ts` also adds or updates coverage for:

- integer targets,
- unsupported bool targets,
- invalid selections staying as no-ops,
- vector-component selections normalizing to the owning vector,
- component-aware histogram payload semantics.

This is one of the strongest signs that the branch now sees inspect selection semantics as part of the core contract, not as incidental UI behavior.

**Why it mattered**

Up through stage5K, inspect had become operationally strong, but its target semantics were still relatively permissive and its panel still carried a lingering “everything is RGBA-shaped” assumption. That left room for mismatch between:

- what the user selected,
- what the runtime could actually reason about,
- what the panel claimed to be showing.

Stage5L removes that mismatch by making the contract explicit:

- only supported numeric scalar/vector families are inspectable,
- vector component clicks normalize to vector inspection,
- unsupported picks are quiet no-ops,
- panel and histogram telemetry reflect the real component count.

**Effect on the implementation arc**

Stage5L is the semantic endpoint of the selection/type-family arc. If stage5C was the lifecycle hardening commit and stage5G was the capture-correctness commit, stage5L is the inspect-contract hardening commit, even though later commits continue to harden compare, pause, and histogram-overload behavior.

It is also the moment where a new architectural seam appears:

- **editor selection resolution** becomes a host-side module (`src/inspectselection.ts`),
- **preview mutation** continues to own shader rewriting,
- **panel presentation** finally matches the selected type family exactly.

That makes the late-branch architecture substantially easier to reason about and safer to extend.

---

### 4.22 `4561f42` — `stage5M: add compare split view`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `resources/webview_base.html`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`
- `test/inspect_runtime.test.ts`

**What changed**

Stage5M completely redefines what “compare mode” means.

Before this commit, compare had been treated as a rewrite-time choice: the runtime could swap into a compare-oriented shader path and then let that path own the whole frame. Stage5M abandons that model. Compare becomes a **presentation-time split view** rendered over the existing inspect result, not a separate semantic flavor of inspection.

That change touches every layer:

- the panel gains a split slider,
- the host persists and replays that slider,
- the preview runtime stops using compare as an alternate rewrite target,
- the final pass itself becomes interceptable so original output and inspected output can be drawn side by side.

This is one of the most important late-branch commits because it changes compare from “another mode flag” into “a verification surface”.

#### Compare stops being a whole-frame semantic switch

The most consequential internal change is in `resources/webview/shader_inspect.js`.

`updateInspection()` no longer chooses between:

- “build an inspect shader”, and
- “build a compare shader”.

Instead it always builds the normal inspected/mapped shader and mutates the final material in place exactly as the post-stage5C architecture expects.

That is a strong design correction. It means compare no longer asks the rewrite pipeline to solve two unrelated problems at once:

1. **what value should be inspected**, and
2. **how should the user compare that value to the original render**.

After stage5M, only the first question belongs to rewriting. The second question belongs to final presentation.

That separation is architecturally cleaner and makes compare much easier to reason about.

#### Split rendering moves to final-pass scissor interception

The actual compare implementation is not a shader trick embedded into the rewritten fragment source. It is a final-pass interception seam.

Stage5M adds `renderBuffer(buffer, bufferIndex, totalBuffers)` to `window.ShaderToy.inspector`. `resources/webview_base.html` now asks the inspector whether it wants to take over the render of the current buffer before doing the normal `quad.material = buffer.Shader; renderer.render(...)` path.

When all of these conditions are true:

- inspect is active,
- compare mode is enabled,
- the buffer is the final presentation buffer,
- the inspector has both the mutated inspect material and a synchronized copy of the original material,

the inspector does a split render:

- it sets the render target for the final buffer,
- enables scissor test,
- renders the **original** material on the left side,
- renders the **inspected/mapped** material on the right side,
- restores viewport/scissor state afterward.

That is exactly the kind of move the branch has been trending toward:

- keep the rewritten inspect material as the canonical inspected output,
- preserve the original material alongside it,
- use a late render-path decision to present both safely.

It also means compare only affects the presentation pass. The shader mutation pipeline, hover readback, and histogram path stay anchored to the inspected result rather than being forced through a special compare rewrite.

#### Compare becomes persisted and replay-safe host state

The panel side gains a proper compare split control surface:

- `Compare split view` checkbox text replaces the older raw-value phrasing,
- a new slider is added with bounds `0.1` to `0.9`,
- the panel shows a live percentage label,
- disabled styling reflects whether compare is currently enabled.

That control is not local-only UI state. Stage5M wires it through the same replay-safe host path used by the other late-branch inspect controls:

- `resources/inspect_panel.html` emits `setCompareSplit`,
- `src/inspectpanel.ts` exposes `setOnCompareSplitChanged(...)`,
- `src/shadertoymanager.ts` persists `_lastCompareSplit`,
- `resendInspectorState()` and panel `syncState` now include `compareSplit`,
- the preview receives `setInspectorCompareSplit`.

Normalization is applied at both ends, bounded to `0.1..0.9`, matching the branch’s general “panel input is not blindly trusted” rule.

This matters because compare is no longer just an on/off presentation preference. It is now a replayed part of the inspect session state.

#### Overlay UI is added, but it is layered on top of the canvas rather than fused into panel telemetry

Stage5M also adds a lightweight DOM overlay inside the preview document:

- a vertical divider,
- an `Original` pill label on the left,
- an `Inspect` pill label on the right,
- positioning that tracks the canvas bounds and current split.

This is a good choice. The compare affordance belongs visually on the preview canvas, not in the separate inspect panel. But it is still kept lightweight:

- created on demand,
- updated on resize/state changes,
- hidden when compare is inactive,
- independent from the host/panel telemetry path.

That preserves the branch’s larger design principle: the inspect panel is for controls and telemetry, while preview-local spatial affordances stay with the preview.

#### Tests prove the render-path contract, not the aesthetics

`test/inspect_runtime.test.ts` expands in a very telling way:

- the harness now records render calls,
- captures scissor state,
- captures viewport rectangles,
- provides a DOM/body stub so the overlay path can exist,
- and exercises `renderBuffer(...)` directly.

The key assertion is not “the UI looks right.” The key assertion is:

- compare intercepts the final pass,
- it renders exactly twice,
- it enables and disables scissor at the right moments,
- it restores full-frame viewport/scissor afterward.

That is a highly architectural test. It protects the contract that actually matters.

**Why it mattered**

Stage5M turns compare into a trustworthy debugging aid.

Before this commit, compare was still conceptually entangled with rewrite semantics. After it, compare becomes a way to verify that the inspected visualization lines up with the original shader output on the same frame, with a controllable split position and without asking the rewrite layer to do extra conceptual work.

This is especially important for a feature like inspect, because user trust depends not just on seeing a value overlay, but on being able to sanity-check that overlay against the original render.

**Effect on the implementation arc**

Stage5M is the commit where compare becomes a first-class part of the mature inspect UX.

It also introduces a new architectural seam that later work relies on implicitly:

- `webview_base.html` can now let inspect intercept the final pass,
- the preview runtime can hold both original and inspected material state at once,
- the host can persist compare geometry, not just compare enablement.

In that sense, stage5M is the “verification-surface” companion to stage5L’s semantic hardening.

---

### 4.23 `dc7e4b0` — `stage5N: drop inspector from portable preview`

**Touched files**

- `package-lock.json`
- `resources/webview_base.html`
- `src/webviewcontentprovider.ts`
- `test/webview_split.test.ts`

**What changed**

Stage5N makes an architectural boundary explicit that had previously been only implicit: **inspect belongs to the VS Code preview, not to portable exported HTML**.

The user-visible behavior is simple:

- the workbench preview still has the full inspect subsystem,
- standalone/portable preview HTML no longer includes inspector runtime, routing, or hooks.

But the important part is how that behavior is achieved. This commit does not sprinkle runtime conditionals all over the preview. It restructures the template assembly path so inspector-specific pieces are replaceable modules.

That is a much better design than “include everything everywhere and hope it is harmless”.

#### Portable preview stops pretending inspect exists everywhere

`resources/webview_base.html` is converted from containing hard-coded inspect snippets into containing explicit placeholders:

- `<!-- Inspector Message Routing -->`
- `<!-- Inspector Final Pass -->`
- `<!-- Inspector After Frame -->`

Those placeholders are not cosmetic. They make inspect-specific preview integration a replaceable assembly concern rather than a baked-in property of all preview HTML.

This is precisely the sort of change that becomes possible because the project already adopted the extension-based webview assembly pattern elsewhere in the codebase.

#### `WebviewContentProvider` becomes mode-aware for inspect integration

`src/webviewcontentprovider.ts` is the real heart of the commit.

It introduces small assembly modules for:

- inspector message routing,
- inspector final-pass interception,
- inspector post-render `afterFrame()` hook,
- and an `omitInspectorContent` empty module for standalone output.

Then it selects between them based on `generateStandalone`.

This is a strong architectural move for two reasons:

1. it keeps the standalone HTML genuinely clean, rather than shipping dead inspector code,
2. it turns “inspect is available here” into a declarative assembly-time choice.

The same pattern is used for `shader_inspect.js` itself:

- non-standalone preview injects it,
- standalone preview replaces the placeholder with nothing.

That makes inspect a feature of the workbench preview product, not of all generated HTML artifacts.

#### The thin-template principle becomes even more explicit

Earlier stages already kept `resources/webview_base.html` intentionally thin, but stage5N sharpens that principle.

The template now clearly advertises the three inspect-specific seams it exposes:

- message routing in,
- final-pass interception during render,
- post-frame readback afterward.

And those seams are not permanently bound. They are populated only when the preview flavor actually needs inspect.

This is good architecture because it makes preview composition legible. Someone reading the template can now see that inspect is layered in, not native to the base document.

#### Tests pin the standalone omission contract directly

`test/webview_split.test.ts` adds an especially useful regression test:

- build standalone HTML,
- assert `shader_inspect.js` is absent,
- assert `window.ShaderToy.inspector =` is absent,
- assert `setInspectorVariable` routing is absent,
- assert `inspector.renderBuffer` hook is absent,
- assert `inspector.afterFrame` hook is absent.

That is not a superficial smoke test. It verifies the exact contract that stage5N introduces: portable HTML should not quietly carry inspect baggage.

**Why it mattered**

The inspect feature is deeply tied to extension-host coordination:

- editor selection,
- panel IPC,
- host-managed replay,
- workbench preview lifecycle.

Shipping that machinery into standalone HTML was never a conceptual fit. Stage5N acknowledges that explicitly and gives the preview assembly path a clean way to express it.

That helps both products:

- the workbench preview keeps full inspect power,
- portable HTML becomes lighter and less coupled to extension-only ideas.

**Effect on the implementation arc**

Stage5N is not a new inspect capability, but it is an important maturity signal.

It shows that the branch is no longer only adding inspect behavior. It is also deciding **where inspect should not exist**. That kind of boundary-setting is part of turning a transplant into a production-ready subsystem.

It also elevates `src/webviewcontentprovider.ts` from “script injector” to “mode-aware feature compositor”, which is valuable beyond inspect itself.

---

### 4.24 `98fc03e` — `stage5O: tighten inspect panel controls`

**Touched files**

- `resources/inspect_panel.html`

**What changed**

Stage5O is a pure UI-polish commit, but it arrives at exactly the right moment.

By this point the inspect panel already carries:

- mapping mode,
- min/max range,
- out-of-range highlighting,
- compare enablement,
- compare split,
- hover toggle,
- histogram enablement,
- histogram cadence,
- histogram sample density.

That is a lot of surface area. Stage5O does not add more behavior; it makes the control surface easier to read as a coherent instrument rather than a growing pile of rows.

#### Range controls are visually regrouped

The first polish move is around mapping range controls.

The out-of-range checkbox stops living on its own detached row and moves into the same visual cluster as Min/Max:

- `.range-row` gains wrapping behavior,
- `.range-row .checkbox-row` is pushed to the right with `margin-left: auto`,
- the toggle now reads as part of range interpretation, not as a separate feature.

That is a small change with good semantic payoff. Highlighting out-of-range values is not a separate system; it is one aspect of how the chosen mapping range should be interpreted. The layout now reflects that.

#### Compare controls become a single compact unit

The second polish move lands on the new compare UI from stage5M.

The compare area shifts from a vertically separated grid into a tighter flex layout:

- the compare checkbox and split slider are visually paired,
- the split control fills the remaining row width,
- the section consumes less height,
- the relationship between “enable compare” and “adjust compare split” becomes more obvious at a glance.

Again, this is not just aesthetic cleanup. It reduces the mental overhead of operating the control surface.

#### Nothing about runtime behavior changes

One reason this commit is worth calling out separately is that it is disciplined about scope:

- no host wiring changes,
- no preview logic changes,
- no telemetry changes,
- no test changes.

That makes it a clean example of late-branch UX refinement without hidden semantic drift.

**Why it mattered**

As the inspect branch matured, it accumulated more knobs because the subsystem genuinely needed them:

- replay-safe state,
- cadence,
- sample density,
- compare verification,
- range overlays,
- component-aware display.

Stage5O acknowledges the cost of that growth and pays down the visual debt before it becomes entrenched.

For a debugging tool, that matters. Dense control surfaces can quickly undermine the clarity they are supposed to provide.

**Effect on the implementation arc**

Stage5O is not load-bearing in the same way as stage5C, 5G, or 5L, but it is still part of the branch’s maturation story.

It marks the point where the work stops being only about “can inspect do this?” and also becomes about “can a user comfortably operate inspect once it can do all of this?”.

That is a real transition from feature landing to productization.

---

### 4.25 `b2d2350` — `stage5P: freeze paused inspect redraws`

**Touched files**

- `resources/webview/shader_inspect.js`
- `resources/webview_base.html`
- `src/webviewcontentprovider.ts`
- `test/inspect_runtime.test.ts`
- `test/webview_split.test.ts`

**What changed**

Stage5P hardens one of the most important interaction contracts in the entire preview: **paused means paused**.

Before this commit, inspect-triggered redraws such as:

- hover updates,
- compare split changes,
- immediate histogram refresh requests,

could still force rendering in a way that risked advancing simulation-related state even when the preview was paused.

Stage5P closes that loophole. Inspect-driven redraws can still happen on paused previews, but they do so through a special frozen-frame path that preserves the paused simulation state.

#### Redraw requests become pause-aware by default

`resources/webview/shader_inspect.js` introduces `requestPreviewFrame()`, a small helper with large consequences.

Instead of directly setting `forceRenderOneFrame`, inspect paths now funnel redraw requests through a centralized function that:

- checks whether the preview is paused,
- sets `freezeSimulationOnNextForcedRender = true` when paused,
- sets `forceRenderOneFrame = true` in either case.

That means pause-awareness stops being something each inspect feature must remember independently. Hover, compare split, and histogram refresh all inherit the same redraw semantics automatically once they call the helper.

This is exactly the right kind of late-branch refactor:

- small API,
- broad semantic payoff,
- fewer ways for future features to accidentally violate the pause contract.

#### Frozen paused redraws render only the final pass

The more dramatic part of the change lives in `resources/webview_base.html`.

The render loop now computes:

- `renderFrozenFrameOnly = paused && forceRenderOneFrame && freezeSimulationOnNextForcedRender`

and branches accordingly.

When that flag is true, the preview does **not** behave like a normal frame:

- `updateDate()` is skipped,
- fly controls do not advance,
- audio update is skipped,
- the full multipass chain is not replayed from buffer `0`,
- keyboard/mouse state mutation is skipped,
- ping-pong swaps are skipped,
- frame capture and frame counter advancement are skipped.

Instead, rendering starts at `Math.max(0, buffers.length - 1)`, which means only the final presentation pass is redrawn.

That is a crucial semantics choice. It says:

- inspect may refresh its presentation,
- but inspect may not advance the shader world while doing so.

#### Pause-aware time advancement becomes the only emitted time policy

`src/webviewcontentprovider.ts` also becomes stricter.

Previously the `pauseWholeRender` configuration could cause the provider to choose between:

- `AdvanceTimeExtension`, and
- `AdvanceTimeIfNotPausedExtension`.

Stage5P removes that split and always emits `AdvanceTimeIfNotPausedExtension`, while still optionally adding `PauseWholeRenderExtension` when configured.

This narrows the policy surface. Time advancement is now uniformly pause-aware even when the render loop is otherwise configured to allow special-case rendering behavior.

That is important because stage5P is not trying to add a clever exception. It is trying to make the pause contract harder to violate anywhere in the assembled preview.

#### Tests lock the pause contract in both runtime and assembled HTML

The tests are especially strong here because they hit the problem from both sides.

`test/inspect_runtime.test.ts` adds harness support for canvas events and then proves:

- paused hover movement requests a redraw,
- that redraw is marked as frozen,
- paused compare split changes do the same.

`test/webview_split.test.ts` then checks the generated HTML for the pause-aware structure itself:

- paused-aware time advancement guards,
- `deltaTime = 0.0` on paused redraws,
- `freezeSimulationOnNextForcedRender`,
- `renderFrozenFrameOnly`,
- final-buffer-only rendering.

That combination is excellent. Runtime tests protect the JavaScript contract; assembly tests protect the generated preview document that actually executes it.

**Why it mattered**

Debugging features are especially dangerous around paused simulations because they often need “one more render” to update their display. If that extra render silently changes time, ping-pong state, controls, or frame counters, the pause feature becomes untrustworthy.

Stage5P fixes that trust problem directly.

After this commit, inspect can still be interactive while paused, but it is interactive in a bounded way:

- update presentation,
- do not advance simulation.

That is a high-quality integration decision.

**Effect on the implementation arc**

Stage5P is the commit that makes inspect coexist properly with a broader preview invariant rather than behaving like a subsystem with special privileges.

It also deepens a theme that recurs throughout the branch:

- input changes set intent,
- the render loop decides how to realize that intent safely,
- post-render hooks do readback afterward.

Here the render loop gains one more responsibility: deciding whether an inspect-triggered redraw is allowed to be a real simulation step or only a frozen presentation refresh.

---

### 4.26 `58fca24` — `stage5R: finish stalled histogram evaluations`

**Touched files**

- `resources/inspect_panel.html`
- `resources/webview/shader_inspect.js`
- `test/inspect_runtime.test.ts`

**What changed**

Stage5R is the async-overlap hardening pass for the histogram pipeline.

Earlier late-branch work had already:

- made histogram work deferred,
- added cadence controls,
- added sample-density controls,
- reduced capture cost,
- tightened timing semantics.

But one issue remained: what should happen when a new histogram refresh arrives while the previous CPU histogram evaluation is still running?

Stage5R answers that decisively:

- **do not queue a backlog,**
- **let the in-flight evaluation finish,**
- **drop the newer overlap,**
- **surface the fact that the stream stalled.**

That is the final major behavior change in the report’s current range.

#### Histogram overlap stops building backlog

Before this commit, the runtime still retained a queued-frame model:

- if histogram processing was already active,
- snapshot data could be captured into queued buffers,
- and a follow-up drain step could launch the queued work afterward.

Stage5R intentionally tears that down.

`snapshotForHistogram()` now checks `_histogramProcessing` up front. If a histogram pass is already running:

- it sets `_histogramStalled = true`,
- it returns immediately,
- it does **not** store another queued frame.

`drainQueuedHistogram()` is reduced to clearing queue bookkeeping rather than starting follow-up work, because the queue is no longer part of the operating model.

This is a meaningful philosophical shift. The system no longer tries to “catch up” under load. It chooses boundedness over backlog fidelity.

#### In-flight work is allowed to finish and report its stalled state

Stage5R does **not** solve the overlap problem by bluntly canceling the current work every time a new request arrives.

Instead:

- `requestHistogramUpdateNow()` only calls `cancelHistogramWork()` when no histogram pass is currently active,
- active processing is allowed to continue,
- the completion path snapshots `_histogramStalled`,
- `postHistogram(...)` receives a `stalled` flag,
- and the flag is reset for the next cycle.

That is a subtle but very good choice.

It preserves the integrity of the in-flight evaluation while still acknowledging that the requested cadence was too aggressive for the current workload. In other words, the histogram remains truthful about the work it finished, and truthful about the fact that it could not keep up.

#### Stall state becomes visible panel telemetry

`resources/inspect_panel.html` gets a minimal but important addition:

- histogram stats text appends `STALL`,
- the stats line toggles a `.stall` class,
- that class uses the error color and stronger weight.

This is observability, not decoration.

If a user chooses:

- too-fast cadence,
- too-dense sampling,
- or a shader/viewport combination that makes histogram processing expensive,

the panel now tells them directly that the chosen settings outran the pipeline.

That closes the user-feedback loop created by stages 5E, 5I, and 5K. Controls now have a visible “you pushed this too far” signal.

#### Tests add controllable idle scheduling to exercise overlap deterministically

`test/inspect_runtime.test.ts` grows exactly the sort of harness support needed for this bug class:

- optional deferred `requestIdleCallback` scheduling,
- an idle callback queue,
- `flushIdleCallbacks()` to complete work at a chosen moment.

With that harness in place, the test can:

1. start one histogram evaluation,
2. request another update while the first is still active,
3. flush the idle callbacks,
4. assert that only one histogram message was emitted,
5. assert that the emitted histogram is marked `stalled = true`.

That is strong evidence that the new contract is not accidental behavior. It is the intended model.

**Why it mattered**

Asynchronous telemetry features often fail in one of two ways under load:

- they silently build backlogs and become stale,
- or they silently drop work and leave the user confused.

Stage5R avoids both failure modes:

- no unbounded backlog,
- no silent loss.

The histogram either keeps up, or it says it stalled.

That is a much healthier contract for an interactive debugger.

**Effect on the implementation arc**

Stage5R feels like the natural final step of the histogram maturation arc that began in stage5A.

The sequence now reads cleanly:

- prove value,
- restructure execution,
- add control surface,
- correct capture semantics,
- shape cost,
- tighten type semantics,
- and finally harden overload behavior.

At this point the histogram is no longer only “accurate enough” and “cheap enough.” It is also **bounded and observable under stress**.

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
- stage5I: histogram sample stride
- stage5M: compare split

By `HEAD`, the manager is effectively the inspect session model.

### 5.2 `webview_base.html` stays intentionally thin

The preview template does not become an inspect brain. It remains a narrow bridge with three inspect-specific jobs:

1. forward a bounded set of inspect commands into `window.ShaderToy.inspector.handleMessage(...)`,
2. allow the inspector to intercept the final presentation pass through `renderBuffer(...)`,
3. call `afterFrame()` after the final render pass.

That is a sound layering decision. The logic lives in `shader_inspect.js`; the template remains the transport hook.

Stage5N sharpens that principle further by turning inspect-specific routing, final-pass interception, and post-frame hooks into replaceable placeholders that can simply disappear for standalone exports. Stage5P extends the same pattern: even pause-aware frozen redraw semantics stay in the template as render-loop glue rather than pulling inspect state logic out of the runtime.

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
- stage5F upgrades the deferred path from sampled approximation to queued async full-frame evaluation with timing telemetry,
- stage5G aligns the capture source with the raw inspector range via a dedicated float pass,
- stage5H separates observed-domain measurement from crop interpretation through panel overlays,
- stage5I adds explicit sample-density control,
- stage5J removes avoidable per-update overhead and makes timing telemetry mean active work,
- stage5K pushes sample-density cost savings upstream into the raw capture step and changes the defaults,
- stage5L makes histogram payload semantics match the inspected component family,
- stage5R drops overlap backlogs and turns overload into explicit stall telemetry.

That is a healthy feature maturation pattern: first demonstrate usefulness, then shape cost, then expose controls, then tighten fidelity plus observability, then align the capture domain with the values the user is actually reasoning about, then tune overhead/defaults, then tighten the semantic contract around what inspect is allowed to mean, and finally make overload behavior explicit instead of implicit.

### 5.6 Inspect semantics are intentionally narrowed, not left fuzzy

The late branch does **not** try to support every expression that can be highlighted in an editor. Stage5L deliberately narrows the contract:

- only numeric scalar/vector families are supported,
- unsupported selections become no-ops,
- vector component picks normalize to the owning vector,
- both the host and the preview runtime validate the target independently.

That is a healthy architecture decision. It prevents the UI from pretending to know more than the runtime can actually reconstruct, and it turns selection behavior into something explicit and testable rather than heuristic and surprising.

### 5.7 Settings are normalized at both ends of the IPC boundary

Histogram interval and histogram sample stride are the clearest examples, but the pattern shows up elsewhere too: panel state is not blindly trusted. The panel and preview both normalize or bound inputs.

That makes the system more robust against stale UI state, malformed messages, and replay-order issues.

### 5.8 Testing targets contracts, not rendering aesthetics

The runtime tests introduced late in the branch do not try to prove visually perfect inspector output. Instead they protect the contracts most likely to regress:

- in-place rewrite,
- restoration,
- enable/disable toggles,
- compare split final-pass interception,
- timer configuration,
- full-frame histogram evaluation and timing payloads,
- raw render-target histogram capture against the configured inspector range,
- observed-domain reporting for panel-side cropping,
- sample-stride control and its effect on analyzed sample count and capture size,
- pause-safe frozen redraw behavior,
- supported/unsupported selection semantics,
- component-aware histogram and pixel-value behavior,
- standalone preview omission / preview-assembly contracts.

The addition of `test/inspectselection.test.ts` and `test/webview_split.test.ts` makes that strategy even clearer: once selection eligibility and preview assembly boundaries become architecturally important, they get their own dedicated contract tests too.

That is a pragmatic and architecture-aware choice for a webview/WebGL feature.

### 5.9 The chore commits show a reference-driven transplant workflow

The non-runtime commits are not random noise:

- one adds architecture docs and skills,
- one adds the upstream FragCoord reference as a submodule,
- one adds the full-scope inspect report itself,
- two briefly add and then remove local worktree gitlinks.

The documentation-focused chores, especially, show that inspect work on this branch was being treated as a documented transplant exercise rather than as an isolated hack.

### 5.10 Inspect learns to coexist with preview context, pause semantics, and load limits

The very late branch is notable because several commits are no longer about new measurement capability at all. They are about making inspect coexist cleanly with the environment around it.

- **Stage5N** defines where inspect exists: workbench preview yes, portable export no.
- **Stage5P** defines how inspect behaves while paused: redraw presentation if needed, but do not advance simulation.
- **Stage5R** defines what happens under histogram overload: finish the current work, drop overlap, and report the stall.

Those are maturity signals. A young feature tends to assume:

- it will always run in the right host,
- it can always redraw normally,
- and more requested work should always be accepted.

The final inspect branch stops making those assumptions.

Instead it says:

- availability is contextual,
- redraw semantics must respect broader preview invariants,
- async telemetry must stay bounded and observable.

That is one of the clearest ways the branch moves from “feature port” to “engineered subsystem”.

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

### 6.6 `203e05d` — first full state closure and replay-order cleanup

Read this next to understand the first cleanly replayed control surface before the later histogram-evaluation and semantic-alignment passes:

- preset interval buttons,
- interval normalization on both sides,
- interval persistence,
- replay order ending with `inspectorOn`.

It is the best commit for seeing how the branch closes its remaining configuration gaps cleanly.

### 6.7 `37952f7` — async full-frame histogram alignment

Read this next to understand how the histogram became asynchronously full-frame before its capture domain was corrected:

- queued async CPU binning,
- generation-based cancellation,
- full-frame rather than strided histogram analysis,
- evaluation-time telemetry in the panel,
- tests that finally exercise the histogram payload itself.

This is the commit that turns the histogram from “well-controlled and efficient enough” into “well-controlled, efficient enough, and materially closer to the real framebuffer distribution.”

### 6.8 `704fe4c` — raw-range histogram capture

Read this next to understand how the histogram switched from screen-output capture to a raw float capture path:

- dedicated histogram material + float render target,
- raw `renderer.readRenderTargetPixels(...)` capture,
- fallback byte path retention,
- binning against the active inspector range,
- cleanup of histogram-specific resources on restore and hot reload,
- tests that verify the raw path instead of the screen-output fallback.

If future work touches histogram correctness rather than just cost, this is one of the first commits to revisit.

### 6.9 `356fffd` — observed-domain overlays and crop guides

Read this next to understand the semantic cleanup after raw capture:

- two-phase scan/bin over the observed domain,
- panel-side crop overlays instead of runtime-side crop assumptions,
- mapping-curve guides over the histogram,
- tests updated to assert the observed raw domain rather than the mapping-clamped domain.

This is the commit that makes the histogram chart much more explanatory for humans, not just more accurate for the runtime.

### 6.10 `d143f20` — sample-stride controls

Read this next to understand how density became a first-class, replay-safe control:

- 1:1 / 1:8 / 1:64 sample-stride controls in the panel,
- host-side persistence and replay of sample stride,
- preview-side stride-aware scan/bin loops,
- immediate refresh when sample density changes,
- tests that prove stride normalization and reduced sample counts.

It is the bridge from “histogram has cadence controls” to “histogram has a real cost/fidelity surface.”

### 6.11 `0b8367f` — histogram overhead tightening

Read this next to understand the first cleanup pass after the control surface lands:

- removal of smoothing/copy work before emission,
- active-processing timing rather than wall-clock timing,
- stable-domain setup moved out of the binning hot path.

If future work touches histogram telemetry cost or the meaning of `timeMs`, this commit matters immediately.

### 6.12 `683a025` — downsampled capture and new defaults

Read this next to understand where sample-density stops being merely a CPU-loop detail and starts shaping capture itself:

- `5Hz` / `1:8` become the default operating profile,
- raw histogram capture resolution is reduced according to the preset,
- queued work preserves capture-time stride semantics,
- tests assert reduced render-target read size as well as reduced sample count.

This is the key reread if future work touches inspect ergonomics or default performance.

### 6.13 `5f6040e` — selection gate and type-aware semantics

Read this to understand the semantic endpoint of the selection/type-family arc:

- `src/inspectselection.ts` becomes a host-side selection contract,
- unsupported targets become no-ops,
- vector swizzle picks normalize to owning vectors,
- panel value display and histogram channels match component count,
- runtime and host tests both expand around inspect eligibility.

If future work touches what inspect is allowed to select, what the panel claims to show, or how type families map into histogram channels, this is one of the first commits to revisit.

### 6.14 `4561f42` — compare split verification

Read this next to understand how compare stopped being a rewrite-time semantic mode and became a presentation-time verification surface:

- compare split is persisted and replayed like other inspect settings,
- the final render pass can be intercepted by inspect,
- original output and inspected output are scissor-rendered side by side,
- preview-local overlay affordances label the split directly on the canvas.

If future work touches verification UX, side-by-side rendering, or final-pass interception, this is one of the first commits to revisit.

### 6.15 `dc7e4b0` — portable preview gating

Read this next to understand how inspect was cleanly scoped to the workbench preview:

- `resources/webview_base.html` becomes placeholder-driven for inspect seams,
- `src/webviewcontentprovider.ts` chooses whether to inject inspector hooks at assembly time,
- standalone HTML is explicitly verified to omit runtime, routing, and readback hooks.

If future work touches standalone export behavior or other preview-only tooling features, this commit shows the pattern to follow.

### 6.16 `98fc03e` — control-surface tightening

This is a small reread, but it is useful if someone needs to understand how the branch treats panel ergonomics once the control surface becomes dense:

- range interpretation controls are visually regrouped,
- compare enablement and compare split become a tighter unit,
- the polish is intentionally behavioral no-op.

It is the clearest evidence that the late branch cared about inspect usability, not only capability.

### 6.17 `b2d2350` — pause-aware inspect redraws

Read this next to understand how inspect was made compatible with paused previews:

- redraw requests are funneled through a pause-aware helper,
- frozen redraws render only the final presentation pass,
- time, ping-pong state, controls, and frame advancement remain frozen,
- tests cover both runtime behavior and emitted preview HTML structure.

If future work touches pause semantics, single-frame redraw behavior, or preview safety around interactive tooling, this commit is a key reference.

### 6.18 `58fca24` — histogram stall handling

Read this last to understand the current async-overlap model of the histogram:

- overlapping updates are dropped instead of queued,
- the active evaluation is allowed to finish,
- `stalled` becomes explicit histogram telemetry,
- the panel turns that telemetry into visible operator feedback.

If future work touches histogram throughput, idle scheduling, or overload observability, this is one of the first commits to revisit.

---

## 7. Conclusion

This commit range is best understood as the construction of an **inspect subsystem contract**, not merely the construction of a panel. The branch begins by proving that FragCoord-style inspect machinery can be transplanted into the preview, then spends the rest of its life making that machinery line-accurate, replay-safe, render-loop-correct, operationally affordable, semantically clearer in its histogram model, stricter about what counts as a valid inspect target, safer around paused redraws, explicit about where inspect should exist, and bounded/observable under histogram load.

The final architecture at `58fca24` is strong because it settles on a clear split:

- the **manager plus selection gate** own state, replay, and normalized inspect intent,
- the **preview document assembly path** decides whether inspect exists in the generated preview at all,
- the **preview runtime** owns rewriting, final-pass compare interception, post-render readback, raw-range capture, observed-domain analysis, downsampled/stride-aware histogram evaluation, pause-safe redraw cooperation, and stall-aware histogram emission,
- the **panel** owns controls and telemetry presentation, including compare split control, crop overlays that interpret the observed domain against the active mapping range, value displays that reflect the real component count, and visible stall feedback.

That split is the durable outcome of the branch. Future engineering work on inspect should preserve it, especially the host-side checkpointing/selection-normalization model, the placeholder-driven but still thin `webview_base.html` bridge, the final-pass interception seam added for compare, and the post-render readback / bounded-histogram discipline established across stages 4 through 5R.

---

## Appendix A — Implementation inventory at `58fca24`

This appendix provides the concrete file-level inventory that an AI agent needs to locate, slice, or cherry-pick inspect code. All LoC counts are total file size; the "+lines" column is the net inspect contribution measured as `git diff --stat fd6be52..58fca24`.

### A.1 File manifest

| File | Total LoC | Inspect +/− | Role |
|---|---|---|---|
| `resources/webview/shader_inspect.js` | 1 466 | +1 670 | **New file.** Preview-side inspect engine: type inference, shader rewriting, compare split rendering, hover readback, histogram capture/binning, stall handling. |
| `resources/inspect_panel.html` | 835 | +905 | **New file.** Inspect panel UI: controls, telemetry canvas, crop overlays, STALL marker, component-aware display. |
| `src/inspectpanel.ts` | 242 | +271 | **New file.** Panel IPC facade: webview lifecycle, message bridging, callback surface. |
| `src/inspectselection.ts` | 159 | +187 | **New file.** Host-side selection gate: type resolution, swizzle normalization, eligibility filtering. |
| `test/inspect_runtime.test.ts` | 419 | +489 | **New file.** Runtime contract tests (16 cases): rewrite, restore, histogram, compare, stall, selection, pause. |
| `test/inspectselection.test.ts` | 36 | +42 | **New file.** Selection gate tests (3 cases): acceptance, normalization, rejection. |
| `test/webview_split.test.ts` | 122 | +95 | **Extended.** Assembly contract tests: placeholder structure, portable inlining, standalone omission, pause-aware rendering. |
| `src/shadertoymanager.ts` | 552 | +261/−5 | **Extended.** State authority: 10 `_lastInspector*` fields, selection listener, panel wiring, replay, message routing. |
| `src/webviewcontentprovider.ts` | 490 | +73/−24 | **Extended.** Assembly: placeholder-driven inspector injection, `omitInspectorContent` for standalone exports. |
| `resources/webview_base.html` | 655 | +59/−29 | **Extended.** Render loop: `renderBuffer` interception, `afterFrame` hook, `freezeSimulationOnNextForcedRender`, `renderFrozenFrameOnly`. |
| `src/extension.ts` | 89 | +4 | **Extended.** Command registration: `shader-toy.showInspectPanel`. |
| `package.json` | 294 | +4 | **Extended.** Command declaration. |

**Totals:** 12 files, +4 031 / −29 net lines, 6 entirely new files.

### A.2 Key identifiers by file

#### `resources/webview/shader_inspect.js` — function map

| Line | Function | Stage relevance | Purpose |
|---|---|---|---|
| 72 | `escapeRegex` | stage1 | Utility |
| 76 | `typeDimension` | stage1 | Type → component count |
| 85 | `isSupportedInspectableType` | stage1 | Eligibility gate (numeric scalar/vector only) |
| 89 | `isVectorType` | stage1 | Vector family check |
| 93 | `getInspectableComponentCount` | stage1 | Component count for histograms/display |
| 100 | `resolveSwizzle` | stage1 | Swizzle suffix → type |
| 109 | `parseFunctionSignature` | stage1 | Cross-function inspect support |
| 117 | `generateMockArgs` | stage1 | Mock arguments for function-context inspect |
| 131 | `inferLiteralType` | stage1 | Literal/define type inference |
| 142 | `resolveVariableType` | stage1 | Line-aware declaration lookup |
| 188 | `tryResolveInspectableVariable` | stage1 | Swizzle + vector normalization |
| 228 | `inferExpressionType` | stage1 | Expression-level type inference |
| 281 | `inferFunctionCallType` | stage1 | Function-return type inference |
| 298 | `parseDefines` | stage1 | `#define` expansion |
| 312 | `resolveDefine` | stage1 | Single-define resolution |
| 318 | `inferType` | stage1 | Top-level type inference entry |
| 337 | `coerceToVec4` | stage1 | Any GLSL type → `vec4` |
| 353 | `generateInspMap` | stage1 | Mapping function codegen (linear/sigmoid/log) |
| 394 | `findMainFunction` | stage1 | Locate `main()` boundaries |
| 424 | `replaceFragColor` | stage1 | `fragColor` → `_inspFC` rename |
| 429 | `lineAtOffset` | stage1 | Offset → line number |
| 434 | `getPreambleOffset` | stage1 | Preamble line translation |
| 442 | `findInsertionPoint` | stage1 | Scope-aware insertion for inspect output |
| 495 | `fixForLoopScoping` | stage1 | For-loop scoping repair |
| 553 | `parseRangeAnnotation` | stage1 | `// [min, max]` comment parsing |
| 577 | `buildInspectorShader` | stage1 | Main inspect rewrite builder |
| 621 | `buildCompareShader` | stage3 | Compare-mode rewrite builder |
| 663 | `rewriteForInspector` | stage1 | Top-level inspect rewrite entry |
| 683 | `rewriteForCompare` | stage3 | Top-level compare rewrite entry |
| 744 | `requestPreviewFrame` | stage2 | Centralized redraw request with pause awareness |
| 753 | `markShaderMaterialDirty` | stage1 | Material dirty flag |
| 761 | `normalizeHistogramInterval` | stage5 | Interval clamping |
| 768 | `normalizeHistogramSampleStride` | stage5 | Stride clamping |
| 775 | `normalizeCompareSplit` | stage3 | Split position clamping [0.1, 0.9] |
| 781 | `getNowMs` | stage5 | Timing utility |
| 788 | `canUseRawHistogram` | stage5 | Float FBO availability check |
| 796 | `scheduleHistogramWork` | stage5 | `requestIdleCallback` / `setTimeout` scheduler |
| 809 | `ensureHistogramByteBuffer` | stage5 | Reusable byte buffer for fallback capture |
| 822 | `ensureHistogramFloatBuffer` | stage5 | Reusable float buffer for raw capture |
| 836 | `disposeHistogramResources` | stage5 | Cleanup render target + buffers |
| 848 | `syncHistogramMaterial` | stage5 | Clone material for raw histogram pass |
| 876 | `disposeCompareOriginalMaterial` | stage3 | Cleanup original material clone |
| 883 | `syncCompareOriginalMaterial` | stage3 | Clone material for compare split |
| 910 | `ensureCompareOverlay` | stage3 | Create/update canvas overlay |
| 959 | `updateCompareOverlay` | stage3 | Position divider/labels on canvas |
| 976 | `renderBuffer` | stage2/3 | Final-pass interception: scissor split compare |
| 1016 | `ensureHistogramTarget` | stage5 | Float render target management |
| 1036 | `getHistogramCaptureDimensions` | stage5 | Downsampled capture sizing |
| 1050 | `postHistogram` | stage5 | Emit histogram payload with telemetry |
| 1071 | `drainQueuedHistogram` | stage5 | Queued work drain (stall-aware) |
| 1077 | `cancelHistogramWork` | stage5 | Generation-based cancellation |
| 1091 | `startHistogramProcessing` | stage5 | Async scan/bin pipeline |
| 1116 | `getStableDomain` | stage5 | Domain stability filter |
| 1129 | `toDisplayValue` | stage5 | Display formatting |
| 1243 | `getShaderSource` | stage1 | Shader source discovery |
| 1257 | `updateInspection` | stage1 | Top-level inspect state update |
| 1264 | `doInspection` | stage1 | Shader rewrite + material mutation |
| 1344 | `restoreOriginal` | stage1 | Restore original fragment shader |
| 1368 | `postStatus` | stage1 | Emit status to host |
| 1385 | `setupHoverReadback` | stage4 | Mouse tracking + canvas events |
| 1406 | `afterFrame` | stage2/4/5 | Post-render: compare overlay, hover readback, histogram snapshot |
| 1435 | `snapshotForHistogram` | stage5 | Full-frame capture with stall detection |
| 1493 | `requestHistogramUpdate` | stage5 | Mark histogram dirty |
| 1497 | `requestHistogramUpdateNow` | stage5 | Immediate capture trigger |
| 1506 | `startHistogramTimer` | stage5 | Cadence timer start |
| 1514 | `stopHistogramTimer` | stage5 | Cadence timer stop |
| 1523 | `handleMessage` | stage1+ | Central message dispatcher |

#### `src/shadertoymanager.ts` — inspect-specific state fields

```
_lastInspectorVariable    : string   — selected variable name
_lastInspectorLine        : number   — 1-based editor line
_lastInspectorType        : string   — inferred GLSL type
_lastInspectorMapping     : object   — {mode, min, max, clamp}
_lastCompareEnabled       : boolean  — compare split toggle
_lastCompareSplit         : number   — split position [0.1, 0.9]
_lastHoverEnabled         : boolean  — hover readback toggle
_lastHistogramEnabled     : boolean  — histogram toggle
_lastHistogramIntervalMs  : number   — refresh cadence (default 200)
_lastHistogramSampleStride: number   — sample density (default 8)
```

#### `src/inspectselection.ts` — supported type families

```
Scalar:  float, int, uint
Vec2:    vec2, ivec2, uvec2
Vec3:    vec3, ivec3, uvec3
Vec4:    vec4, ivec4, uvec4
Rejected: bool, mat2, mat3, mat4, sampler2D, samplerCube, void, struct
```

#### `resources/webview_base.html` — inspector placeholder seams

| Placeholder | Injected content | Standalone behavior |
|---|---|---|
| `<!-- Webview shader_inspect.js -->` | Module script tag for `shader_inspect.js` | Replaced with empty string |
| `<!-- Inspector Message Routing -->` | `switch` cases delegating to `inspector.handleMessage()` | Replaced with empty string |
| `<!-- Inspector Final Pass -->` | `renderBuffer()` interception in render loop | Replaced with empty string |
| `<!-- Inspector After Frame -->` | `afterFrame()` call after final buffer | Replaced with empty string |

### A.3 Build and test verification

```bash
npm run compile          # TypeScript → out/
npm test                 # All tests (inspect-specific: 23 cases across 3 suites)
```

All 23 inspect-specific tests pass at `58fca24`. The 23 *failing* tests in the full suite are from unrelated worktree copies (`pr217`, `pr218`, `wip#sound-synth`) and do not affect inspect code.
