# Audio Setup (Stages 1–5)

## Overview
This document captures the early audio implementation phases before real‑time streaming, ring buffers, AudioWorklet, and hot reload. These stages were intentionally minimal, proving the feasibility of sound shaders and establishing a stable baseline. Later stages (6–8) evolved this into hot reload + real‑time streaming.

> Retrospective note: Stages 1–5 were scaffolding to validate the concept. Real‑time behavior and advanced routing were explicitly deferred to later stages (7–8).

---

# Stage1 — Minimal Audio Output (Proof of Concept)
**Goal:** Play any sound shader output at all.

### What changed
- Introduced a basic WebAudio graph (AudioContext + BufferSource).
- Rendered audio offline into a single buffer and played it back.
- Fixed sample‑rate wiring for shaders (`iSampleRate`).

### Behavior
- One‑shot pre‑render to buffer, then playback.
- No streaming, no worklet, no hot reload.

### Notes
- This established the “audio exists” baseline.

---

# Stage2 — Stable Offline Rendering
**Goal:** Make pre‑rendering consistent and predictable.

### What changed
- Standardized block size and render target shape.
- Ensured stereo output for all mainSound shaders.
- Improved error handling for missing shader sources.

### Behavior
- Deterministic offline render length and playback.

---

# Stage3 — Multi‑Buffer Awareness (Non‑Real‑Time)
**Goal:** Recognize multiple sound shaders without real‑time mixing.

### What changed
- Added the basic ability to enumerate sound buffers.
- Prepared metadata pathways (names, indices) for future mixing.

### Behavior
- Still offline rendering; multi‑buffer work was preparatory only.

---

# Stage4 — Early Routing + Diagnostics
**Goal:** Improve UX for audio setup errors and routing.

### What changed
- Better error messages for unsupported configurations.
- Diagnostics for precision and WebGL2 requirements.

### Behavior
- Still pre‑render only; no live update.

---

# Stage5 — Baseline “Static Audio” Completion
**Goal:** Lock the non‑realtime baseline before hot reload work.

### What changed
- Consolidated the offline render pipeline.
- Stabilized buffer creation and playback semantics.
- Confirmed that sound shaders render reproducibly with correct timing.

### Behavior
- Pre‑rendered audio only.
- No hot reload, no streaming, no ring buffers.

---

## Retrospective: Why this path
- These stages validated that sound shaders worked end‑to‑end.
- The design explicitly deferred real‑time streaming and hot reload to later stages.
- The work created a stable baseline that later stages could safely refactor.

---

## Relationship to Stage6–8
- Stage6 added hot reload (separate doc).
- Stage7–8 introduced AudioWorklet, streaming, ring buffers, and sample access.
- This document should be read as the “pre‑real‑time” foundation.
