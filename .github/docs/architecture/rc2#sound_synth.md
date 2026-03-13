# `rc2#sound_synth`

Analysis target: local ref `rc2#sound_synth` at `864f5c2` (`2026-02-04`, `patch2: gesture UX + pause integrity`).

## Scope and evidence

- Actual merge-base against the sound family remains `784238419c9a6bbf310649bc115a283fc508ac8b`.
- The branch is conceptually the next RC step after `rc1#sound_synth`, but again it is not built on top of rc1 in git ancestry.
- Primary evidence:
  - `src/shaderparser.ts @ rc2#sound_synth`
  - `src/bufferprovider.ts @ rc2#sound_synth`
  - `src/webviewcontentprovider.ts @ rc2#sound_synth`
  - `resources/webview/audio_output.js @ rc2#sound_synth`
  - `resources/webview/audio_worklet_processor.js @ rc2#sound_synth`
  - `resources/webview_base.html @ rc2#sound_synth`
  - `rc2impl_report.md @ rc2#sound_synth`

## Intent

`rc2#sound_synth` tries to keep the strong runtime ideas from `rc1#sound_synth` while repairing three persistent failure classes:

- hot-reload fragility
- webview parse safety
- gesture / pause UX regressions

It also tries to harden the transport layer and make the debug/readback story more explicit.

## Baseline

Compared with `rc1#sound_synth`, the major architectural move is not a new representation; it is a cleanup pass over the existing ring-sampler + worklet model. The branch is therefore best read as a stabilization rewrite, not as a new conceptual branch.

## Architectural representation

The representation model is mostly inherited from rc1:

- `#iSoundN` remains the entry point for sound shaders.
- `#iSample` is explicitly rejected in `src/shaderparser.ts @ rc2#sound_synth`.
- shader-visible history remains `iSampleRingN`, `iSampleRingBlockSize`, `iSampleRingDepth`, and `iSoundIndex`.

The main source-level cleanup is that `src/bufferprovider.ts @ rc2#sound_synth` now rejects `#iSound "self"` outright:

- `#iSound "self" is not supported; use an explicit file path.`

That is a better design choice than rc1.

However, the representation is still not internally consistent:

- `src/shaderparser.ts @ rc2#sound_synth` still parses `#iSound::Format`.
- `src/bufferprovider.ts @ rc2#sound_synth` still stores `selfSoundPrecisions` when `soundIndex === -1`.
- But `#iSound "self"` is already forbidden.

So the branch deletes self-sound at the user-facing layer, yet leaves self-format plumbing alive in the parser/type/runtime model. That is dead representational baggage.

## Machinery introduced and refined

### Transport hardening

`resources/webview/audio_output.js @ rc2#sound_synth` keeps the rc1 worklet contract and adds safer recycling:

- recycled buffers are size-checked against `bufferPool.blockBytes`
- queue and underrun stats remain worklet-driven
- `requestBlocksFromNeed` still uses absolute-sample requests

This is a good correction. Pause/reset transitions had already shown that unvalidated recycle paths were too fragile.

### Hot reload and template safety

The most valuable rc2-specific work is in the reload and embedding path.

`rc2impl_report.md @ rc2#sound_synth` correctly documents two important hardening passes:

- patch1: safe shader embedding and placeholder safety
- patch2: gesture UX cleanup and pause integrity

The durable ideas are:

- GLSL payloads should not live in JS-parsed containers
- hot reload must replace shader/include nodes explicitly
- resource-root changes must be tracked and may require webview recreation
- gesture lock should be represented inside the preview, not as external popup noise

### Readback-path reporting

`resources/webview/audio_output.js @ rc2#sound_synth` starts tracking readback mode explicitly:

- `Readback path: readPixels`
- `Readback path: pbo+fence`

That is useful because readback mode is a first-order performance characteristic for GPU audio generation.

## Commit progression

### Stages 1-4: transport and ring model

- `d435032 rc2 stage1: parsing + hot reload spine`
- `e13905c rc2 stage2: AudioWorklet scaffold + streaming base`
- `6396d25 rc2 stage3: ring buffers + precision controls`
- `739a7fb rc2 stage4: message-port pipeline refinements`

This is the rc1 design rewritten with a cleaner implementation target.

### Stage 5: reload safety

- `d2d1b9f rc2 stage5: hot reload dependency awareness`

This is the real centerpiece of the branch. It converts reload correctness from an incidental concern into an explicit subsystem.

### Stage 6 and patches

- `7afa956 rc2 stage6: performance + overlay`
- `a750ee0 demos: basic audio synths, effects, and visualizer`
- `0503e1a patch1: webview syntax fixes + safe shader embedding`
- `864f5c2 patch2: gesture UX + pause integrity`

This phase turns the branch from technically correct-but-brittle into a more reviewable RC.

## Improvements over `rc1#sound_synth`

- Removes explicit self-sound from the user-facing directive model.
- Adds recycle-path size validation.
- Makes safe shader embedding an explicit design constraint.
- Improves gesture gating and pause semantics.
- Strengthens resource-root and reload handling.
- Makes readback-mode visibility more explicit.

## Regressions and drawbacks

- The dead `selfSoundPrecisions` path remains, so the representation is still partially contradictory.
- `resources/sound_on.png`, `resources/sound_off.png`, `src/extensions/user_interface/sound_button_extension.ts`, and `src/extensions/user_interface/sound_button_style_extension.ts` disappear in rc2. The branch therefore regresses the dedicated sound toggle UI while still carrying sound-specific runtime state and a `ShowSoundButtonExtension`.
- A large amount of architecture knowledge lives in `rc2impl_report.md`, not only in the code. That is useful for analysis, but it is also a warning sign that the implementation remained difficult to read directly.
- Like the earlier branches, rc2 is another rewrite from the common base rather than an incremental continuation. Maintenance cost remains high.

## Side explorations

- Patch1 explicitly re-imports safe embedding ideas from rc1, which shows the rewrite process was not monotonic.
- Patch2 focuses on UX safety and pause correctness rather than introducing new representation ideas, which is the right kind of late-stage work.

## Carry forward

- Keep indexed `#iSoundN` only.
- Keep the worklet/base-sample contract from rc1.
- Keep the recycle buffer size guard.
- Keep safe non-script GLSL embedding.
- Keep gesture-lock UX inside the preview.
- Keep dependency-aware hot reload and resource-root tracking.

## Reject

- Reject dead format/self state after self-sound has been removed.
- Reject removing the sound toggle UI while sound output remains active.
- Reject branches that rely on extensive narrative reports to explain contradictions still present in code.

## Distilled conclusion

`rc2#sound_synth` is the cleanup branch that discovers the real non-audio blockers of the feature:

- safe embedding
- reload correctness
- gesture and pause integrity
- buffer reuse edge cases

Its best contribution is not a new representation; it is the realization that the synth pipeline is only viable if the surrounding webview machinery is made equally rigorous. Its main flaw is that it still leaves dead representational paths alive and temporarily regresses the dedicated sound UI.
