# RC3 Implementation Log

## Purpose

- Capture the actual RC3 implementation progression, especially the back-and-forth around INSPECT and FRAMES.
- Record root causes, regressions introduced during RC3, how they were detected, and how they were corrected.
- Preserve UX agreements reached during RC3 so RC4 does not re-open the same behavior debates.
- Provide explicit guardrails for any future work touching preview reload, editor switching, histogram capture, compare mode, portable export, and FRAMES/INSPECT interaction.

## Scope Covered

- Commit progression from `181da19` through `649b44f`.
- Manual-debug findings from the RC3 chat session that were not obvious from the diffs alone.
- Environment and rebuild notes used repeatedly during RC3.
- Current UX contract for INSPECT behavior.
- Dedicated section for FRAMES/INSPECT interaction.

## Branch / Commit Progression

| Order | Commit | Title | Role in RC3 |
|---|---|---|---|
| 1 | `181da19` | `stage5: final async histogram with stall-aware evaluation` | Large INSPECT histogram baseline landed before the RC3 fix pass. |
| 2 | `a1d4913` | `fix(FRAMES): stabilize pause, reload, and timing state against other features` | FRAMES timing lifecycle hardening; created many of the timing hooks later used by INSPECT. |
| 3 | `e5793b7` | `test: isolate root test compilation from worktree artifacts` | Test/build hygiene fix; important because this repo contains multiple worktrees. |
| 4 | `d4ec959` | `fix(HISTOGRAM): gate capture on active inspect targets` | First RC3 correctness fix: stop premature histogram capture and stale histogram reuse. |
| 5 | `a8ab006` | `fix(INSPECT): restore standalone inspector runtime activation` | Decoupled standalone INSPECT behavior from FRAMES presence and removed pre-target hover activity. |
| 6 | `c39bdab` | `fix(INSPECT): add compare flip and isolate portable preview` | Added compare L/R flip; made portable export omit INSPECT and FRAMES runtime/hooks. |
| 7 | `43d6d3e` | `fix(INSPECT): preserve local targets across reload remapping` | Fixed declaration-line/include-remapping regressions and explicit target clearing behavior. |
| 8 | `649b44f` | `fix(INSPECT): bind selection updates to the previewed shader` | Final RC3 UX fix: INSPECT follows the shader actually bound to preview, not arbitrary editor focus. |

## High-Level Outcome of RC3

- INSPECT no longer depends on FRAMES being present to activate correctly.
- Histogram and hover work only after a valid inspect target exists.
- Declaration-line locals such as `x`, `y`, `z` are handled correctly, including CRLF and `#include` / `#line` remapping scenarios.
- Compare split has L/R flip, with stable split behavior.
- Portable HTML export omits both INSPECT and FRAMES runtime hooks.
- INSPECT selection logic now follows the preview-bound shader, not whichever editor happens to be active.
- Editor changes can intentionally clear INSPECT to a fresh state instead of leaking stale values into unrelated shaders.

## RC3 UX Agreements

### INSPECT target lifecycle

- INSPECT is not allowed to act as if a target exists before the user has selected a valid inspectable value.
- INSPECT may keep panel settings alive across reloads:
  - mapping mode
  - compare enablement
  - compare split
  - compare flip
  - hover enablement
  - histogram enablement / interval / sample stride
- INSPECT must not keep a stale variable target alive across shader-boundary changes unless the preview remains bound to the same shader and the target remains valid.
- If shader context changes and no explicit fresh inspectable target is provided, INSPECT should reset to a clean waiting state.

### INSPECT vs editor focus

- INSPECT should follow the shader currently bound to the dynamic GLSL preview.
- If the user clicks into another editor while the preview remains bound to the previous shader, INSPECT must ignore selection changes from the non-previewed editor.
- If settings are configured so editor jumps move the preview (`reloadAutomatically=true` and `reloadOnChangeEditor=true`), INSPECT should follow the new previewed shader.
- If that new editor location is not inspectable, INSPECT should clear cleanly and wait for a new explicit target.

### Portable export

- Portable export is a plain preview artifact.
- INSPECT runtime must be omitted from portable export.
- FRAMES runtime must also be omitted from portable export.

## Environment / Rebuild Notes Used During RC3

### Local vs global npm state

- Global npm cache in this environment was confirmed at `X:\.packages\npm`.
- Local project install remains `X:\_shadertoy\node_modules`.
- Local VS Code test runtime remains `X:\_shadertoy\.vscode-test`.
- During RC3, the requested “deep rebuild” for manual testing repeatedly meant:
  - remove `node_modules`
  - remove `dist`
  - remove `out`
  - remove `.vscode-test`
  - keep the global npm cache intact
  - run `npm ci`
  - run `npm run webpack`
  - run `npm run compile`

### Test runner caveat seen during RC3

- Full `npm test` was intermittently blocked by the downloaded VS Code host reporting:
  - `Code is currently being updated. Please wait for the update to complete before launching.`
- This was treated as a test-host environment issue, not a shader-toy code failure.
- Workaround used during RC3:
  - run compiled Mocha suites directly with `--ui tdd`
  - particularly `out/test/inspect_runtime.test.js`
  - and `out/test/webview_split.test.js`

## Commit-by-Commit Notes

## 1. `181da19` `stage5: final async histogram with stall-aware evaluation`

### Intent

- Land the richer histogram pipeline for INSPECT.
- Move histogram work off the critical render path as much as possible.
- Add panel-side visualization and runtime controls.

### Main implementation themes

- Added histogram UI, rate controls, sample-stride controls, and richer stats in `resources/inspect_panel.html`.
- Added runtime-side histogram capture orchestration in `resources/webview/shader_inspect.js`.
- Extended host/panel messaging in `src/inspectpanel.ts` and `src/shadertoymanager.ts`.
- Added webview plumbing in `src/webviewcontentprovider.ts`.
- Added runtime tests and webview split tests.

### What this commit established

- Histogram became a first-class INSPECT feature.
- Histogram capture had configurable refresh interval and configurable sample stride.
- Stall reporting became part of the payload.

### Weaknesses discovered after landing

- Histogram could start before a valid inspect target existed.
- Histogram panel could keep rendering stale data after target changes.
- The first histogram payload assumptions in tests were too optimistic once clear states were introduced later.

### RC4 caution

- Any future histogram refactor must preserve:
  - active-target gating
  - stall signaling
  - clear/null payload semantics
  - sample stride and rate controls as persistent panel state

## 2. `a1d4913` `fix(FRAMES): stabilize pause, reload, and timing state against other features`

### Intent

- Make FRAMES timing stable under pause, reload, and interaction with other preview features.

### Main implementation themes

- Hardened `resources/webview/frame_timing.js`.
- Added pause/reload-sensitive timing behavior in `resources/webview_base.html`.
- Adjusted host state handling in `src/shadertoymanager.ts` and `src/framespanel.ts`.
- Added timing-related hooks that INSPECT later relied on for exclusion behavior.

### Why this matters to INSPECT

- INSPECT later needed to avoid polluting FRAMES timing.
- The FRAMES exclusion and sample skipping model used during RC3 depends on this stabilization pass.

### RC4 caution

- Do not bypass the existing timing exclusion/sample skip helpers from ad hoc INSPECT code.
- Any new preview-side feature doing expensive work must either:
  - use timing exclusion sections
  - or intentionally skip the next frame sample

## 3. `e5793b7` `test: isolate root test compilation from worktree artifacts`

### Intent

- Prevent repo worktree directories from polluting root test compilation.

### Why it mattered during RC3

- Multiple worktrees existed in this repo during the session.
- Without this isolation, test compilation noise could mask real regressions.

### RC4 caution

- Keep any new test glob or tsconfig change scoped so worktree content does not leak back into root build/test behavior.

## 4. `d4ec959` `fix(HISTOGRAM): gate capture on active inspect targets`

### Trigger

- Two earlier RC2 review/todo findings were revisited and confirmed as still real:
  - histogram telemetry could begin before any valid inspect target existed
  - stale histogram data remained visible after target changes

### Root cause

- Histogram activity was keyed too loosely to “INSPECT is on” instead of “INSPECT has an active valid target”.
- The panel reused the last histogram payload too eagerly when the variable target changed.

### Main implementation details

- In `resources/webview/shader_inspect.js`:
  - introduced target-aware gating helpers
  - blocked histogram capture and posting before a valid target exists
  - ensured histogram work is cancelled/cleared when target state is invalid
- In `resources/inspect_panel.html`:
  - clear histogram state when target changes
  - handle null/empty histogram payloads as explicit clears
- In `test/inspect_runtime.test.ts`:
  - updated tests to account for explicit clear messages
  - added coverage for “no histogram before valid target”

### Validation notes

- Static file checks passed.
- Existing tests had to be adjusted because histogram behavior became more correct and less naïve.
- `Array.prototype.at` had to be removed from tests due to TS target compatibility.

### UX contract established

- Histogram must be visually empty until a real inspect target is selected.
- Target changes must clear stale histogram state immediately.

## 5. `a8ab006` `fix(INSPECT): restore standalone inspector runtime activation`

### Trigger

- INSPECT features appeared dormant unless FRAMES was also present.
- Fresh-start INSPECT could still process final shader output before any variable was selected.

### Root cause

- Preview readiness did not always cause inspector state to be replayed into the rebuilt preview.
- Hover readback could still operate before a valid inspect target existed.
- Runtime activation sequence was accidentally coupled to events that FRAMES often happened to trigger.

### Main implementation details

- In `src/shadertoymanager.ts`:
  - resend inspector state on `previewReady`
  - make standalone INSPECT activation deterministic
- In `resources/webview/shader_inspect.js`:
  - gate hover pixel sampling on active valid target
- In `test/inspect_runtime.test.ts`:
  - add regression coverage for hover staying idle before target selection

### Validation notes

- Full `npm test` passed at that point of RC3.

### UX contract established

- INSPECT must work standalone, without FRAMES being active.
- Before a valid target exists, hover/histogram/readback should remain idle.

## 6. `c39bdab` `fix(INSPECT): add compare flip and isolate portable preview`

### Trigger

- Follow-up RC3 requests:
  - verify FRAMES exclusion of shader recompilation cost
  - add `L/R Flip` to compare split view
  - determine portable HTML export behavior for FRAMES and INSPECT

### Main implementation details

- Compare UI / state:
  - added `L/R Flip` checkbox to the compare controls row in `resources/inspect_panel.html`
  - removed compare percentage text
  - persisted compare flip state through `src/inspectpanel.ts` and `src/shadertoymanager.ts`
- Compare runtime:
  - added compare flip behavior in `resources/webview/shader_inspect.js`
  - preserved split position while swapping inspected/original sides
- Portable export:
  - `src/webviewcontentprovider.ts` updated so standalone portable preview omits:
    - INSPECT runtime module
    - INSPECT hooks
    - FRAMES runtime module
    - FRAMES hooks / state references
- Tests:
  - `test/inspect_runtime.test.ts`
  - `test/webview_split.test.ts`

### Important behavior decision

- Portable export should be plain preview only.
- RC3 explicitly moved both INSPECT and FRAMES out of standalone export.

### FRAMES conclusion from this phase

- Shader recompilation time was considered excluded from FRAMES through the combination of exclusion sections and sample skipping in the INSPECT runtime.

## 7. `43d6d3e` `fix(INSPECT): preserve local targets across reload remapping`

### Trigger

- Several regressions and edge cases converged here:
  - switching shader context with INSPECT active could replay stale targets
  - declaration-line locals (`x`, `y`, `z`) could regress in included/remapped shaders
  - explicit target clearing semantics were not fully end-to-end safe

### Root cause set

- Host-side clear-state handling reused previous variable/type when receiving blank status payloads.
- Runtime line targeting used physical transformed-source lines rather than honoring `#line` remapping.
- Editor/source line to transformed shader line conversion was incomplete for included shaders.

### Main implementation details

- In `resources/webview/shader_inspect.js`:
  - added explicit target-clearing behavior for blank `setInspectorVariable`
  - introduced source-line mapping through `#line` directives before variable resolution
  - kept declaration-line insertion behavior safe
- In `src/shadertoymanager.ts`:
  - corrected status handling so blank inspector status is treated as a real clear
  - stopped stale variable resurrection after clear/reset messages
- In `test/inspect_runtime.test.ts`:
  - added tests for explicit target clearing
  - added include-remapping regression test for declaration-line inspection
  - retained CRLF declaration-line coverage

### Specific shader case covered

- `demos/blobby.glsl`
- top-level `#include` plus declaration-line locals `x`, `y`, `z`
- earlier confusion resembled swizzle/field resolution failures, but the actual issue was line targeting under remapped source

### UX contract established

- Explicit clear target means:
  - restore original shader
  - clear current target
  - clear panel state related to the target display
  - do not silently keep using the old variable

## 8. `649b44f` `fix(INSPECT): bind selection updates to the previewed shader`

### Trigger

- Even after earlier fixes, INSPECT could still react to arbitrary editor focus/selection instead of the shader actually bound to the dynamic preview.
- User expectation was explicit:
  - INSPECT should be “stuck” to the current preview shader
  - moving to another editor should not accidentally change INSPECT unless settings intentionally move the preview too

### Root cause

- The manager still treated `activeEditor` and “document currently loaded in dynamic preview” as the same conceptual thing.
- They diverge whenever `reloadOnChangeEditor` is disabled.
- Selection listener logic and reload logic were still too active-editor-centric.

### Main implementation details

- In `src/shadertoymanager.ts`:
  - introduced separate tracking for `dynamicPreviewDocument`
  - dynamic preview rebuilds/reloads now follow that tracked preview document
  - selection listener ignores selections outside the preview-bound shader document
  - explicit preview rebuild command rebinds the preview document correctly
  - editor jumps now behave differently depending on settings:
    - if editor jump moves preview: INSPECT follows and clears on miss
    - if editor jump does not move preview: INSPECT clears/ignores non-preview editor activity
  - shared selection synchronization path used to make clear-on-miss behavior intentional

### UX contract established

- INSPECT is preview-bound, not editor-bound.
- Non-preview editor selection should not emit accidental INSPECT updates.
- If a settings-driven preview jump lands on a non-inspectable location, INSPECT should clear to a fresh waiting state.

## FRAMES and INSPECT Interaction

## Design intent

- FRAMES and INSPECT are separate features.
- Either feature must work if the other is absent.
- INSPECT work must not pollute FRAMES timing.
- Portable export should include neither feature runtime.

## What FRAMES measures after RC3

- FRAMES is intended to measure preview frame timing for the actual shader rendering path.
- INSPECT-induced management work should be excluded from those measurements.

## Mechanisms used during RC3

- `resources/webview/frame_timing.js`
  - begin/end frame tracking
  - excluded section support
  - sample window reset
  - skip-next-frame support
- `resources/webview/shader_inspect.js`
  - `withFrameTimingExcludedWork(...)`
  - `skipNextFrameTimingSample()`
  - explicit use around compare overlay maintenance, histogram capture, and inspection update paths

## Practical agreement reached during RC3

- Shader recompilation or runtime rewrite work triggered by INSPECT should not show up as FRAMES timing noise.
- Hover and histogram activity should remain idle before a valid target exists.
- Compare overlay bookkeeping should also avoid contaminating FRAMES timing.

## Important coupling bugs found during RC3

- INSPECT appeared to need FRAMES to “wake up” because inspector readiness replay was incomplete.
- This was fixed in `a8ab006` by resending inspector state on preview readiness.
- Conclusion:
  - if INSPECT seems to only work when FRAMES is visible, treat that as a bug in state activation, not as an intended architecture.

## Portable export agreement

- During RC3, portable preview was explicitly made to omit both INSPECT and FRAMES.
- Rationale:
  - portable artifact should be plain preview
  - lower runtime complexity
  - avoid hidden dependencies on VS Code messaging and analysis features

## RC4 caution for FRAMES/INSPECT work

- Do not add direct timing hooks inside INSPECT feature code unless they route through the existing exclusion/skip helpers.
- Do not reintroduce portable export hooks for either subsystem without an explicit product decision.
- Any preview lifecycle change must be re-evaluated against both:
  - standalone INSPECT activation
  - FRAMES timing contamination

## Regression Timeline / What Went Wrong During RC3

### 1. Histogram started too early

- Symptom:
  - histogram ran before any valid inspect target
- Fix:
  - target-gated histogram capture

### 2. Histogram panel reused stale payload

- Symptom:
  - switching variable left previous histogram visible
- Fix:
  - explicit panel clear on target change/null payload

### 3. Declaration-line locals broke under CRLF

- Symptom:
  - injected inspect assignment could splice into following declaration line
- Fix:
  - CRLF-aware insertion / declaration-line separation

### 4. INSPECT only seemed alive when FRAMES was present

- Symptom:
  - standalone INSPECT dormant until another feature poked the preview
- Fix:
  - resend inspector state on preview readiness

### 5. Hover sampled before target selection

- Symptom:
  - readback happened before any chosen variable
- Fix:
  - hover gated on active valid target

### 6. Compare L/R flip initially exposed test expectation drift

- Symptom:
  - compare split test expected old split value from pre-change harness setup
- Fix:
  - test corrected to match new deterministic setup

### 7. Portable export omitted INSPECT but still leaked FRAMES references

- Symptom:
  - standalone HTML still contained frame timing references
- Fix:
  - remove runtime module plus guard/hook remnants from standalone assembly output

### 8. Clear-target behavior resurrected stale variables via host fallback

- Symptom:
  - blank status payload still reused previous variable in host state
- Fix:
  - treat blank variable/type as authoritative clear

### 9. Included/remapped shaders broke local declaration targeting

- Symptom:
  - local `x`/`y`/`z` in shaders with top includes could act like wrong-scope/swizzle confusion
- Fix:
  - map editor lines through `#line` remapping before runtime variable resolution

### 10. Explicit new preview on a different shader could keep previous INSPECT target

- Symptom:
  - creating a new dynamic preview while focused on another shader could still carry the old target
- Fix:
  - explicit preview command now always binds current active editor and clears target on document change

### 11. INSPECT followed editor focus instead of preview binding

- Symptom:
  - selecting text in a non-previewed shader could still affect INSPECT
- Fix:
  - separate preview-bound document tracking from `activeEditor`

## Current State at End of RC3

### Expected correct behavior

- Open preview on shader A.
- Open INSPECT and select a valid target in shader A.
- Histogram/hover/compare function normally once target exists.
- Click into shader B while preview remains on shader A and `reloadOnChangeEditor=false`:
  - INSPECT should not update from shader B selection.
  - depending on the final manager behavior selected during RC3, INSPECT may clear to waiting state on shader-context jump.
- If `reloadOnChangeEditor=true` and editor jump recompiles preview to shader B:
  - INSPECT should follow shader B only after preview actually moves.
  - if landing on a non-inspectable location, INSPECT should clear and wait.

### Portable export

- No INSPECT runtime.
- No FRAMES runtime.

### Test posture

- Focused runtime and webview tests are strong around INSPECT behavior.
- Full VS Code-host tests remained partially hostage to downloaded runtime launch/update instability during parts of RC3.

## Recommended RC4 Guardrails

### If modifying INSPECT runtime

- Re-run at minimum:
  - `npm run compile`
  - direct Mocha TDD run for `out/test/inspect_runtime.test.js`
  - direct Mocha TDD run for `out/test/webview_split.test.js` when touching webview assembly/export
- Manually verify against:
  - no-target idle state
  - CRLF declaration-line locals
  - included/remapped shader locals
  - preview-bound vs editor-bound selection behavior

### If modifying preview lifecycle / manager logic

- Explicitly decide which document is authoritative for each path:
  - `activeEditor`
  - dynamic preview document
  - static preview document
- Do not use `activeEditor` as a hidden stand-in for “current preview shader” without checking settings.

### If modifying FRAMES

- Re-check:
  - pause behavior
  - reload behavior
  - timing enable/disable messaging
  - INSPECT exclusion behavior
  - portable export omission rules

### If modifying histogram / compare mode

- Re-check:
  - no histogram before target exists
  - histogram clear on target change
  - compare flip preserves split
  - paused redraw semantics for compare/hover

## Suggested RC4 Backlog Starting Point

- Add manager-level tests around preview-bound selection behavior if practical.
- Add a dedicated test harness for manager/editor/preview document transitions, not only runtime rewriting.
- Revisit whether INSPECT clear-on-non-preview editor jump should always clear immediately or only ignore selections; RC3 converged on a stricter reset-oriented UX, but this is still a product behavior decision worth preserving explicitly.
- Keep FRAMES/INSPECT separation explicit in any new feature design notes.

## Short Executive Summary

- RC3 successfully moved INSPECT from “feature-rich but fragile” to “feature-rich with explicit lifecycle rules”.
- The majority of RC3 regressions came from state ownership mistakes:
  - stale target ownership
  - preview-bound vs editor-bound ownership
  - logical source line vs transformed shader line ownership
- FRAMES and INSPECT now have clearer boundaries.
- RC4 should treat preview lifecycle and target lifecycle as first-class design constraints, not incidental implementation details.