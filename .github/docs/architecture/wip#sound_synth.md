# `wip#sound_synth`

Analysis target: local ref `origin/wip#sound-synth` at `9a862cc` (`2026-01-30`, `stage8G: move sampling demo and refresh docs`).

## Scope and evidence

- Historical precursor used for comparison: `wip#sound` at `f75ea0a`.
- Actual merge-base to both `wip#sound` and all later RC refs: `784238419c9a6bbf310649bc115a283fc508ac8b`.
- This is therefore not the literal ancestor of `rc1#sound_synth`; it is the first full sound-synth branch in the family, and later RC branches are parallel rewrites from the same base.
- Primary code evidence:
  - `src/bufferprovider.ts @ origin/wip#sound-synth`
  - `src/shaderparser.ts @ origin/wip#sound-synth`
  - `src/shaderlexer.ts @ origin/wip#sound-synth`
  - `src/typenames.ts @ origin/wip#sound-synth`
  - `src/webviewcontentprovider.ts @ origin/wip#sound-synth`
  - `resources/webview/audio_output.js @ origin/wip#sound-synth`
  - `resources/webview/audio_worklet_processor.js @ origin/wip#sound-synth`
  - `resources/webview_base.html @ origin/wip#sound-synth`
  - `demos/synth/*.glsl @ origin/wip#sound-synth`

## Intent

This branch tried to turn the earlier `wip#sound` proof-of-concept into a real feature family:

- explicit sound shader declarations via `#iSoundN`
- GPU-produced stereo audio streamed through an `AudioWorklet`
- multi-source mixing
- hot reload for sound graphs
- shader-visible sample metadata and direct sample bindings
- demo coverage and parser diagnostics strong enough to support ongoing iteration

## Baseline

Conceptually, the baseline is `wip#sound`: a simpler branch that detected `mainSound`, rendered large GPU audio blocks, bound one sound channel, and added a sound toggle UI. Architecturally, however, `origin/wip#sound-synth` is already a substantial rewrite rather than a small incremental patch series. The changed-file set jumps from a single offline-ish synth pipeline to a larger parser/runtime system with worklet streaming, tests, and multi-source bookkeeping.

## Architectural representation

The representation model in `origin/wip#sound-synth` is ambitious and internally mixed.

- Sound shaders are promoted to first-class parsed objects by extending the lexer/parser with `ObjectType.Sound`, `ObjectType.SoundFormat`, and `ObjectType.Sample`.
- `BufferDefinition` grows sound-specific fields:
  - `IsSound`
  - `SoundIndices`
  - `SoundPrecision`
  - `SampleBindings`
- `#iSoundN "file://...glsl"` maps a GLSL file into the sound graph.
- `#iSound "self"` is allowed as a special case. This creates an indexless self-sound mode that the later RC branches spend time trying to remove.
- `#iSampleN name` and `#iSample name` bind the current sample to a generated `uniform vec2`.
- `mainSound(float)` and `mainSound(int, float)` are both accepted by injecting adapter wrappers in `BufferProvider`.

The result is expressive, but it carries two separate representation layers for history access:

- direct current-sample bindings via `#iSample`
- internal ring-buffer state managed in the runtime, but not yet exposed as the later `iSampleRingN` sampler model

That split is the core architectural tension of this branch.

## Machinery introduced

### Parse and type system

- `src/shaderlexer.ts` learns `iSound` and `iSample`.
- `src/shaderparser.ts` parses indexed sound directives, `#iSound::Format`, and named sample bindings.
- `src/bufferprovider.ts` resolves sound shader files, injects `mainSound` compatibility shims, tracks `selfSoundPrecisions`, and registers `SampleBindings`.

### Runtime state and orchestration

- `resources/webview/audio_output.js` introduces a dedicated synth runtime:
  - `state.sampleRing`
  - `state.workletNode`
  - `state.stream`
  - mixed-source audio rendering
  - gesture-aware playback setup
- `resources/webview/audio_worklet_processor.js` adds an early queue-driven worklet, but its `need` contract is still block-count oriented instead of absolute-sample oriented.
- `src/webviewcontentprovider.ts` starts treating `buffer.IsSound` as a trigger for extra webview modules, sound button setup, and worklet injection.

### Shader-visible state

- `src/extensions/preamble_extension.ts @ origin/wip#sound-synth` adds:
  - `iAudioTime`
  - `iSampleBlockSize`
  - `iSampleRingDepth`
- `src/extensions/buffers/buffers_init_extension.ts @ origin/wip#sound-synth` wires those uniforms into every buffer material.
- `src/extensions/audio/audio_output_precision_extension.ts` introduces transport precision selection.

### Reliability work

- `test/isound_audio.test.ts` covers parser/runtime expectations.
- `test/hot_reload_deps.test.ts` covers dependency-aware reload behavior.
- Several stage7-stage8 commits harden directive errors, popups, and sound-only hot reload.

## Commit progression

### Setup and parser spine

- `72162e1 builder`
- `d7e2d3a stage1: audio module scaffold + mainSound detection`
- `73a9773 stage2: GPU playback wiring + WebGL2-only synth`
- `13276ca stage3: #iSound precision + sound channel routing fixes`

This phase converts `wip#sound` from a prototype into a branch with explicit sound directives and a dedicated synth runtime.

### UI, analysis, and demos

- `967ffc9 stage4: sound toggle UI + settings polish`
- `1894fac stage5: stereo audio analyzers for iChannel sound`
- `29034d7 demo: basic sudio synths and visualizer`
- `b6bfc60 test: cover #iSound + sound channel cases`

This phase broadens the surface area quickly. It improves usability, but it also increases the number of moving parts before the core representation has stabilized.

### Reload and worklet transition

- `b721058 stage6: shaders hot-reload with dependency-tree awareness`
- `4d05e9c test: hot-reload dependency awareness`
- `a1a4d06` through `bc679a8` stage7A-stage7I

This is the most important technical block. It introduces:

- AudioWorklet scaffolding
- GPU block streaming
- multi-source mixing
- RMS analysis
- time synchronization
- stricter directive validation
- sound-only hot reload stabilization

### Sampling pass

- `4a4e6cd extraction: audio-stats`
- `3d17df1` through `0f51e53` stage8A-stage8F
- `9a862cc stage8G: move sampling demo and refresh docs`

This phase adds sample metadata and direct sample bindings, then ships demos for sampling and self-sampling.

## Improvements over `wip#sound`

- Moves from one coarse GPU-rendered sound path to a branch-wide sound graph model.
- Replaces ad hoc playback with an `AudioWorklet` pipeline.
- Introduces test coverage for parser and reload behavior.
- Makes sound participation explicit in the buffer/type model.
- Adds dependency-aware hot reload, which is mandatory for iterative shader authoring.
- Supports multiple sound buffers and multi-source mixing instead of a single demo path.

## Regressions and drawbacks

- The representation is over-extended. `#iSound`, `#iSound "self"`, `#iSound::Format`, `#iSample`, and internal sample-ring state all coexist.
- `#iSample` binds a single current sample as a `vec2`, but stage8 also introduces ring-buffer machinery. The feature model is therefore split between a direct-value API and a history-buffer runtime.
- The worklet protocol still asks for block counts rather than an explicit `wantBaseSample`, which makes the worklet a weaker clock source than in the later RC designs.
- `selfSoundPrecisions` and indexless self-sound handling couple parser rules to special cases that later branches repeatedly try to remove.
- `audio_output.js` is already very large and mixes scheduling, shader wrapper generation, readback, stats, UI state, and error handling.
- The stats overlay is intentionally disabled in code while status strings and popups carry debugging burden. That is poor observability for a system this stateful.

## Side explorations

- `demos/synth/echo_iSound.glsl` and `demos/synth/sampling_iSound.glsl` document conceptual helpers before the representation fully settles.
- `extraction: audio-stats` splits stats logic out mid-stream, which shows the runtime had already become difficult to reason about monolithically.
- Multiple stage7 commits harden popup behavior instead of first shrinking the state model.

## Carry forward

- Sound shaders should remain explicit, indexed graph members rather than magical post-processing hooks.
- The worklet must remain the real audio output path; fallback playback paths should not silently mask failures.
- Dependency-aware hot reload is mandatory.
- Gesture-aware startup, queue-aware rendering, and multi-source mixing are valid requirements.
- The branch correctly discovered that sample history needs a first-class representation; later branches simply represent it better.

## Reject

- Reject indexless `#iSound "self"` semantics.
- Reject `#iSample` as the long-term shader API for sample history.
- Reject the block-count-only `need` contract.
- Reject the combination of parser special cases plus runtime hidden state for the same concept.
- Reject a monolithic `audio_output.js` that owns every concern.

## Distilled conclusion

`origin/wip#sound-synth` is the branch where the feature becomes real, but also the branch where almost every future design trap is first introduced. Its value is not in its final representation; its value is in proving the necessary machinery domains:

- parser support
- shader-to-runtime mapping
- worklet streaming
- hot reload for sound graphs
- sample history as an actual requirement

The later RC branches should be read as repeated attempts to keep those machinery wins while deleting the representational excess.
