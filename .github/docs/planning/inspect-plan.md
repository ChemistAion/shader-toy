# INSPECT RC Distillation Plan

> **Target artifact**: a five-stage release-candidate retelling of the INSPECT implementation, using curated top-level commits rather than replaying the original branch chronology as-is.
>
> **Primary source of truth**: `.github/docs/architecture/inspect-report.md`
>
> **Scope**: INSPECT code machinery only. No `.github` setup work, no reference-submodule chores, no worktree chores, no report-maintenance commits.
>
> **Current implementation endpoint**: `58fca24` (`stage5R: finish stalled histogram evaluations`)
>
> **Goal**: collapse the branch into a cleaner, reviewable progression that is easier to digest while preserving the final feature set and the final bugfix/hardening semantics.
>
> **Execution discipline**: this must be a **cherry-pick-like, surgical distillation** of code that already exists on the branch. No redesign, no new side quests, no speculative refactors, no reinterpretation of the feature set.

---

## 0. Executive summary

The original INSPECT branch is historically honest, but it is not an ideal release-candidate narrative.

It grows the feature the way real engineering often grows:

- feature first,
- regressions discovered later,
- lifecycle hardening later still,
- semantics tightened after operational behavior already exists,
- and transport/preview-scope fixes arriving surprisingly late.

That is useful for archaeology, but not ideal for an RC sequence that reviewers should be able to read as a clean, deliberate progression.

The right way to distill this branch is **not** to replay the old stage commits verbatim as a blind historical cherry-pick train.
The right way is to keep the process **cherry-pick-like in spirit** while treating `HEAD` as the semantic truth: walk backward from the final architecture, then rebuild the feature forward in five curated stages where each stage starts life with the **final already-existing corrections** that belong to its scope.

In other words:

- the **historical branch** tells us how the feature was discovered,
- the **RC sequence** should tell us how the feature ought to have landed.

This plan proposes that RC sequence.

### 0.1 Review-pass conclusion

This review pass answers three explicit questions.

#### 1. Does the plan account for the final functionality and UX agreements at `HEAD`?

**Yes, but the wording needed to become more explicit.**

The intended final surfaces are all represented:

- strict core inspect,
- workbench-only preview scope,
- compare split verification,
- hover pixel readback,
- final optimized histogram,
- paused redraw correctness,
- component-aware panel semantics,
- stall-aware histogram telemetry.

This revision makes that coverage more explicit below.

#### 2. Does the plan account for the regression/hardening work, especially the `stage5A`-`stage5R` arc?

**Yes.**

The histogram stage is intentionally defined as the place where the entire `stage5A`-`stage5R` maturation arc lands in final form:

- not the early prototype,
- not the intermediate queued model,
- but the mature async/raw/observed-domain/stride-aware/stall-aware system.

This revision adds an explicit audit section for that.

#### 3. Is the plan explicit enough that this is a cherry-pick-like PR distillation rather than a redesign?

**Previously: only partially. Now: yes, explicitly.**

The earlier draft clearly said to use `HEAD` as semantic truth, but it could still be read as more architectural reinterpretation than intended.
This revision tightens that language:

- the RC line is a **surgical re-slicing** of the code that already exists,
- no new features are to be invented,
- no gratuitous refactors are to be introduced,
- and the only allowed “movement” is pulling already-proven fixes earlier into the stage where they conceptually belong.

### Proposed five-stage RC spine

1. **stage1 — core inspect panel + stable variable inspection**
   - panel scaffold,
   - host hub,
   - stable source lookup,
   - reload-safe replay,
   - in-place rewrite/restore,
   - strict inspect selection semantics,
   - portable-preview omission from day one,
   - **no split, no hover, no histogram**.

2. **stage2 — shared runtime seams and pause-safe redraw substrate**
   - final-pass interception seam,
   - post-render `afterFrame()` seam,
   - pause-aware single-frame redraw helpers,
   - groundwork for split / hover / histogram without exposing those user features yet.

3. **stage3 — compare split verification**
   - compare split UI,
   - persisted split state,
   - original-vs-inspect final-pass scissor rendering,
   - compare overlay affordances,
   - compact final compare-control layout.

4. **stage4 — hover readback**
   - post-render pixel readback,
   - hover toggle,
   - preview mouse tracking,
   - paused hover redraw correctness,
   - final component-aware pixel display semantics.

5. **stage5 — final histogram system**
   - async full-frame histogram evaluation,
   - raw float capture when available,
   - observed-domain analysis,
   - crop overlays and mapping guides,
   - cadence + sample-density controls,
   - downsampled capture defaults,
   - active-work timing,
   - final stall/drop semantics,
   - final component-aware histogram payloads and UI.

This order intentionally differs from the original chronology.
That is not a bug in the plan; it is the entire point of the distillation.

---

## 1. Distillation principles

The RC branch should follow a few hard rules.

### 1.1 `HEAD` is the semantic truth

The distilled stages should be authored from the **final corrected code path**, not by replaying early-stage commits and hoping later fixes still apply cleanly.

That means:

- use the latest implementation as the donor for behavior,
- use the historical commits as provenance and grouping hints,
- and explicitly pull late fixes earlier when they belong earlier conceptually.

This is the single most important planning decision.
If we ignore it, the RC sequence will reintroduce already-solved regressions and force reviewers to read avoidable churn.

### 1.2 Each RC stage should be “best known version of that scope”

Each distilled stage should represent the cleanest known implementation of the capability introduced at that stage.

Examples:

- stage1 should not repeat the original permissive selection logic when stage5L already proved the final contract should be numeric scalar/vector only;
- stage1 should not emit inspector machinery into standalone HTML when stage5N already proved that this is the wrong scope boundary;
- stage3 should not use the old raw/full-frame compare rewrite if stage5M already replaced it with the superior final-pass split render;
- stage5 should not revive queued histogram overlap handling if stage5R already established that drop-and-report stall semantics are the healthier model.

### 1.3 The RC sequence should optimize reviewer comprehension, not historical purity

The original branch introduced hover before split and histogram before many of its runtime boundaries were fully hardened.

The RC progression should instead surface the feature in a way that reads as intentional:

- first a stable core,
- then shared seams,
- then visible verification,
- then point telemetry,
- then heavy telemetry.

That makes the code review story cleaner and the regression surface easier to reason about.

### 1.4 Stages should compile and test independently

Each stage should be reviewable as a coherent checkpoint:

- buildable,
- testable,
- behaviorally meaningful,
- and not obviously relying on “a fix in the next commit”.

Stage2 is the one stage allowed to be more preparatory than user-visible, but even it should preserve behavior cleanly and be justified as infrastructure for the next three stages.

### 1.5 No doc/reference chores in the RC line

The RC line should contain only code machinery for INSPECT itself:

- preview assembly,
- host state,
- panel UI,
- runtime behavior,
- tests.

No `.github` setup work.
No report commits.
No submodule/worktree chores.

### 1.6 The distillation must stay cherry-pick-like and non-reinventive

This point needs to be absolutely explicit.

The RC effort is **not**:

- a redesign of INSPECT,
- a refactor pass for code cleanliness,
- a chance to introduce new abstractions “because the RC branch is cleaner”,
- a chance to revisit product choices already settled on the branch,
- or a license to land opportunistic improvements unrelated to the already-proven feature.

The RC effort **is**:

- a surgical repackaging of already-existing code,
- a reordering of already-proven fixes so the story reads better,
- a scoped omission of later-stage surfaces until their designated RC stage,
- and a commit-structure cleanup that makes the final PR easier to review.

In practical terms, every RC stage should answer:

1. **Which existing code from the branch does this stage take?**
2. **Which existing code from later commits must be pulled earlier to avoid reintroducing known regressions?**
3. **Which existing code is withheld until later stages only for scope clarity?**

If a stage starts inventing fresh architecture beyond those three moves, it has drifted away from the goal.

---

## 2. Reverse-soak method: how to design the distillation

The user specifically asked to start from the top of the branch and reason backward.
That is the correct method here.

### 2.1 Start with the final architecture, not the first commit

From the final report, the stable INSPECT architecture at `58fca24` has these non-negotiable properties:

1. **The extension host is the sole hub**.
2. **Selection eligibility is explicit and narrow**.
3. **The preview template is thin and placeholder-driven**.
4. **Portable standalone previews omit inspect entirely**.
5. **The preview mutates the final material in place**.
6. **Final-pass interception is the right seam for split compare**.
7. **`afterFrame()` is the right seam for readback work**.
8. **Paused inspect redraws must not advance simulation**.
9. **Histogram work must be async, bounded, and observable under load**.

Those properties should be treated as the RC “constitution”.

### 2.2 Then walk backward to find which late fixes belong earlier

The reverse pass makes the following reordering obvious:

- **stage5N** belongs effectively at RC stage1, not late, because portable-preview omission is a scope boundary, not a polish add-on.
- **stage5L selection gate/type narrowing** belongs at RC stage1, because selection semantics are part of the core contract, not a late optional refinement.
- **stage5C lifecycle + in-place mutation** belongs at RC stage1, because the core feature should not land in a reload-fragile or material-replacement form.
- **stage5P frozen redraw helpers** belong at RC stage2, before split and hover, because both later features depend on them for correct paused behavior.
- **stage5O compare-control layout tightening** belongs with RC stage3, because it is the final UX expression of compare.
- **stage5R stall/drop behavior** belongs directly inside RC stage5, not after it, because the final histogram stage should debut with its mature overload model.

### 2.3 Finally rebuild forward

Only after the reverse soak is done should the RC implementation be assembled forward as five curated stage commits.

That forward build should use:

- the final architecture as the baseline,
- the historical commits as donor buckets,
- and explicit exclusions so each stage stays scoped.

### 2.4 Coverage audit against final `HEAD` functionality

The RC plan should be read as a full-scope coverage map of the final implementation, not as a partial retelling.

| Final `HEAD` capability / agreement | RC stage | Notes |
|---|---|---|
| Dedicated inspect panel + host-mediated IPC | stage1 | Core feature birth must already use the final hub-and-spoke model. |
| Correct shader source lookup | stage1 | Pulled in immediately from historical stage2. |
| Replay-safe inspect state | stage1 | Pulled in immediately from historical stage3 + stage5C. |
| In-place material mutation / restore | stage1 | Should not be deferred. |
| Strict numeric scalar/vector selection gate | stage1 | Pulled in from stage5L. |
| Portable standalone preview omits inspect | stage1 | Pulled in from stage5N. |
| Final-pass interception seam | stage2 | Infrastructure for split. |
| Post-render `afterFrame()` seam | stage2 | Infrastructure for hover and histogram. |
| Frozen paused redraw substrate | stage2 | Pulled in from stage5P before feature stages that need it. |
| Compare split rendering | stage3 | Final scissor-based form from stage5M. |
| Final compare control layout | stage3 | Pulled in from stage5O. |
| Hover readback | stage4 | Final post-render/pause-safe form. |
| Component-aware pixel value display | stage4 | Pulled from stage5L hover-facing semantics. |
| Histogram enablement + async evaluation | stage5 | Historical stage5A/B/F donors, but final form only. |
| Raw float histogram pass | stage5 | From stage5G. |
| Observed-domain histogram semantics + overlays | stage5 | From stage5H. |
| Interval presets + sample-stride controls + tuned defaults | stage5 | From stage5E/I/K. |
| Active-work timing semantics | stage5 | From stage5J. |
| Component-aware histogram payloads/UI | stage5 | From stage5L. |
| Stall/drop overlap handling | stage5 | From stage5R. |

The important reading of this table is simple:

- nothing from the final user-facing feature set is intentionally dropped,
- nothing from the final hardening work is intentionally forgotten,
- only the **presentation order** changes.

### 2.5 Stage5A-R hardening audit

Because the user called out the late `stage5` arc specifically, this plan should state plainly where those lessons go.

| Historical stage | What it taught / fixed | RC destination |
|---|---|---|
| `stage5A` | Histogram proves its value | stage5, concept only; do not replay literal sparse implementation |
| `stage5B` | One snapshot + deferred CPU work | stage5 |
| `stage5C` | Stable lifecycle / in-place mutation / panel replay | stage1 (and stage2 only if a seam is genuinely shared) |
| `stage5D` | Histogram enablement as persistent state | stage5 |
| `stage5E` | Interval presets / replay order cleanup | stage5 |
| `stage5F` | Async full-frame histogram evaluation | stage5, but without keeping queued overlap as the final contract |
| `stage5G` | Raw histogram capture path | stage5 |
| `stage5H` | Observed-domain model and overlay interpretation | stage5 |
| `stage5I` | Sample-stride controls | stage5 |
| `stage5J` | Active-work timing + overhead cleanup | stage5 |
| `stage5K` | Downsampled capture defaults | stage5 |
| `stage5L` | Strict selection + component-aware semantics | split across stage1 / stage4 / stage5 |
| `stage5M` | Compare split final form | stage3 (with seam pieces optionally staged in stage2) |
| `stage5N` | Workbench-only preview scope | stage1 |
| `stage5O` | Final compare-control UX tightening | stage3 |
| `stage5P` | Frozen paused redraw correctness | stage2 foundation, then consumed by stage3/stage4 |
| `stage5R` | Stall/drop overload model | stage5 |

This audit is intentionally explicit: the RC plan does cover the late hardening arc; it just redistributes it into the stages where each piece most naturally belongs.

---

## 3. Proposed RC structure

### 3.1 Stage1 — core inspect panel + stable variable inspection

### Goal

Land the smallest version of INSPECT that is still architecturally correct by final-branch standards.

This stage should already feel like a trustworthy feature, not like an “MVP that will be fixed later”.

### User-visible scope

This stage should provide:

- a dedicated inspect panel,
- selection-driven variable inspection,
- mapping controls,
- stable type display,
- persisted/replayed inspect state across preview/panel rebuilds,
- correct preview rewrite/restore behavior.

This stage should **not** provide:

- compare split,
- hover readback,
- histogram.

### Donor commits

Primary source commits:

- `42cb6b2` — initial panel/IPC/rewrite scaffold
- `606a6ae` — shader source lookup correction
- `236288f` — replay after preview reload
- `d754920` — lifecycle consolidation, `panelReady`/`syncState`, in-place mutation
- `5f6040e` — selection gate / strict type-family semantics
- `dc7e4b0` — standalone omission boundary

### What must be pulled in immediately from later fixes

#### 1. Portable-preview omission from stage5N

This must ship in stage1, not later.

Reason:

- whether inspect belongs in standalone HTML is a **scope decision**,
- not a late polish decision.

If stage1 emits inspect into standalone HTML and stage2/3/4 later remove it, the RC line would be teaching reviewers the wrong product boundary.

#### 2. Final selection contract from stage5L

Stage1 should already use:

- `resolveInspectableSelection(...)`,
- numeric scalar/vector-only eligibility,
- swizzle normalization,
- quiet no-op rejection of invalid/unsupported selections.

Reason:

- selection semantics are the foundation of everything else,
- and the permissive pre-stage5L behavior is not the version we want reviewers to internalize.

#### 3. In-place material mutation from stage5C

Stage1 should not ever present the older “replace the shader material object” model.

It should debut with:

- original material capture,
- original fragment shader capture,
- in-place fragment mutation,
- stable restore logic.

Reason:

- later features all assume this architecture,
- and it avoids teaching a short-lived wrong internal model.

#### 4. Replay-safe panel lifecycle from stage5C

Stage1 should already include:

- `panelReady`,
- `syncState`,
- host-side replay,
- one-time callback wiring.

Reason:

- reload safety is part of “core inspect works”, not an optional add-on.

### Recommended file surface

At minimum, expect stage1 to touch:

- `package.json`
- `src/extension.ts`
- `src/inspectpanel.ts`
- `src/shadertoymanager.ts`
- `src/inspectselection.ts`
- `src/webviewcontentprovider.ts`
- `resources/inspect_panel.html`
- `resources/webview_base.html`
- `resources/webview/shader_inspect.js`
- `test/inspect_runtime.test.ts`
- `test/inspectselection.test.ts`
- `test/webview_split.test.ts`

### Recommended tests in stage1

Stage1 should already protect:

- stable selection acceptance/rejection,
- rewrite/restore in-place behavior,
- replay after preview/panel recreation,
- standalone-preview omission.

### Review focus

Reviewers should be able to answer “yes” to these questions after stage1:

1. Is INSPECT already using its final product boundary?
2. Is INSPECT already using its final selection contract?
3. Is the host already the replay/state authority?
4. Is the preview already using the final in-place mutation model?

If any of those answers is “not yet”, stage1 is too historical and not distilled enough.

---

### 3.2 Stage2 — shared runtime seams and pause-safe redraw substrate

### Goal

Land the shared preview/runtime seams needed by split, hover, and histogram **before** those features appear.

This is the main “prepare the rails” stage.

### User-visible scope

This stage is allowed to be light on new visible behavior.
Its value is architectural: it should make later stages smaller and cleaner.

### Donor commits

Primary source commits:

- `d754920` — remaining lifecycle/runtime cleanup patterns
- `4561f42` — final-pass interception seam (`renderBuffer`) and related runtime structure
- `b2d2350` — pause-safe forced redraw substrate
- `dc7e4b0` — placeholder-driven assembly model, if any remaining pieces are not already pulled to stage1

### What this stage should introduce

#### 1. Final-pass interception seam

`resources/webview_base.html` should expose the hook that later allows compare to intercept the final render pass.

Even if compare is not yet user-visible, the seam should exist cleanly:

- preview render loop asks the inspector whether it wants to render the buffer itself,
- normal rendering proceeds otherwise.

This keeps stage3 focused on compare behavior rather than template surgery.

#### 2. Post-render `afterFrame()` seam

This is the correct place for hover and histogram readback.

Even if stage2 does not yet use it heavily, it should establish the rule:

- input changes intent,
- render loop renders,
- readback happens only after the render boundary.

This keeps stage4 and stage5 from having to mix transport changes with feature logic.

#### 3. `requestPreviewFrame()` and frozen redraw substrate

Stage2 should pull forward the stage5P helper structure:

- centralized redraw requests,
- `freezeSimulationOnNextForcedRender`,
- always pause-aware time advancement policy,
- render-loop branching for frozen final-pass redraws.

The important planning point is that this should exist **before** split and hover land, so those features never exist in a pause-incorrect form in the RC history.

### What this stage should still avoid

Stage2 should still not expose:

- compare split UI,
- hover panel UI/readback,
- histogram UI/readback.

It is infrastructure, not feature surface.

### Why this stage is worth keeping separate

Without this stage, stage3/4/5 would each have to bundle:

- feature logic,
- template seam changes,
- pause semantics fixes,
- and readback/render-path preparation.

That would make the later stages harder to review and would blur why the architecture is shaped the way it is.

### Review focus

After stage2, reviewers should be able to see a stable shared substrate for all later inspect subfeatures:

- a late render seam,
- a late readback seam,
- and a pause-safe redraw seam.

If those seams are still being invented inside stage3/4/5, the distillation is not clean enough.

---

### 3.3 Stage3 — compare split verification

### Goal

Introduce compare in its **final correct form**, not in the old full-frame alternate rewrite form.

### User-visible scope

This stage should add:

- compare enablement,
- persisted compare split state,
- split slider UI,
- preview-local divider/labels overlay,
- side-by-side original-vs-inspect rendering.

### Donor commits

Primary source commits:

- `4561f42` — compare split feature proper
- `98fc03e` — final control layout tightening
- `b2d2350` — compare-related pause-safe redraw behavior

### What this stage must *not* do

It must not revive the early compare idea where compare is implemented as a separate whole-frame rewrite result.

The stage should directly debut with the final model:

- inspect rewrite remains the canonical rewritten output,
- compare is a **presentation-time split render**,
- original material and inspect material coexist,
- scissor/viewport split happens only on the final pass.

### Why split should come before hover in the RC narrative

The original branch introduced hover earlier, but the distilled RC sequence should prefer compare first.

Reasoning:

1. compare is a direct correctness-verification surface for the main inspect rewrite;
2. it is easier to review than readback telemetry because it stays in the render path;
3. it teaches the reviewer the final-pass interception seam immediately after stage2;
4. hover then arrives later as the first post-render telemetry feature.

So stage3 becomes the “visual verification” stage, and stage4 becomes the “point telemetry” stage.

### Stage3 should include the final compare UX, not the intermediate one

That means:

- final checkbox wording,
- split slider bounds and normalization,
- replay-safe state,
- compact control layout,
- canvas overlay affordances.

Do not land a rough compare UI and then polish it later in the RC line; stage3 should already be the polished compare stage.

### Review focus

Reviewers should be able to answer:

1. Is compare clearly layered on top of inspect rather than competing with it?
2. Is compare state replay-safe?
3. Is compare visually understandable immediately?
4. Does compare already respect paused redraw semantics?

If the answer to any of those is “later stage”, the RC split stage is under-distilled.

---

### 3.4 Stage4 — hover readback

### Goal

Introduce hover as the lightweight post-render telemetry feature.

### User-visible scope

This stage should add:

- hover enable/disable toggle,
- live per-pixel readback from the preview,
- panel pixel-value presentation,
- paused hover redraw correctness.

### Donor commits

Primary source commits:

- `440b4be` — initial hover feature
- `b2d2350` — paused hover redraw correctness
- `5f6040e` — final component-aware pixel display semantics

### What should already be true before stage4 starts

Because of stage1 and stage2, stage4 should not need to re-solve:

- state replay architecture,
- source lookup correctness,
- selection eligibility,
- portable-preview boundaries,
- pause redraw substrate,
- afterFrame hook invention.

It should be able to focus on hover itself.

### Final-form hover behavior to use immediately

Stage4 should debut with:

- post-render readback in `afterFrame()`,
- panel toggle,
- mouse tracking in preview space,
- paused redraw requests flowing through the frozen-frame helper,
- component-aware panel labels inherited from final type semantics.

This is important: do not land hover with RGBA-assumption display and then “fix labels later”. The final RC stage should already respect scalar/vector component count at the panel layer.

### Why hover comes after compare

In the distilled story:

- stage3 proves that inspect output is visually comparable to the original frame,
- stage4 then adds point sampling for per-pixel numeric confirmation.

That is a clean reviewer journey:

1. first verify global image-space correctness,
2. then inspect exact pixel values.

### Review focus

Reviewers should be able to say:

- hover is a pure post-render telemetry feature,
- it composes cleanly with pause,
- and its panel semantics match the selected type family.

---

### 3.5 Stage5 — histogram in final optimized form

### Goal

Land the entire histogram system in one final-form RC stage, skipping the historical intermediate shapes that are no longer the desired result.

### User-visible scope

This stage should add the full final histogram feature set:

- histogram enablement,
- cadence presets,
- sample-density controls,
- async evaluation,
- raw float capture when available,
- fallback byte capture when necessary,
- observed-domain scanning,
- crop overlays and mapping guides,
- component-aware payloads,
- tuned defaults,
- explicit stall reporting.

### Donor commits

Primary source commits:

- `b935bc2` — original histogram value proposition
- `9a76384` — single-snapshot/deferred CPU model
- `5803782` — persisted histogram enablement
- `203e05d` — interval presets and replay order
- `37952f7` — async full-frame evaluation
- `704fe4c` — raw float capture path
- `356fffd` — observed-domain model + panel overlays
- `d143f20` — sample-stride controls
- `0b8367f` — timing/overhead cleanup
- `683a025` — downsampled capture defaults
- `5f6040e` — final component-aware histogram semantics
- `58fca24` — drop-and-report stall semantics

### Critical planning rule: do not replay historical histogram stages literally

The RC histogram stage should not recreate the long historical sequence:

- naive sparse sampling,
- then optimized sampling,
- then queued async overlap model,
- then raw capture,
- then observed-domain cleanup,
- then stall/drop cleanup.

Instead, stage5 should land directly with the final desired model.

That means:

- **use stage5B as structural inspiration, but not as the final semantics**;
- **use stage5F for async chunking, but do not keep its queued overlap behavior**;
- **use stage5G/H as the basis for capture/domain correctness**;
- **use stage5I/J/K for operability/cost shaping**;
- **use stage5R as the final overlap contract**.

### Histogram stage should debut with final defaults

Stage5 should start with:

- `200ms` default interval,
- `1:8` default sample stride,
- downsampled raw capture tied to stride,
- active-work `timeMs`,
- stall visibility.

Do not land “older defaults first, then retune”.

### Histogram stage should debut with final semantic model

The stage should already use:

- raw float pass when available,
- observed-domain scan before binning,
- panel-side crop interpretation rather than runtime-side cropping assumptions,
- component-aware domain/bins,
- explicit fallback path when raw float capture is unavailable.

### Histogram stage should debut with final overload contract

The RC line should not teach reviewers that histogram overlap queues are acceptable.

Stage5 should directly use:

- one active histogram evaluation at a time,
- overlapping requests dropped rather than queued,
- the active pass allowed to finish,
- `stalled` telemetry surfaced in the panel.

### Review focus

Reviewers should come away from stage5 thinking:

- “this is already the mature histogram system,”

not:

- “I guess there will be another cleanup pass later”.

If the stage still looks like a prototype plus a future TODO list, the RC distillation failed.

---

## 4. Original commit to RC-stage transposition matrix

The following matrix is the heart of the distillation.
It makes explicit that some original commits should be moved earlier or split across RC stages.

| Original commit | Historical role | RC destination | Notes |
|---|---|---|---|
| `42cb6b2` | Initial scaffold | stage1 | Keep the concept, not the early rough edges. |
| `606a6ae` | Source lookup fix | stage1 | Core correctness; should not be delayed. |
| `236288f` | Reload persistence | stage1 | Core lifecycle correctness. |
| `440b4be` | Hover | stage4 | Hover belongs after split in the distilled story. |
| `b935bc2` | Initial histogram | stage5 | Only as historical donor; do not replay literal sparse model. |
| `9a76384` | Histogram execution rewrite | stage5 | Forms the base async/readback structure. |
| `d754920` | Lifecycle consolidation | mostly stage1, partly stage2 | Pull state/replay/in-place mutation earlier; leave generic seams for stage2 if helpful. |
| `5803782` | Histogram enablement | stage5 | Land directly with mature histogram. |
| `203e05d` | Histogram interval presets | stage5 | Same. |
| `37952f7` | Async full-frame histogram | stage5 | Keep async chunking, not the queued-overlap contract. |
| `704fe4c` | Raw-range histogram capture | stage5 | Final-form histogram core. |
| `356fffd` | Observed-domain overlays | stage5 | Final-form chart semantics. |
| `d143f20` | Sample-stride controls | stage5 | Final histogram control surface. |
| `0b8367f` | Histogram overhead cleanup | stage5 | Final timing/cost semantics. |
| `683a025` | Downsampled capture/defaults | stage5 | Final default posture. |
| `5f6040e` | Type-family tightening | split: stage1 + stage4 + stage5 | Selection gate to stage1; pixel semantics to stage4; histogram component semantics to stage5. |
| `4561f42` | Compare split | split: stage2 + stage3 | Final-pass seam can land in stage2; visible compare lands in stage3. |
| `dc7e4b0` | Portable-preview omission | stage1 | Product boundary from day one. |
| `98fc03e` | Panel layout tightening | stage3 | Bundle with compare stage where it matters most. |
| `b2d2350` | Pause-safe redraws | split: stage2 + stage3 + stage4 | Helper substrate in stage2; feature-specific use in split/hover stages. |
| `58fca24` | Histogram stall/drop finalization | stage5 | Final histogram overload model. |

---

## 5. Why the proposed five-stage order is the right one

### 5.1 Why stage1 is intentionally bigger than the historical stage1

The original stage1 was a real first landing, but it was not yet the stage reviewers should memorize as “the right shape”.

RC stage1 therefore needs to be a **corrected foundation**:

- strict selection semantics,
- stable source lookup,
- replay-safe lifecycle,
- in-place mutation,
- standalone omission.

That is a bigger stage than historical stage1, but it is a better one.

### 5.2 Why stage2 is infrastructure-heavy

This is the stage most likely to look “too internal” if not explained carefully.

It exists because split, hover, and histogram all need:

- the right render/readback seams,
- the right forced-redraw semantics,
- the right pause behavior.

If those are not isolated early, the later stages become muddy feature-plus-plumbing bundles.

### 5.3 Why split comes before hover

The RC order should teach:

1. inspect rewrite,
2. compare verification,
3. point readback,
4. aggregate telemetry.

That is cognitively cleaner than the historical order.

### 5.4 Why histogram is one stage, not several

The historical histogram arc was valuable for discovery, but it is not the cleanest RC story.

Reviewers do not need to relive every intermediate histogram model.
They need one histogram stage that is:

- final,
- performant,
- semantically correct,
- and operationally bounded.

That is why stage5 should be broad.

---

## 6. Recommended implementation workflow for the future RC branch

This section is about **how** to execute the distillation once implementation starts.

### 6.1 Build the RC stages from `HEAD`, not from old commits

Recommended method:

1. create a fresh RC work branch,
2. for each RC stage, start from the final code as donor material,
3. lift only code that already exists on the branch,
4. remove or defer later-stage features intentionally, but do **not** redesign the remaining code,
5. commit the resulting curated snapshot as `stage1`, `stage2`, etc.

This is safer than replaying the original branch from the bottom.

The phrase to keep in mind is:

> **surgical cherry-pick-like distillation, not reinvention**

That means:

- code may be **re-sliced**,
- code may be **moved earlier** when it is already proven and belongs earlier conceptually,
- code may be **withheld until later** for scope clarity,
- but code should not be freshly re-authored just because the new stage order is cleaner.

### 6.2 Use the report as the behavioral checklist

For each RC stage, consult `.github/docs/architecture/inspect-report.md` to verify:

- which architectural seam the feature truly depends on,
- which regressions were historically discovered later,
- which final semantics must be folded in immediately.

The report should be treated as the provenance ledger; the RC plan should be treated as the reassembly guide.

### 6.3 Keep tests aligned with stage scope

Each RC stage should bring in the tests that prove its own contract:

- stage1: selection/rewrite/replay/standalone omission
- stage2: infrastructure behavior if directly testable
- stage3: compare split interception and persisted split state
- stage4: hover readback and paused hover redraw behavior
- stage5: histogram full payload, async behavior, defaults, stride, stall

Do not defer a stage’s protection to a later stage if the contract already exists.

### 6.4 Avoid “temporary” intermediate semantics

Examples of what **not** to do in the RC line:

- do not reintroduce loose float-default selection inference before tightening it later,
- do not reintroduce inspect in standalone exports before removing it later,
- do not reintroduce compare as a rewrite mode before converting it to final-pass split,
- do not reintroduce queued histogram overlap before replacing it with stall/drop.

Add one more broad rule above all of those:

- do not use the RC effort as an excuse to refactor code that is already working if that refactor is not required to slice the existing implementation into the planned stages.

Those would be historical reenactments, not RC distillation.

---

## 7. Stage-by-stage acceptance checklist

### 7.1 Stage1 acceptance

- panel exists and is replay-safe,
- selection is strict and normalized,
- preview rewrite/restore is stable,
- standalone export omits inspect,
- no split/hover/histogram surface exists yet.

### 7.2 Stage2 acceptance

- render-buffer interception seam exists,
- `afterFrame()` seam exists,
- pause-safe redraw substrate exists,
- stage1 behavior still works unchanged.

### 7.3 Stage3 acceptance

- compare split is persisted and replayed,
- compare renders original vs inspect side by side on the final pass,
- compare respects paused redraw rules,
- compare UI is already in final compact form.

### 7.4 Stage4 acceptance

- hover readback works live,
- paused hover redraw does not advance simulation,
- panel pixel display matches inspected component count.

### 7.5 Stage5 acceptance

- histogram is async and full-frame,
- raw float capture path is used when available,
- observed-domain overlays are correct,
- cadence and stride controls are replay-safe,
- defaults are `5Hz` / `1:8`,
- overlap is dropped rather than queued,
- `STALL` is visible when overload occurs.

---

## 8. Final recommendation

The distilled RC line should be treated as a **reverse-designed release narrative**, not a historical replay and not a redesign.

The best initial proposal is:

1. **stage1** — stable inspect core, with final scope boundaries and final selection semantics already in place
2. **stage2** — shared render/readback/pause substrate
3. **stage3** — compare split verification
4. **stage4** — hover readback
5. **stage5** — final histogram system

That arrangement best satisfies all of the stated goals:

- easier to digest,
- meaningful progression,
- self-contained checkpoints,
- no lost late-branch fixes,
- explicit coverage of the full final UX/behavior set,
- explicit carry-forward of the `stage5A`-`stage5R` hardening lessons,
- and a clearly stated **cherry-pick-like, surgical, non-reinventive** execution discipline,
- and no need to relive regressions that the branch already solved.

This should be treated as the initial planning baseline for review and iteration, not as an immutable final answer.

---

## Appendix A — File-level slicing guide

This appendix translates the stage plan into concrete per-file, per-stage mechanical instructions. The donor is always the final code at `58fca24`, not historical intermediate forms.

**Notation:** "include" = cherry-pick the final version of that code. "Withhold" = the code exists at HEAD but must not appear until a later stage. "Stub" = leave an empty or no-op placeholder where later-stage code will go.

### A.1 Stage1 — what each file should contain

| File | Action | Include | Withhold until |
|---|---|---|---|
| `package.json` | Include inspect command declaration | `shader-toy.showInspectPanel` command entry | — |
| `src/extension.ts` | Include command registration | `registerCommand` delegation to `showInspectPanel()` | — |
| `src/inspectselection.ts` | **Include entire file** as-is from HEAD | Full type resolution, swizzle normalization, eligibility gate | — |
| `src/inspectpanel.ts` | Include full file, **but** only wire callbacks that exist at stage1 | `setOnMappingChanged`, `setOnReady`, `setOnDidDispose`, `postInspectorState`, `postVariableUpdate`, `postStatus` | `setOnCompareChanged` / `setOnCompareSplitChanged` → stage3; `setOnHoverChanged` → stage4; `setOnHistogramChanged` / `setOnHistogramIntervalChanged` / `setOnHistogramSampleStrideChanged` → stage5 |
| `src/shadertoymanager.ts` | Include inspect state fields + selection listener + panel wiring + replay | `_lastInspectorVariable`, `_lastInspectorLine`, `_lastInspectorType`, `_lastInspectorMapping`; `startSelectionListener()`; `configureInspectPanel()` for mapping + ready; `resendInspectorState()` for mapping + variable + inspectorOn; `resendInspectPanelState()` for mapping only | Compare fields/routing → stage3; hover fields/routing → stage4; histogram fields/routing → stage5 |
| `src/webviewcontentprovider.ts` | Include placeholder-driven assembly + `omitInspectorContent` for standalone | Inspector message routing (mapping + on/off + variable only); `omitInspectorContent`; `inspectorFinalPass` and `inspectorAfterFrame` as **empty stubs** for stage1 | Full message routing for compare/hover/histogram → stages 3/4/5 |
| `resources/webview_base.html` | Include placeholders, render loop otherwise unchanged | All four `<!-- Inspector ... -->` placeholder lines; no active inspector logic in stage1 beyond message routing | `renderFrozenFrameOnly` logic → stage2; `renderBuffer` interception → stage2; `afterFrame` call → stage2 |
| `resources/webview/shader_inspect.js` | Include core engine only | Lines 1–744 approximately: type inference, shader rewriting, `rewriteForInspector`, `getShaderSource`, `doInspection`, `restoreOriginal`, `postStatus`, `markShaderMaterialDirty`, `updateInspection`, basic `handleMessage` (variable/mapping/on/off only) | Compare rendering → stage3; hover readback → stage4; histogram pipeline → stage5; `requestPreviewFrame` → stage2 |
| `resources/inspect_panel.html` | Include core UI only | Status display, variable/type display, mapping controls (mode/min/max/clamp), `panelReady`/`syncState` | Compare toggle/split slider → stage3; pixel readback section → stage4; histogram canvas/controls → stage5 |
| `test/inspect_runtime.test.ts` | Include stage1-relevant tests only | `rewrites the original material in place`, `restores the original fragment shader`, `ignores non-variable inspector targets`, `accepts integer inspector targets`, `rejects unsupported bool inspector targets`, `normalizes vector component selections` | Compare test → stage3; hover/pause tests → stage4; histogram tests → stage5 |
| `test/inspectselection.test.ts` | **Include entire file** | All 3 test cases | — |
| `test/webview_split.test.ts` | Include standalone omission test | `Portable preview omits inspector runtime and hooks` | Pause-aware rendering test → stage2 |

### A.2 Stage2 — what changes vs stage1

Stage2 is **infrastructure only**. It adds the render-loop seams that stages 3–5 consume.

| File | Change from stage1 |
|---|---|
| `resources/webview_base.html` | Activate the three render-loop seams: (1) `renderBuffer()` interception before `renderer.render()` in the final-buffer loop iteration; (2) `afterFrame()` call after the final buffer; (3) `renderFrozenFrameOnly` logic with `freezeSimulationOnNextForcedRender` flag so paused preview only redraws the final pass. These are the exact lines from HEAD. |
| `resources/webview/shader_inspect.js` | Add `requestPreviewFrame()` (line 744), the `renderBuffer()` function as a **no-op stub** that always returns `false` (the real compare logic comes in stage3), and `afterFrame()` as a **no-op stub** (hover/histogram come later). Expose them on `window.ShaderToy.inspector`. |
| `src/webviewcontentprovider.ts` | Replace the empty-stub `inspectorFinalPass` and `inspectorAfterFrame` with the real placeholder injections from HEAD. |
| `test/webview_split.test.ts` | Add `pauseWholeRender still emits paused-aware time advancement` test. |

**Stage2 adds no new user-visible behavior.** A user interacting with the extension sees the same inspect panel as stage1. The seams are inert until activated by stages 3–5.

### A.3 Stage3 — what changes vs stage2

| File | Change from stage2 |
|---|---|
| `resources/webview/shader_inspect.js` | Replace `renderBuffer()` no-op with the real compare split implementation (lines 976–1014 at HEAD): scissor/viewport split, `_compareSplit`, `_compareMode`, `syncCompareOriginalMaterial`, `disposeCompareOriginalMaterial`, `ensureCompareOverlay`, `updateCompareOverlay`, `normalizeCompareSplit`, `buildCompareShader`, `rewriteForCompare`. Wire compare messages in `handleMessage`. |
| `resources/inspect_panel.html` | Add compare toggle, compare split slider, compare split display, compact compare-control layout (the final form from stage5O, not an intermediate). |
| `src/inspectpanel.ts` | Wire `setOnCompareChanged`, `setOnCompareSplitChanged` callbacks. Include compare fields in `postInspectorState()` / `syncState`. |
| `src/shadertoymanager.ts` | Add `_lastCompareEnabled`, `_lastCompareSplit`; wire compare callbacks; add compare to `resendInspectorState()` and `resendInspectPanelState()`. Route `setInspectorCompare` / `setInspectorCompareSplit` to preview. |
| `src/webviewcontentprovider.ts` | Add `setInspectorCompare` / `setInspectorCompareSplit` to inspector message routing. |
| `test/inspect_runtime.test.ts` | Add `renders compare mode as a split between original and inspected output` and `requests a frozen redraw for compare split updates while paused`. |

### A.4 Stage4 — what changes vs stage3

| File | Change from stage3 |
|---|---|
| `resources/webview/shader_inspect.js` | Activate hover in `afterFrame()`: `setupHoverReadback()`, `_hoverEnabled`, `_mouseX`/`_mouseY`/`_mouseInCanvas`, single-pixel `gl.readPixels` in `afterFrame`. Wire `setInspectorHover` in `handleMessage`. Hover redraw requests flow through `requestPreviewFrame()`. |
| `resources/inspect_panel.html` | Add pixel readback section: color swatch, component-aware RGBA values, hover toggle. |
| `src/inspectpanel.ts` | Wire `setOnHoverChanged`. Add `postPixelValue()`. Include hover in `postInspectorState()` / `syncState`. |
| `src/shadertoymanager.ts` | Add `_lastHoverEnabled`; wire hover callback; add hover to replay; route `setInspectorHover` to preview; relay `inspectorPixel` from preview to panel. |
| `src/webviewcontentprovider.ts` | Add `setInspectorHover` to inspector message routing. |
| `test/inspect_runtime.test.ts` | Add `requests a redraw for hover updates while paused`. |

### A.5 Stage5 — what changes vs stage4

| File | Change from stage4 |
|---|---|
| `resources/webview/shader_inspect.js` | Add the entire histogram pipeline in final form: `snapshotForHistogram`, `startHistogramProcessing`, `drainQueuedHistogram`, `cancelHistogramWork`, `ensureHistogramByteBuffer`, `ensureHistogramFloatBuffer`, `canUseRawHistogram`, `syncHistogramMaterial`, `disposeHistogramResources`, `ensureHistogramTarget`, `getHistogramCaptureDimensions`, `postHistogram`, `getStableDomain`, `toDisplayValue`, `scheduleHistogramWork`, `requestHistogramUpdate`, `requestHistogramUpdateNow`, `startHistogramTimer`, `stopHistogramTimer`, `normalizeHistogramInterval`, `normalizeHistogramSampleStride`, `getNowMs`. Activate histogram branch in `afterFrame()`. Wire histogram messages in `handleMessage`. Use final stall/drop semantics from stage5R, final defaults from stage5K (200ms/1:8), final component-aware binning from stage5L. |
| `resources/inspect_panel.html` | Add histogram canvas, cadence preset buttons (1Hz/5Hz/10Hz), sample stride buttons (1:1/1:8/1:64), histogram stats (samples, timeMs, STALL marker), `drawHistogram()` with component-aware channels, `drawCropOverlays()`, mapping curve guides. |
| `src/inspectpanel.ts` | Wire `setOnHistogramChanged`, `setOnHistogramIntervalChanged`, `setOnHistogramSampleStrideChanged`. Add `postHistogram()`. Include histogram fields in `postInspectorState()` / `syncState`. |
| `src/shadertoymanager.ts` | Add `_lastHistogramEnabled`, `_lastHistogramIntervalMs`, `_lastHistogramSampleStride`; wire histogram callbacks; add to replay; route `setInspectorHistogram` / `setInspectorHistogramInterval` / `setInspectorHistogramSampleStride` to preview; relay `inspectorHistogram` from preview to panel. |
| `src/webviewcontentprovider.ts` | Add histogram message types to inspector message routing. |
| `test/inspect_runtime.test.ts` | Add all histogram tests: `toggles histogram capture`, `defaults histogram refresh to 5Hz`, `defaults histogram sample stride to 1:8`, `histogram reports the observed raw domain`, `histogram sample stride reduces the analyzed sample count`, `finishes the active histogram and marks it stalled`. |

---

## Appendix B — Build and test gates per stage

Each stage must pass these gates before the next stage begins.

| Stage | `npm run compile` | `npm test` — expected inspect test count | Key assertions |
|---|---|---|---|
| stage1 | ✅ clean | 6 runtime + 3 selection + 2 webview_split = **11** | Rewrite/restore, selection gate, standalone omission |
| stage2 | ✅ clean | 11 + 1 pause test = **12** | All stage1 tests still pass, pause-aware rendering verified |
| stage3 | ✅ clean | 12 + 2 compare tests = **14** | Compare split rendering, frozen compare redraw |
| stage4 | ✅ clean | 14 + 1 hover test = **15** | Paused hover redraw |
| stage5 | ✅ clean | 15 + 6 histogram tests + 2 webview_split = **23** | Full histogram pipeline, stall, stride, defaults |

**Critical rule:** If `npm run compile` fails at any stage, the stage is incomplete. If previously-passing tests fail, the stage has introduced a regression. Both conditions must be resolved before proceeding.

Note: 23 unrelated worktree test failures exist in the full suite (`pr217`, `pr218`, `wip#sound-synth`). These are pre-existing and not caused by inspect code.

---

## Appendix C — Git workflow for the RC branch

### C.1 Branch setup

```bash
# Start from master (the merge-base), not from the feature branch
git checkout master
git checkout -b rc/fragcoord-inspect

# The donor for all code is the feature branch HEAD
# Use `git show 58fca24:path/to/file` to extract donor content
```

### C.2 Per-stage commit flow

For each RC stage:

1. Extract the relevant file content from `58fca24` using `git show 58fca24:path/to/file`
2. Surgically edit to withhold later-stage features per Appendix A
3. Run `npm run compile && npm test` to verify gates per Appendix B
4. Commit with message: `stage{N}: {description}`

### C.3 Extraction, not authorship

The per-stage editing should be **subtractive from HEAD**, not additive from scratch:

- Start with the full final file content
- Remove/stub features that belong to later stages
- Never invent new code — only remove, comment, or stub

This keeps the process cherry-pick-like: you are always working with proven code, just controlling when it appears.

### C.4 Commit message convention

```
stage1: core inspect panel with strict selection and replay-safe state
stage2: shared render-loop seams and pause-safe redraw substrate
stage3: compare split verification with persisted state
stage4: hover pixel readback with pause-safe redraws
stage5: final async histogram with stall-aware evaluation
```
