# `rc3#sound_synth`

Analysis target: local remote-tracking ref `origin/rc3#sound_synth` at `cd5268d` (`2026-02-09`, `fix3 (stage4,stage5): extract audio mainSound wrapper`).

## Scope and evidence

- There is no local branch head named `rc3#sound_synth`; the available ref is `origin/rc3#sound_synth`.
- Actual merge-base against the rest of the sound family remains `784238419c9a6bbf310649bc115a283fc508ac8b`.
- Primary evidence:
  - `src/shaderparser.ts @ origin/rc3#sound_synth`
  - `src/bufferprovider.ts @ origin/rc3#sound_synth`
  - `src/webviewcontentprovider.ts @ origin/rc3#sound_synth`
  - `resources/webview/audio_output.js @ origin/rc3#sound_synth`
  - `resources/webview/audio_shader_wrapper.js @ origin/rc3#sound_synth`
  - `resources/webview/audio_worklet_processor.js @ origin/rc3#sound_synth`
  - `resources/webview_base.html @ origin/rc3#sound_synth`
  - `README.md @ origin/rc3#sound_synth`

## Intent

`rc3#sound_synth` is a pruning and packaging branch. It does not introduce a new conceptual model; it tries to make the RC2-era model smaller, cleaner, and more operationally sane:

- lower default latency
- extract shader-wrapper generation from the runtime monolith
- restore sound-button UI parity
- keep worklet streaming, ring samplers, and readback telemetry

## Baseline

Conceptually, rc3 builds on rc2. In actual history, it is again a parallel re-implementation from the shared base. That means the analysis should focus on what ideas survive the rewrite, not on line-by-line ancestry.

## Architectural representation

The representation that survives into rc3 is now quite stable:

- `#iSoundN` remains the only accepted public directive family for sound shaders.
- `#iSound "self"` is rejected.
- `#iSample` remains rejected in favor of `iSampleRingN`.
- shader-visible history is still:
  - `iSampleRing0`..`iSampleRing9`
  - `iSampleRingBlockSize`
  - `iSampleRingDepth`
  - `iSoundIndex`

The important representational cleanup is not in the parser. It is in the runtime wrapper path:

- `resources/webview/audio_shader_wrapper.js @ origin/rc3#sound_synth` extracts the generated `mainSound` wrapper logic out of `audio_output.js`.
- The wrapper computes `baseSample`, `sampleIndex`, and `sampleTime` from `iAudioTime` and `iSampleRate` in one reusable place.

That is the cleanest wrapper arrangement in the branch family.

The remaining contradiction is familiar:

- `src/shaderparser.ts @ origin/rc3#sound_synth` still parses `#iSound::Format`.
- `src/bufferprovider.ts @ origin/rc3#sound_synth` still contains `selfSoundPrecisions` handling for `soundIndex === -1`.
- Yet `#iSound "self"` is already rejected.

So rc3 still carries dead self-format state even after the self-sound model has been abandoned.

## Machinery introduced and refined

### Extracted wrapper generation

`audio_shader_wrapper.js` is rc3's most important code-shape improvement.

- It removes duplicated wrapper text generation from the runtime monolith.
- It makes the `mainSound(sampleIndex, sampleTime)` call contract easier to audit.
- It separates scheduling/readback concerns from shader-wrapper concerns.

### Lower-latency defaults

`src/webviewcontentprovider.ts @ origin/rc3#sound_synth` drops the default `audioBlockSize` to `1024`.

This is a significant improvement over rc1 and rc2:

- it better matches interactive preview expectations
- it aligns more closely with the worklet quantum model
- it reduces algorithmic latency without changing the representation

### Runtime cleanup

`resources/webview/audio_output.js @ origin/rc3#sound_synth` retains:

- pooled transferable buffers
- worklet stats
- PBO/fence readback
- ring-texture maintenance
- readback-path reporting

But it is less entangled than earlier variants because wrapper generation has moved out.

### UI parity

The dedicated sound-button modules and assets are restored in rc3, undoing the rc2 UI regression.

## Commit progression

### Non-feature noise

- `96260a6 Add some notes about new features`
- `9d6541a Update license in the README`
- `27f28bf Update engine and vsce`
- `31b8e8c Remove little blue line in README`

These commits are historically real but architecturally irrelevant.

### Core feature pass

- `1a2fec5 stage1: parsing + sound metadata`
- `f228b01 stage2: audio worklet scaffold`
- `c8c9e79 stage3: ring buffers + precision`
- `6e095fa stage4: block size control`
- `187b828 stage5: safe embedding + hot reload`
- `5feb6e2 stage6: telemetry + readback`

This sequence is the compact restatement of the RC2-era design.

### Fixups

- `ccef066 fix1 (stage2): WebGL2 gate audio init`
- `58908f0 demos: basic audio synths, effects, and visualizer`
- `0bb38d3 fix2 (stage4): mainSound wrapper uses absolute time`
- `cd5268d fix3 (stage4,stage5): extract audio mainSound wrapper`

The two wrapper fixes are the key stabilization steps.

## Improvements over `rc2#sound_synth`

- Extracts wrapper generation into `audio_shader_wrapper.js`.
- Lowers default block size from `65536`-style RC defaults to `1024`.
- Restores the dedicated sound-button UI.
- Keeps the worklet, ring, readback, and overlay model without rc2's sound-button regression.
- Keeps explicit indexed sounds and keeps `#iSample` rejected.

## Regressions and drawbacks

- Dead `selfSoundPrecisions` logic still remains.
- The branch still exists only as a remote-tracking ref locally, which is a process smell: the family never converged into one stable local continuation.
- Because rc3 is another rewrite from the common base, every retained concept must still be re-validated instead of inherited with confidence.
- README and packaging churn are mixed into the feature branch, which dilutes review signal.

## Side explorations

- The early non-feature commits show branch drift: packaging and README changes were mixed into a branch that should have remained architecture-focused.

## Carry forward

- Keep the extracted wrapper module shape.
- Keep `1024`-scale default block sizing, with configuration remaining explicit.
- Keep the ring-sampler representation and absolute-sample worklet protocol.
- Keep restored sound-button UI parity.
- Keep readback-path telemetry and worklet stats.

## Reject

- Reject dead self-format logic.
- Reject mixing packaging churn into a feature-distillation branch.
- Reject repeated from-scratch rewrites once the architecture is already coherent.

## Distilled conclusion

`rc3#sound_synth` is the cleanest old branch in the family. It does not fundamentally change the RC architecture, but it removes enough accidental complexity that its surviving ideas are credible candidates for a fresh implementation:

- explicit indexed sound shaders
- ring-sampler history
- worklet-owned timing
- pooled transferable transport
- extracted wrapper generation
- low-latency default block size

Its remaining flaw is not conceptual; it is leftover cleanup debt around dead self-format paths and the branch process itself.
