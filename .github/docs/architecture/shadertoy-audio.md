# shader-toy audio machinery log (historical)

This document preserves the previously examined audio-synthesis machinery that was removed from `SKILL.md` to keep that skill source-accurate for the current branch.
It is kept as an implementation log/reference for the sound-synth branch line:

- `wip#sound-synth`
- `poc#sound-synth`
- `rc1#sound-synth`
- `rc2#sound-synth`
- `rc3#sound-synth`

## Scope and status

- This is a **historical implementation report** for PoC/RC branches.
- It describes the `mainSound` / `#iSound` architecture that was explored and iterated there.
- It is **not** a statement that all of this is currently present on `wip1#fragcoord`.

## Audio synthesis model (historical)

From the prior examination, the sound-synth path was designed around:

1. Parsing `#iSoundN` directives and associated format directives.
2. Detecting `mainSound(...)` entrypoints in shader parsing.
3. Generating shader adapters between:
   - `vec2 mainSound(float sampleTime)`
   - `vec2 mainSound(int sampleIndex, float sampleTime)`
4. Rendering audio blocks on GPU (WebGL2 path).
5. Reading rendered sample blocks back to CPU.
6. Streaming decoded blocks to an `AudioWorklet` processor.
7. Maintaining sample-history ring buffers exposed to shaders as `iSampleRingN`.

## Historical pipeline summary

### Parse / graph stage

- `#iSoundN "file.glsl"` registered sound-shader dependencies.
- `#iSoundN::Format` / `#iSound::Format` configured output precision (`32bFLOAT`, `16bFLOAT`, `16bPACK`).
- Sound targets were parsed recursively similarly to `#iChannel` shader dependencies.

### Shader/runtime stage

- `mainSound()` shaders were wrapped with an audio footer that packed sample output to pixel format.
- Audio render targets were driven in fixed block sizes (`iSampleBlockSize` path).
- Historical notes referenced WebGL2 readback with async/fence-first strategy and fallback readback.

### Worklet/streaming stage

- CPU-decoded sample blocks were posted to `AudioWorklet` via message port.
- Worklet-side queueing handled playback continuity and block demand signaling.
- Ring-buffer textures (`iSampleRing0..iSampleRing9`) provided DSP history to subsequent shader blocks.

## Historical GLSL-facing surface

### Directives

- `#iSoundN`
- `#iSoundN::Format`
- `#iSound::Format`

### Uniforms/samplers documented in the prior examination

- `iSampleRate`
- `iAudioTime`
- `iSampleBlockSize`
- `iSampleRingBlockSize`
- `iSampleRingDepth`
- `iSoundIndex`
- `iSampleRing0` .. `iSampleRing9`

### Entry points

- `vec2 mainSound(float sampleTime)`
- `vec2 mainSound(int sampleIndex, float sampleTime)`

## Historical runtime artifacts referenced in the prior examination

The removed examination referenced these webview runtime modules for synthesis flow:

- `resources/webview/audio_output.js`
- `resources/webview/audio_shader_wrapper.js`
- `resources/webview/audio_worklet_processor.js`

These names are preserved here as branch-history notes for later reuse.

## Historical caveats (as documented in the removed examination)

- Synthesis path required WebGL2 mode.
- Audio output path was AudioWorklet-based.
- `#iSound "self"` was noted as unsupported in that design.

## Why this file exists

`SKILL.md` now tracks current, source-verified behavior for the active branch.
This file intentionally keeps the previous audio-synthesis deep-dive as an implementation memory/log so the work from sound-synth PoC/RC branches can be reused during future reintroduction work.
