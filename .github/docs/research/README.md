# Research References

Light reconnaissance set for external shader/live-editing tools that support GPU sound synthesis directly, or clearly address audio-driven shader workflows closely enough to justify deeper follow-up. A small number of adjacent tools can also be included when explicitly requested for comparison.

## Included now

- `shaderboy.md` — `iY0Yi/ShaderBoy`
- `bonzomatic.md` — `Gargaj/Bonzomatic`
- `twigl.md` — `doxas/twigl`
- `shadertoy-sound.md` — `hatoo/vscode-shadertoy-sound`
- `audio-preview.md` — `sukumo28/vscode-audio-preview`

Each included reference has a matching checkout under `references\`.

## Omitted for now

- `mrdoob/three.js` — graphics engine, not a shader live-editor with native GPU sound synthesis
- `tgjones/shader-playground` — shader compiler playground, not an audio/shader runtime
- `0b5vr/automaton` — animation engine, not a shader-sound editor/runtime
- `patriciogonzalezvivo/lygia` — shader library, not a shader live-editor and no clear audio-synth surface in this pass
- `mrdoob/glsl-sandbox` / GLSL Sandbox — public source exists, but no native shader-audio / sound-synth support identified
- `shaderkit.com` — no public source repo identified; no native shader-audio support identified
- `shaderboi.net` — no definitive public repo identified for the site itself; appears audio-reactive, but not clearly Shadertoy-style sound-shader support

## Scope note

These files are placeholders for a later deep-dive pass. They intentionally capture only the minimum needed to justify further investigation.

`vscode-audio-preview` is included as an explicit user-requested comparison reference even though it is adjacent audio tooling rather than a native GPU sound-shader runtime.
