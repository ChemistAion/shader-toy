// Demo showcasing iSample bindings and sample-index math.
// NOTE: sampleSound(...) is still a conceptual helper; only iSampleN bindings are implemented.
//
// Available globals:
//   iAudioTime (float), iSampleRate (float)
//   iSampleBlockSize (int), iSampleRingDepth (int)
//
// Implemented directive:
//   #iSample0 s0 -> vec2 current sample from sound0
//
// Optional helper idea (not implemented yet):
//   vec2 sampleSound(int soundIndex, int sampleIndexAbsolute);

// Sound source to be sampled
#iSound0 "file://synth/supersaw_iSound.glsl"

// Direct sample binding (current sample at iAudioTime)
#iSample0 s0

// Placeholder for future helper; see audioworklet.md for design notes.
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

vec2 mainSound(int sampleIndex, float sampleTime) {
    vec2 dry = s0;

    // Undersampling: every 4th sample (conceptual).
    int undersampleIndex = sampleIndex / 4;
    vec2 undersampled = sampleSound(0, undersampleIndex);

    // Supersampling: linear interpolation between adjacent samples (conceptual).
    float sampleFloat = float(sampleIndex);
    int sampleBase = int(floor(sampleFloat));
    float frac = sampleFloat - float(sampleBase);
    vec2 sA = sampleSound(0, sampleBase);
    vec2 sB = sampleSound(0, sampleBase + 1);
    vec2 supersampled = stSampleLerp(sA, sB, frac);

    // Mix (conceptual)
    return dry * 0.6 + undersampled * 0.2 + supersampled * 0.2;
}