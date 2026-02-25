# Hot Reload (Stage 6)

## Overview
This document covers the dedicated hot‑reload phase that bridged the static audio pipeline (Stages 1–5) and the real‑time work (Stages 7–8). Stage 6 established the core reload mechanics without changing the audio rendering model (still offline/pre‑render at this stage).

> Retrospective note: Stage 6 was intentionally self‑contained. It delivered hot reload without forcing real‑time streaming or AudioWorklet adoption.

---

# Stage6 — Hot Reload Foundation
**Goal:** Keep the webview alive across shader edits and refresh the preview safely.

### What changed
- Introduced dependency‑aware reload of shader buffers.
- Preserved UI state and input state across reloads (mouse, time, camera where applicable).
- Ensured shader compilation errors surfaced without tearing down the preview.

### Behavior
- Reloaded the webview’s shader state without requiring a full view restart.
- Audio output remained offline/pre‑render (no streaming yet).

---

## Key Outcomes
- Reliable edit‑compile‑refresh loop for shader development.
- Stable base for later work on AudioWorklet + streaming.

---

## Relationship to Stage7–8
- Stage7–8 rely on Stage6 for continuity of the audio engine across edits.
- Stage6 is the “reload spine” on top of which real‑time audio was later layered.

---

## Retrospective
- Hot reload in Stage6 was the minimum viable foundation.
- Later stages expanded functionality but kept this core model intact.
