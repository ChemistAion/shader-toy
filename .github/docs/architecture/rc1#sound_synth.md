# `rc1#sound_synth`

Analysis target: local ref `rc1#sound_synth` at `c41a37b` (`2026-02-03`, `final5: PBO readback + debug overlay`).

## Scope and evidence

- Actual merge-base against both `origin/wip#sound-synth` and `rc2#sound_synth`: `784238419c9a6bbf310649bc115a283fc508ac8b`.
- This branch is conceptually the successor to `origin/wip#sound-synth`, but in git topology it is another full re-implementation from the shared pre-sound base.
- Primary evidence:
  - `src/shaderparser.ts @ rc1#sound_synth`
  - `src/bufferprovider.ts @ rc1#sound_synth`
  - `src/typenames.ts @ rc1#sound_synth`
  - `src/webviewcontentprovider.ts @ rc1#sound_synth`
  - `resources/webview/audio_output.js @ rc1#sound_synth`
  - `resources/webview/audio_worklet_processor.js @ rc1#sound_synth`
  - `resources/webview_base.html @ rc1#sound_synth`
  - `messageport_audio_pipeline.md @ rc1#sound_synth`

## Intent

`rc1#sound_synth` tries to distill the large `origin/wip#sound-synth` experiment into an RC-grade architecture:

- explicit message-port streaming
- absolute-sample scheduling
- visible debug overlay
- shader-visible ring samplers instead of ad hoc current-sample bindings
- more deterministic hot reload and transport precision control

## Baseline

Compared with `origin/wip#sound-synth`, the branch deliberately narrows the representation and strengthens the runtime contract. Compared with actual git ancestry, it is not a patch series on top of `origin/wip#sound-synth`; it is a restart with a clearer target architecture.

## Architectural representation

The key representation change is the move away from `#iSample`.

- `src/shaderparser.ts @ rc1#sound_synth` rejects `#iSample` entirely by removing that grammar path.
- The shader-visible history model becomes:
  - `iSampleRing0` through `iSampleRing9`
  - `iSampleRingBlockSize`
  - `iSampleRingDepth`
  - `iSoundIndex`
- `#iSound::Format` is also rejected at parse time in favor of the global setting `shader-toy.audioOutputPrecision`.

This is a substantial improvement over `origin/wip#sound-synth`: one sampler-based history model replaces the prior mixture of direct sample uniforms and hidden ring state.

However, the representation is not fully clean yet.

- `src/bufferprovider.ts @ rc1#sound_synth` still accepts `#iSoundN "self"` when the directive is explicitly indexed.
- `messageport_audio_pipeline.md @ rc1#sound_synth` says "No self-sound special semantics."
- The code and the design note therefore diverge. The runtime model was simplified, but the source-level contract was not simplified as much as the note claims.

## Machinery introduced

### Worklet clock and message protocol

`resources/webview/audio_worklet_processor.js @ rc1#sound_synth` is the first branch in the family where the worklet clearly becomes the clock owner.

- It tracks `playheadSample`, `queueFrames`, `needInFlight`, and `underruns`.
- `need` messages carry:
  - `wantBaseSample`
  - `framesWanted`
  - `queueFrames`
  - `underruns`
- `recycle` messages return transferred buffers to the main thread.

This is the right scheduling direction and is materially stronger than the block-count protocol in `origin/wip#sound-synth`.

### Buffer-pool transport

`resources/webview/audio_output.js @ rc1#sound_synth` introduces:

- planar stereo transfer buffers
- a reusable `bufferPool`
- configurable block-size injection
- render-ahead request handling through `requestBlocksFromNeed`

That cuts allocation churn and gives the main thread a real transport contract with the worklet.

### Debuggability

`final5: PBO readback + debug overlay` is the other defining contribution.

- PBO + fence readback is wired when supported.
- A persistent in-webview debug overlay exposes pool state, render block stats, queue depth, underruns, precision summary, and worklet state.

This is a major step up in observability.

### Webview assembly integration

`src/webviewcontentprovider.ts @ rc1#sound_synth` adds:

- `AudioBlockSizeExtension`
- `AudioOutputPrecisionExtension`
- `AudioWorkletUrlExtension`
- `AudioWorkletSourceExtension`
- `ShowSoundButtonExtension`
- sound-button modules gated on `buffer.IsSound`

The clean point here is that sound-synth becomes a first-class webview assembly mode rather than a hidden special case in the runtime template.

## Commit progression

### Parsing and hot-reload spine

- `f24bc26 stage1: parse sound/sample directives`
- `5d50d0d stage2: hot reload pipeline`

The branch starts by locking down directive grammar and reload behavior.

### Streaming and ring model

- `711577e stage3: audio worklet streaming`
- `ab7a1c6 stage4: sample ring bindings`
- `6035c0c demo: basic audio synths, effects, and visualizer`

This is the point where the representation decisively shifts from `#iSample` bindings to ring samplers.

### Patch hardening

- `29093a5 patch1: restore audio UI + gesture flow; AudioWorklet-only`
- `fbef57b patch2: gesture gating + explicit play`
- `30828e2 patch3: fix iSample demo usage`
- `df7937c patch4: drop iSample bindings, use iSampleRing`
- `c934caf patch5: global audio precision + 8bPACK`
- `484edb4 patch6: ring block history streaming`
- `4449cc1 patch7: self echo demo + output priming`

These commits convert the branch from a conceptually cleaner redesign into an actually usable feature branch.

### Final transport and diagnostics

- `e45cf8e final1: configurable audio block size`
- `02dc90f final2: worklet base-sample requests`
- `b3b51e8 final3: buffer pool + recycle`
- `2569d5a final4: worklet stats`
- `62ebd1f fix: safe shader embedding + audio block init`
- `c41a37b final5: PBO readback + debug overlay`

This phase gives the branch its strongest lasting ideas.

## Improvements over `origin/wip#sound-synth`

- Replaces `#iSample` with a uniform sampler-based history model.
- Gives the worklet explicit clock ownership through `wantBaseSample`.
- Introduces pooled transferable buffers and recycle handling.
- Makes diagnostics visible inside the preview instead of relying on status strings alone.
- Adds an explicit block-size configuration path.
- Turns transport precision into a single global configuration knob instead of per-directive branching.

## Regressions and drawbacks

- The branch note claims self-sound semantics are gone, but the code still accepts `#iSoundN "self"`.
- Default block size in `src/webviewcontentprovider.ts @ rc1#sound_synth` is `65536`, which is far too large for responsive preview audio. The runtime is technically more correct, but the default latency budget is poor.
- `showErrorAtLineAndMessage` in `src/bufferprovider.ts @ rc1#sound_synth` still routes errors to VS Code popups and accumulates `webviewErrors`; this is intrusive for a feature that already has an in-preview overlay.
- The branch still retains a giant `audio_output.js`, even though the scheduling contract is now good enough to justify further separation.
- Because the branch is another rewrite from the common base, it carries knowledge-reset cost: every future fix has to be re-applied by branch comparison rather than by straightforward ancestry.

## Side explorations

- `messageport_audio_pipeline.md` is an explicit architecture note and is valuable, but it must be read as aspirational. It does not perfectly describe the source tree as committed.
- The self-echo demo keeps self-sound alive as a local proof even after the design note tries to declare it gone.

## Carry forward

- Worklet-owned clock with `wantBaseSample`.
- Transferable planar stereo buffer pool and `recycle`.
- Ring sampler representation as the canonical shader-facing history model.
- In-preview debug overlay and readback-path visibility.
- AudioWorklet-only policy.

## Reject

- Reject documentation that outruns the code.
- Reject the `65536` default block size.
- Reject popup-heavy error delivery once overlay diagnostics exist.
- Reject retaining explicit self-sound support if the design goal is to forbid it.

## Distilled conclusion

`rc1#sound_synth` is the first branch in the family that has a coherent architecture worth preserving. Its best contribution is not any individual demo; it is the combination of:

- absolute-sample scheduling
- sampler-based sound history
- pooled transfer buffers
- worklet stats and debug overlay

Its remaining problems are mostly cleanup failures: self-sound not fully removed, latency defaults too large, and documentation drifting ahead of actual code.
