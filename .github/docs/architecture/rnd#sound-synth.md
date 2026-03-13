# `rnd#sound-synth`

Analysis target: local branch `rnd#sound-synth` at `8dfb843` (`2026-03-13`, `chore: agents setup`).

## Scope and current baseline

- Runtime/code baseline is still `origin/master` at `82d1665`.
- The branch delta against `origin/master` is `.github`-only; there is no sound-synth code in the current branch tip.
- Current untracked local notes observed during analysis:
  - `sound-synth#OLDIES.md`
  - `pass1-prompt.md`
  - `pass2-ideas.md`
- Those note files were used as local context, not as code evidence.

Primary current-code evidence:

- `src/bufferprovider.ts @ rnd#sound-synth`
- `src/shaderparser.ts @ rnd#sound-synth`
- `src/shadertoymanager.ts @ rnd#sound-synth`
- `src/webviewcontentprovider.ts @ rnd#sound-synth`
- `src/extensions/audio/audio_init_extension.ts @ rnd#sound-synth`
- `src/extensions/buffers/buffers_init_extension.ts @ rnd#sound-synth`
- `src/extensions/preamble_extension.ts @ rnd#sound-synth`
- `resources/webview/*.js @ rnd#sound-synth`

## Current branch intent

`rnd#sound-synth` is the clean implementation branch, not another old experimental sound branch. The codebase on this branch is the current project machinery plus `.github` setup work. That is exactly why it is the right place to distill the old sound-synth history: it gives a modern master-based baseline without inherited runtime debt.

## Current project machinery relevant to sound-synth

The current project is a modular shader-preview system with clear integration seams.

### Parse layer

- `src/shaderparser.ts @ rnd#sound-synth` parses:
  - `#include`
  - `#iVertex`
  - `#iChannelN`
  - texture parameters
  - `#iUniform`
  - `#iKeyboard`
  - `#iFirstPersonControls`
  - `#StrictCompatibility`
- It does not parse `#iSound`, `#iSample`, or sound precision directives.

### Buffer graph layer

- `src/bufferprovider.ts @ rnd#sound-synth` still resolves:
  - include graphs
  - buffer dependencies
  - self-feedback for visual buffers
  - audio files as analyzer-backed `AudioInputs`
- It does not carry:
  - `IsSound`
  - `SoundIndices`
  - `SoundPrecision`
  - `SampleBindings`

### Webview assembly layer

- `src/webviewcontentprovider.ts @ rnd#sound-synth` assembles the preview from extension modules.
- The audio path is the legacy audio-input path:
  - `AudioInitExtension`
  - `AudioUpdateExtension`
  - `AudioPauseExtension`
  - `AudioResumeExtension`
- No synth-specific modules are present:
  - no `audio_output.js`
  - no `audio_worklet_processor.js`
  - no sound-button extensions
  - no audio block-size extension

### Runtime layer

- `src/extensions/audio/audio_init_extension.ts @ rnd#sound-synth` decodes audio files into `AnalyserNode` textures for `iChannelN`.
- `src/extensions/buffers/buffers_init_extension.ts @ rnd#sound-synth` exposes only legacy `iSampleRate`, not synth-history uniforms.
- `resources/webview_base.html @ rnd#sound-synth` and `resources/webview/*.js @ rnd#sound-synth` provide the current split runtime used by master, including the `FramesPanel` timing path.

This baseline is important: the current branch has a mature extension-assembly architecture, but no residual sound-synth burden. That means the new implementation can be reintroduced cleanly through existing seams instead of by editing a monolithic template.

## Representation evolution across branches

### `wip#sound` precursor

- Single early proof-of-concept.
- Detects `mainSound`.
- Uses a simpler `#iSound` model and large GPU-rendered blocks.
- Valuable only as prehistory.

### `origin/wip#sound-synth`

- First full sound-synth branch.
- Adds `#iSoundN`, indexless `#iSound "self"`, `#iSound::Format`, and `#iSample`.
- Adds sound flags to `BufferDefinition`.
- Introduces worklet streaming, multi-source mixing, and internal sample-ring state.
- Representation is powerful but overgrown.

### `rc1#sound_synth`

- Removes `#iSample` and standardizes on ring samplers.
- Moves scheduling to `wantBaseSample` and a worklet-owned playhead.
- Rejects inline format directives in parser notes, but still leaves explicit indexed self-sound alive in code.
- First truly coherent architecture.

### `rc2#sound_synth`

- Keeps ring samplers and absolute-sample scheduling.
- Publicly rejects `#iSound "self"`.
- Hardens hot reload, safe embedding, and gesture UX.
- Still leaves dead self-format plumbing behind the scenes.

### `origin/rc3#sound_synth`

- Keeps rc2 representation.
- Extracts wrapper generation into `audio_shader_wrapper.js`.
- Restores dedicated sound UI.
- Lowers default audio block size to a practical value.

### `rnd#sound-synth`

- No sound-synth representation is present yet.
- This is the correct clean-room baseline for a new implementation.

## Machinery evolution

### Data model

- `wip#sound-synth` expands `BufferDefinition` with `IsSound`, `SoundIndices`, `SoundPrecision`, and `SampleBindings`.
- `rc1` removes `SampleBindings` and converges on a ring-sampler history model.
- `rc2` and `rc3` keep `SoundPrecision` but carry dead self-precision state.
- `rnd` has none of these fields, which is desirable for a clean restart.

### Control flow

- `wip#sound-synth`: worklet asks for block counts.
- `rc1` onward: worklet becomes the explicit clock via `wantBaseSample`.
- `rnd`: current master has no synth flow, but it already has modular render-loop and webview message infrastructure.

### State handling

- `wip#sound-synth`: large central state object with mixed concerns.
- `rc1`: adds queue stats, pool state, and overlay.
- `rc2`: adds safer recycle validation and better gesture/pause state.
- `rc3`: reduces wrapper-related coupling.
- `rnd`: current state handling is cleaner overall because synth state does not exist yet.

### Orchestration

- Old sound branches drove orchestration from a giant `audio_output.js`.
- Current master drives orchestration from `WebviewContentProvider` plus split `resources/webview/*.js`.
- This is a major architectural opportunity: the new synth should be introduced as a module family, not as one giant runtime file.

### Debuggability

- `wip#sound-synth`: limited, status-heavy, overlay disabled.
- `rc1`: debug overlay and worklet stats become first-class.
- `rc2`: reload safety and readback-path reporting improve.
- `rc3`: overlay content and wrapper separation improve.
- `rnd`: existing master already has a diagnostics-friendly extension/runtime split and a `FramesPanel`; synth should integrate into that idiom.

## Regressions map

- `wip#sound-synth`
  - representation regression: `#iSample` and hidden ring state coexist
  - architectural regression: indexless self-sound becomes a parser special case
  - maintainability regression: `audio_output.js` owns too many concerns

- `rc1#sound_synth`
  - semantic regression: design note says self-sound is gone, code still accepts `#iSoundN "self"`
  - complexity regression: default block size is far too large
  - UX regression: error popups remain despite overlay support

- `rc2#sound_synth`
  - representation mismatch: self-sound is rejected, but self-format state remains
  - maintainability regression: sound toggle UI temporarily disappears
  - partial refactor: a lot of architecture knowledge migrates into a report instead of fully into code shape

- `origin/rc3#sound_synth`
  - partial refactor: dead self-format path still survives
  - process regression: still another rewrite from the common base instead of a converged continuation

## Obstacles and design traps

- Representation trap: trying to support both direct current-sample bindings and history textures.
- Special-case trap: letting `self` exist in parser, type model, and precision handling after the main model has become indexed and explicit.
- Over-abstraction trap: too many directive forms before the worklet transport model stabilized.
- Hidden coupling trap: giant runtime files that combine wrapper generation, readback, scheduling, UI, and error reporting.
- Reload trap: safe shader embedding and DOM replacement are not optional in a webview-based system.
- Process trap: repeated rewrites from a common base slow convergence because fixes are re-derived instead of inherited.

## Stable findings

- Sound shaders must be explicit indexed graph members.
- The worklet must own the audio clock.
- Sample history is necessary and should be represented as shader-visible ring samplers.
- Transferable pooled buffers are the right transport shape.
- PBO/fence readback is worth keeping as an optional optimization.
- Gesture-aware startup and explicit play/pause semantics are required.
- Debug overlay and runtime telemetry are mandatory for reviewability.
- Safe non-script embedding for GLSL is mandatory.

## Rejected findings

- Reject indexless `#iSound "self"`.
- Reject `#iSample` as the long-term shader-facing history API.
- Reject dual precision models that mix global config with dead inline format paths.
- Reject popup-centric diagnostics for runtime-state issues.
- Reject one-file synth runtimes that hide orchestration boundaries.

## Final distilled design for a new clean implementation

### Final representation

- Parse only explicit `#iSoundN "file://...glsl"` directives.
- Do not support indexless `#iSound "self"`.
- Canonical shader entry point should be `vec2 mainSound(int sampleIndex, float sampleTime)`.
- A compatibility shim for legacy `mainSound(float)` can exist during migration, but it should not be the primary public model.
- Expose history through:
  - `iSampleRing0`..`iSampleRing9`
  - `iSampleRingBlockSize`
  - `iSampleRingDepth`
  - `iSoundIndex`
- Use one transport precision policy, preferably a global configuration setting, until a real per-sound need is proven.

### Final machinery

- Add synth-specific parse objects and type fields back into `BufferProvider` and `typenames`, but only for the indexed model above.
- Introduce synth-specific webview modules through `WebviewContentProvider`, not through ad hoc template edits.
- Keep a dedicated worklet processor with:
  - `playheadSample`
  - `queueFrames`
  - `needInFlight`
  - `underruns`
  - `need { wantBaseSample, framesWanted }`
  - `recycle`
- Keep pooled planar stereo transfer buffers.
- Keep optional PBO/fence readback when supported.
- Keep debug overlay and stats inside the preview.
- Reuse the current master split-runtime style under `resources/webview/*` instead of recreating a monolith.

### Design invariants

- WebGL2-only for synth output.
- AudioWorklet-only for synth output.
- Worklet is the timing authority.
- Indexed directives only.
- One canonical history model.
- No hidden self-sound semantics.
- No JS-parsed GLSL containers.

### Reviewability constraints

The clean branch should be reviewable in phases:

1. parser and type model
2. webview assembly hooks
3. worklet protocol
4. GPU block render and readback
5. history textures and uniforms
6. UI, gesture gating, overlay, and diagnostics
7. demos and tests

Each phase should compile and leave the branch in an understandable intermediate state.

### Migration map

- `wip#sound-synth` parser support for explicit sound shaders: refined, not copied verbatim
- `wip#sound-synth` `#iSample`: removed
- `rc1` worklet base-sample protocol: kept
- `rc1` ring sampler model: kept
- `rc1` huge default block size: removed
- `rc2` safe embedding and reload hardening: kept
- `rc2` dead self-format path: removed
- `rc2` recycle buffer size validation: kept
- `rc3` extracted wrapper module: kept
- `rc3` low-latency block-size default: kept

## Agent-facing conclusion

For future Codex/Copilot work on this branch:

- Treat `rnd#sound-synth` as a clean master-based implementation target.
- Treat `origin/wip#sound-synth`, `rc1#sound_synth`, `rc2#sound_synth`, and `origin/rc3#sound_synth` as evidence, not as code to transplant wholesale.
- The distilled authority is:
  - keep indexed sound buffers
  - keep worklet-owned timing
  - keep ring-sampler history
  - keep modular webview assembly
  - do not reintroduce self-sound, `#iSample`, or monolithic runtime structure
