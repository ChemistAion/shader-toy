# RC Plan (Condensed 4‑Stage Progression)

## Purpose
This plan condenses the full journey into four reviewable stages that map directly to the current HEAD functionality (Stage6–8) while minimizing legacy noise. Each stage is split into A/B/C steps that are self‑contained and suitable for PR review.

> Scope rule: Only include work that survives in HEAD. Audio output is **AudioWorklet‑only** (no fallback render path). If the worklet is unavailable, compile shaders but emit **no audio**, and surface a VS Code error popup. Self‑sound semantics are **not supported** and must be excluded from the start.

> Scope note: Demos and tests are out of scope for this plan. Leave them untouched during the RC stages; add/refresh them in a separate, dedicated pass after the core plan is complete.

---

# Stage 1 — Foundations (Scaffold for Real‑Time Audio + Hot Reload)
**Goal:** Establish minimal, clean scaffolding that matches the intended final architecture without legacy detours.

## Stage1A — Core Audio Surface
- Create a minimal audio output surface: `AudioContext`, gain node, basic output routing.
- Standardize essential uniforms (`iSampleRate`, `iAudioTime`, `iSampleBlockSize`, `iSampleRingDepth`).
- Define a minimal sound shader contract: `mainSound(int sample, float time)`.

**Deliverable:** A stable API surface for sound shaders and the core WebAudio graph.

## Stage1B — Buffer Model & Metadata (Worklet‑first)
- Introduce the sound buffer metadata model (names, indices, formats).
- Validate `#iSoundN` / `#iSampleN` parsing and routing metadata.
- Do not implement or keep any offline render fallback.

**Deliverable:** Metadata + parsing that anticipates streaming and worklet usage.

---

# Stage 2 — Hot Reload (Clean, Stage6‑aligned)
**Goal:** Implement reliable reload without forcing real‑time streaming yet.

## Stage2A — Dependency‑Aware Reload
- Keep the webview alive across edits.
- Reload shader buffers based on dependencies.
- Preserve state (mouse, time, camera) across reloads.

**Deliverable:** A deterministic edit‑compile‑refresh loop.

## Stage2B — Error‑Safe Reload UX
- Ensure shader compile errors surface without tearing down the preview.
- Maintain overlay and error messaging on reload.

**Deliverable:** Safe reload behavior that remains stable for later real‑time work.

## Stage2C — Audio Engine Continuity
- Keep audio routing intact through reloads.
- Ensure analyzer routing can rebuild safely after reload.

**Deliverable:** Reload spine that survives the later worklet/streaming layers.

---

# Stage 3 — AudioWorklet + Streaming (Condensed Stage7)
**Goal:** Replace offline render with stable streaming while keeping UX clear and minimal.

## Stage3A — Worklet Scaffold + Loader Reliability
- Add worklet processor and creation pipeline.
- Implement robust module loading (inline blob → fetch+blob → direct URL).
- Expose worklet readiness and fail states (status lines, diagnostics).

**Deliverable:** Reliable worklet engine that can survive hot reload.

## Stage3B — Streaming Pipeline (Block Producer/Consumer)
- Implement block‑based GPU rendering and push to worklet queue.
- Define queue target and under‑run behavior.
- If worklet is unavailable, do not render audio (compile only) and surface a VS Code error popup.

**Deliverable:** Real‑time streaming audio output.

## Stage3C — Multi‑Source Mixing + Audio Stats Extraction
- Support multiple `#iSoundN` sources and mixing (equal weight).
- Keep stats overlay extracted (no UI), but retain data for debugging.

**Deliverable:** Stable multi‑source streaming without UI clutter.

---

# Stage 4 — Sample Access + Precision (Condensed Stage8)
**Goal:** Provide per‑sound sample access and precision control without special cases.

## Stage4A — Ring Buffers + Sample Access
- Add per‑sound ring buffer textures.
- Expose `iSampleRingN` and `#iSampleN` bindings.
- Provide helper include for sample index math (no self‑overloads).

**Deliverable:** Consistent sample history access across sounds.

## Stage4B — Precision Overrides
- Support `#iSoundN::Format` and `#iSound::Format` (current shader).
- Preserve global precision as default with per‑sound overrides.

**Deliverable:** Clean precision layering without special markers.

## Stage4C — Final Pass (No “self”)
- Enforce explicit indexing only (`#iSoundN`, `#iSampleN`).
- Remove all self‑sound semantics and demos.
- Verify docs and demos match this final contract.

**Deliverable:** RC‑ready API surface with no legacy side paths.

---

# Review Checklist per Stage


# Addon — Explicit Self‑Binding for iSoundN / iSampleN (Future Extension)

> This addon describes an **explicit** and **index‑based** self‑binding design. It does **not** re‑introduce indexless self semantics. The intent is to keep the RC plan’s clarity while enabling a controlled, explicit self‑routing option later.

## Goals
- Allow a shader to bind its own output **only through an explicit index** (`#iSoundN`) and an explicit sample binding (`#iSampleN`).
- Avoid implicit or indexless “self” behaviors. No `#iSound "self"` and no indexless `#iSample`.
- Preserve the existing worklet‑only, streaming audio pipeline.

## Non‑Goals
- No automatic self mapping without a declared index.
- No changes to the existing audio worklet architecture or the mixing model.
- No implicit use of current shader context unless explicitly bound.

## Proposed Directive Semantics
### 1) Explicit self binding (index‑based only)
Example (sound shader):
```
#iSound2 "self"
#iSample2 selfSamples
```
This means:
- The sound shader declares **self** at an explicit index (here, index 2).
- `#iSample2 selfSamples` binds the **ring buffer** written by that same index (a feedback loop over history only).
- No implicit resolution occurs; the author must choose the index explicitly.

### 2) Reservation rule
Once a sound shader claims index `N`, that index is **reserved** for that shader in the current shader set. It cannot be reused by any other `#iSoundN` within the same root to avoid ambiguity.

### 3) Validation rules
- `#iSoundN "self"` is the **only** allowed self declaration.
- `#iSampleN` must reference an existing `#iSoundN` in the same root.
- Duplicate `#iSoundN` remains an error.
- If `#iSampleN` references a missing `#iSoundN`, emit a directive error.
- Explicit indices only; **no indexless variants**.

## Implementation Steps (Addon Stage S)
### S‑1 — Parser + Buffer Metadata
- Parser: keep existing `#iSoundN` / `#iSampleN` grammar; no indexless additions.
- BufferProvider: enforce that `#iSampleN` references a known `#iSoundN` in the same root.
- Add a short diagnostic hint when the index is missing or mismatched.

### S‑2 — Reservation + Binding Enforcement
- Ensure that a root shader cannot bind the same `#iSoundN` twice.
- If `#iSampleN` exists but the corresponding `#iSoundN` is absent, surface a VS Code popup and webview overlay error (per Stage7H guidelines).

### S‑3 — Documentation and Examples (separate pass)
- Document the explicit self‑binding pattern as a **strict, index‑based** rule.
- Provide examples that show a safe, explicit self‑loop using `#iSoundN` + `#iSampleN` only.
- Avoid any mention of indexless “self” semantics.

---

# Addon — Buffer/Latency Guidance for #1/#2/#3

This section captures the practical guidance discussed for the current pipeline’s three data paths.

## #1 — Per‑Sound GPU Render Block (Write Head)
- **Purpose:** Current block per sound; used for mixing and for writing the ring buffer.
- **One block per sound** at a time (no multi‑block pool).
- **Size guidance:** Favor moderately sized 2D blocks that balance GPU efficiency and latency.
	- Good starting points: **256×256** or **512×256** for throughput.
	- Smaller blocks reduce latency but can be inefficient due to draw/readback overhead.
- **Latency note:** block latency is $blockSamples / sampleRate$, where $blockSamples = width \times height$.

## #2 — Per‑Sound Ring Buffer Texture (History)
- **Purpose:** History window for `#iSampleN` sampling inside shaders.
- **Size:** `width = blockWidth`, `height = blockHeight × ringDepth`.
- **Ring depth controls history:** $historySamples = blockSamples \times ringDepth$.
- **Guidance:** Ring depth should be independently selectable (e.g., 2, 4, 8, 16, 32, 64).

## #3 — Mixed Output Queue (AudioWorklet)
- **Purpose:** Playback queue for mixed stereo blocks.
- **Block size:** Same as #1.
- **Queue target:** 2 blocks for lower latency; 4 blocks for stability.
- **Note:** Queue depth is the main latency multiplier on top of block size.

## Practical Takeaways
- Smaller blocks reduce latency but increase overhead.
- Larger ring depth increases history without changing latency.
- Worklet queue depth controls playback stability vs latency.

- Stage1 ↔ Early scaffolding (from audiosetup.md, but aligned to streaming end‑state).
- Stage2 ↔ Hot reload (hotreload.md, Stage6).

---

## Final RC Outcome
- Clean, linear progression that mirrors the current HEAD.
- No leftover experimental branches (self‑sound or any offline fallback paths).
- Ready for review as a staged, readable pull request series.

---

## Noise & Regression Notes (Top‑Down Pass)
These notes summarize paths that added churn or regressions and should be avoided in RC work. Ordered from Stage8 → Stage1.

### Stage8 (Sample access + precision)
- **Self‑sampling branch:** Explicitly out of scope. Do not add `#iSound "self"`, indexless `#iSample`, or self helper overloads at any stage.
- **Helper overloads:** The `sampleSound(int sampleIndexAbsolute)` overload tied to `iSoundIndex` blurred semantics and encouraged hidden coupling. Keep only indexed helpers.
- **Docs drift:** Early Stage8 docs described “self” rules. These are now superseded by Stage8H; avoid mixing old guidance with final rules.

### Stage7 (Worklet + streaming)
- **Status UI overlay:** The in‑webview stats overlay created UI noise and was removed (extraction: audio‑stats). Keep stats as data only.
- **Worklet load reliability:** Module load failures in strict webviews led to fallback loader paths. Keep the inline blob → fetch+blob → direct URL chain to avoid regressions.
- **No fallback audio:** If the worklet cannot be created or loaded, emit no audio and surface a VS Code error popup. Do not re‑introduce offline render paths.

### Stage6 (Hot reload)
- **Analyzer routing gaps:** Hot reload initially dropped analyzer wiring when starting from sound‑only previews. The fix required always‑present update loops and a rebuild step. Avoid shortcuts that skip this.
- **State loss across reload:** Any reload path that tears down the preview loses UX state; the Stage6 “reload spine” must be preserved.

### Stages1–5 (Early scaffolding)
- **Monolithic offline buffers:** Exclude entirely. RC is worklet‑only for audio output.
- **Over‑engineering upfront:** Several early iterations tried to predict real‑time needs too early. The RC plan should keep Stage1 minimal and aligned with later streaming.

> Reader takeaway: The RC path is the minimal sequence that reaches current HEAD without re‑introducing the above detours. Treat these as explicit “do‑not‑revive” branches.
