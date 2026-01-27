// Conceptual demo for future iSampleN/iAudioTime sampling.
// NOTE: This will not run until iSampleN + ring-buffer sampling is implemented.
//
// Assumed globals (proposal):
//   iAudioTime (float), iSampleRate (float)
//   iSampleBlockSize (int), iSampleRingDepth (int)
//   iSampleIndex (int), iSampleBlockIndex (int)
//   iSampleWriteIndex (int)
//
// Assumed directive:
//   #iSample0 s0  -> vec2 current sample from sound0
//
// Assumed helper to sample arbitrary offsets from ring buffer:
//   vec2 sampleSound(int soundIndex, int sampleIndexAbsolute);
//
// Sound source to be sampled (conceptual)
#iSound0 "file://synth/supersaw_iSound.glsl"

// Proposed direct sample binding (current sample at iAudioTime)
#iSample0 s0

// NOTE: sampleSound(...) is conceptual; see design report in audioworklet.md.
vec2 sampleSound(int soundIndex, int sampleIndexAbsolute);

vec2 mainSound(int sample, float time) {
    // Dry signal from current sample
    vec2 dry = s0;

    // Simple echo: 250 ms delay
    int delaySamples = int(0.25 * iSampleRate);
    vec2 echo = sampleSound(0, sample - delaySamples);

    // 2nd tap: 500 ms delay, attenuated
    int delaySamples2 = int(0.50 * iSampleRate);
    vec2 echo2 = sampleSound(0, sample - delaySamples2) * 0.5;

    // Mix
    vec2 wet = dry + echo * 0.6 + echo2 * 0.3;
    return wet;
}
