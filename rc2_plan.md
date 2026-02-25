# RC2 Plan (rc2#sound_synth)

> Goal: distill the **current HEAD behavior** from rc1#sound_synth into a clean, minimal progression with **no detours** or re‑introducing regressions. This plan is a staging blueprint for a “from‑scratch but direct” reconstruction of the final state.

---

## Executive Summary

Yes — the current report and local history are sufficient to build a distilled RC2 plan. The rc1summary.md report plus the sequence of stage/patch/final commits provides enough information to **re‑express the final state directly** without intermediate backtracking.

**Recommended number of stages: 6.**
- 4 stages would be too coarse and would mix high‑risk and low‑risk changes (harder to review, higher regression risk).
- 6 stages allow a clean separation of: parsing + reload, worklet streaming, ring history + precision, message‑port pipeline refinements, shader embedding safety, and performance/diagnostics.

This yields **small, self‑contained commits** with explicit review boundaries and a controlled risk envelope.

---

## RC2 Plan (6 stages)

### Stage 1 — Core parsing + reload spine (foundation)
**Objective:** establish directive parsing, buffer graph, and hot reload “spine” without streaming‑specific changes.

**Scope (must match HEAD behavior):**
- Parse `#iSoundN` and `#iSampleN` (explicit indices only).
- Preserve strict directive errors and overlay diagnostics pathway.
- Hot reload that preserves state and does not tear down the webview.
- Preserve end‑user UI elements and behavior: pause, reload, screenshot, record, sound toggle.
- Preserve gesture‑gated audio start and “forced pause until gesture” UX.

**Key outcomes:**
- Parsing is strict and explicit (no indexless sound/sample).
- Reload is stable and survives future audio work.

---

### Stage 2 — AudioWorklet scaffold + streaming base
**Objective:** bring up AudioWorklet and block streaming on the main thread, but without message‑port refinements.

**Scope:**
- Worklet loader (inline blob → fetch+blob → direct URL).
- Worklet node + status lines for readiness/fail states.
- Streaming pipeline “need → render → push” (basic block flow).
- Audio output is **worklet‑only** (no fallback audio output).
- Keep the **sound button** semantics identical (mute/unmute through the gain node).

**Key outcomes:**
- Real‑time audio streaming enabled.
- Worklet lifecycle resilient.

---

### Stage 3 — Ring buffers + precision controls
**Objective:** bring in sample history and precision controls in a single, coherent step.

**Scope:**
- Per‑sound ring buffer textures (`iSampleRingN`).
- `iSampleRingBlockSize`, `iSampleRingDepth` uniforms wired to shaders.
- Global precision setting (`audioOutputPrecision`), including 8bPACK.
- Ensure all demos/helpers rely on ring buffers only (no legacy iSample bindings).

**Key outcomes:**
- Deterministic sample history access.
- Unified precision model.

---

### Stage 4 — Message‑port pipeline refinements
**Objective:** implement the message‑port target flow with block alignment and buffer pool reuse (rc1 final1–final4 distilled).

**Scope:**
- Configurable audio block size (`audioBlockSize`).
- Worklet “need” includes `wantBaseSample` + `framesWanted`.
- Main thread renders from absolute base sample.
- Pooled planar stereo buffers + recycle path.
- Worklet stats posted back (queueFrames, underruns).

**Key outcomes:**
- Accurate, queue‑aware scheduling.
- Reduced allocation churn.
- Stats available for diagnostics.

---

### Stage 5 — Safe shader embedding + placeholder safety
**Objective:** harden shader embedding against JS parse errors; stabilize webview script placeholders.

**Scope:**
- Store shader/include source in non‑executable containers (textarea).
- Hot reload replaces all shader/include nodes (not just scripts).
- Safe defaults for placeholder values (block size + sound button).
- Preserve **pause/reload/sound** button wiring as‑is in the webview template.

**Key outcomes:**
- Fixes `Unexpected token 'const'` class regressions.
- Eliminates HTML placeholder parse breakage.

---

### Stage 6 — Performance + debug overlay (optional but included in RC2)
**Objective:** capture final optional optimizations and developer‑friendly diagnostics.

**Scope:**
- WebGL2 PBO+fence readback path with safe fallback to readPixels.
- Debug overlay (multiline, live stats) instead of popup noise.
- Overlay includes pool, block size, queue depth, underruns, precision, and readback info.
- Keep the overlay always‑on as in rc1 HEAD (no popups; overlay only).

**Key outcomes:**
- Reduced GPU stalls.
- Continuous, in‑preview diagnostics.

---

## Why 6 stages is the right cut

- **Stage 1** isolates parsing + reload (stable foundation; low risk).
- **Stage 2** isolates worklet/streaming (high impact; clean review boundary).
- **Stage 3** isolates ring buffers + precision (medium risk, tightly coupled).
- **Stage 4** isolates message‑port refinements and pooling (timing‑sensitive).
- **Stage 5** isolates shader embedding safety (previous regression root cause).
- **Stage 6** isolates performance/diagnostics (optional but valuable; lowest functional risk).

This mirrors the real dependencies while avoiding the rc1 detours (self‑sampling experiments, temporary regressions, placeholder breakages).

---

## RC2 Acceptance Criteria (global)

1) **AudioWorklet‑only** output path. No fallback audio output if worklet fails.
2) **Explicit indexing** for `#iSoundN` / `#iSampleN`. No indexless forms.
3) **Deterministic hot reload** with state preservation.
4) **Ring buffer history** always available for sample‑based DSP.
5) **Precision controls** unified and stable (`audioOutputPrecision`, 8bPACK).
6) **No JS parse regressions** from shader embedding.
7) **Optional PBO readback path** with fallback.
8) **Overlay diagnostics** in preview, not popup noise.
9) **UI parity** with rc1 HEAD: pause/reload/sound/screenshot/record buttons unchanged.
10) **Gesture gating** matches rc1 HEAD (forced pause + gesture‑unlock flow).

---

## Notes on migration from rc1

- Self‑sampling experiments from rc1 are **not part of RC2**.
- All demos should be updated in a separate, post‑RC2 pass (per rc_plan.md scope rules).
- Overlay diagnostics are considered a **debug feature**; keep it small and non‑intrusive.

---

## Recommended next action

Create branch **rc2#sound_synth** and implement in 6 stages above, each as a clean, reviewable commit series. Each stage should be logically atomic and should compile/run independently.
