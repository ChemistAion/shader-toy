// Demo for iSampleRingN + ring-buffer sampling helpers.
// History window (current ring):
//   maxHistorySamples = iSampleRingDepth * iSampleRingBlockSize
//   iSampleRingDepth = 4
//   iSampleRingBlockSize = 64 * 64 = 4096
//   maxHistorySamples = 4 * 4096 = 16384
//   maxHistorySeconds = maxHistorySamples / iSampleRate
// NOTE: The ring buffer is updated per ring block, so delays must be >= iSampleRingBlockSize
// to access history from previous blocks.
//
// Sound source to be sampled (conceptual)
#iSound0 "file://supersaw_iSound.glsl"

// Ring-buffer sampler helpers
#include "sampler_helpers.glsl"

vec2 mainSound(int sampleIndex, float sampleTime) {
    // Dry signal from current sample
    vec2 dry = shSampleRing(iSampleRing0, sampleIndex);

    // Echo taps: 0.333s, 0.666s, 0.999s
    int delaySamples1 = int(0.333 * iSampleRate);
    int delaySamples2 = int(0.666 * iSampleRate);
    int delaySamples3 = int(0.999 * iSampleRate);
    vec2 echo1 = sampleSound(0, sampleIndex - delaySamples1) * 0.6;
    vec2 echo2 = sampleSound(0, sampleIndex - delaySamples2) * 0.4;
    vec2 echo3 = sampleSound(0, sampleIndex - delaySamples3) * 0.2;

    // Mix
    vec2 wet = dry + echo1 + echo2 + echo3;
    return wet;
}
