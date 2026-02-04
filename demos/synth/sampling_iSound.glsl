// Demo showcasing iSampleRingN sampling and sample-index math.

// Sound source to be sampled
#iSound0 "file://synth/supersaw_iSound.glsl"

// Ring-buffer sampler + index helpers
#include "sampler_helpers.glsl"

vec2 mainSound(int sampleIndex, float sampleTime) {
    vec2 dry = shSampleRing(iSampleRing0, sampleIndex);

    // Undersampling: every 4th sample.
    int undersampleIndex = sampleIndex / 4;
    vec2 undersampled = sampleSound(0, undersampleIndex);

    // Supersampling: linear interpolation between adjacent samples.
    float sampleFloat = float(sampleIndex);
    int sampleBase = int(floor(sampleFloat));
    float frac = sampleFloat - float(sampleBase);
    vec2 sA = sampleSound(0, sampleBase);
    vec2 sB = sampleSound(0, sampleBase + 1);
    vec2 supersampled = shSampleLerp(sA, sB, frac);

    // Mix
    return dry * 0.6 + undersampled * 0.2 + supersampled * 0.2;
}