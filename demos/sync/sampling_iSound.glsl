// Conceptual demo showcasing sampling helper math for future iSample/iAudioTime.
// NOTE: This will not run until iSample + ring-buffer sampling is implemented.
//
// Assumed globals (proposal):
//   iAudioTime (float), iSampleRate (float)
//   iSampleBlockSize (int), iSampleRingDepth (int)
//
// Assumed directive:
//   #iSample0 s0 -> vec2 current sample from sound0
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

int stSampleIndexFromTime(float t) {
    return int(floor(t * iSampleRate));
}

float stSampleTimeFromIndex(int sampleIndex) {
    return float(sampleIndex) / iSampleRate;
}

int stSampleBlockIndex(int sampleIndex) {
    return (iSampleBlockSize > 0) ? (sampleIndex / iSampleBlockSize) : 0;
}

int stSampleBlockOffset(int sampleIndex) {
    return (iSampleBlockSize > 0) ? (sampleIndex - (sampleIndex / iSampleBlockSize) * iSampleBlockSize) : 0;
}

int stSampleBlockStart(int sampleIndex) {
    return stSampleBlockIndex(sampleIndex) * iSampleBlockSize;
}

vec2 stSampleLerp(vec2 a, vec2 b, float t) {
    return mix(a, b, clamp(t, 0.0, 1.0));
}

vec2 mainSound(int sample, float time) {
    vec2 dry = s0;

    // Undersampling: every 4th sample.
    int undersampleIndex = sample / 4;
    vec2 undersampled = sampleSound(0, undersampleIndex);

    // Supersampling: linear interpolation between adjacent samples.
    float sampleFloat = float(sample);
    int sampleBase = int(floor(sampleFloat));
    float frac = sampleFloat - float(sampleBase);
    vec2 sA = sampleSound(0, sampleBase);
    vec2 sB = sampleSound(0, sampleBase + 1);
    vec2 supersampled = stSampleLerp(sA, sB, frac);

    // Mix (conceptual)
    return dry * 0.6 + undersampled * 0.2 + supersampled * 0.2;
}
