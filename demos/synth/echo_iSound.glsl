// Demo for iSampleN + ring-buffer sampling helpers.
// History window (current ring):
//   maxHistorySamples = iSampleRingDepth * iSampleBlockSize
//   iSampleRingDepth = 4
//   iSampleBlockSize = 512 * 512 = 262144
//   maxHistorySamples = 4 * 262144 = 1048576
//   maxHistorySeconds = maxHistorySamples / iSampleRate
//
// Sound source to be sampled (conceptual)
#iSound0 "file://supersaw_iSound.glsl"

// Ring-buffer sampler helpers
#include "sampler_helpers.glsl"

// Direct sample binding (current sample at iAudioTime)
#iSample0 s0

vec2 mainSound(int sampleIndex, float sampleTime) {
    // Dry signal from current sample
    vec2 dry = s0;

    // Echo taps: ~0.333s, 0.666s, 0.999s
    int delaySamples1 = int(0.333 * iSampleRate);
    int delaySamples2 = int(0.666 * iSampleRate);
    int delaySamples3 = int(0.999 * iSampleRate);
    vec2 echo1 = sampleSound(0, sampleIndex - delaySamples1) * 0.6;
    vec2 echo2 = sampleSound(0, sampleIndex - delaySamples2) * 0.4;
    vec2 echo3 = sampleSound(0, sampleIndex - delaySamples3) * 0.25;

    // Mix
    vec2 wet = dry + echo1 + echo2 + echo3;
    return wet;
}
