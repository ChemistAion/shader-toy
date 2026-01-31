// Helper functions for sampling iSampleRing textures and working with sample indices.
// Requires:
//   iSampleRate (float)
//   iSampleRingDepth (int), iSampleBlockSize (int)
//   iSampleRing0..iSampleRing9 (sampler2D)
//
// Notes:
// - sample indices are absolute (not wrapped) in the audio timeline.
// - out-of-range samples are clamped to silence by the helper.
// - "sh" is a short internal prefix (sampler_helpers) used throughout these
//   helpers to keep names grouped and avoid collisions with user symbols or
//   common GLSL names.

#define shSampleRingZero vec2(0.0)

vec2 shSampleRing(sampler2D ringTex, int sampleIndexAbsolute) {
    if (iSampleRingDepth <= 0 || iSampleBlockSize <= 0) {
        return shSampleRingZero;
    }
    float blockSize = float(iSampleBlockSize);
    int blockDim = int(floor(sqrt(blockSize)));
    if (blockDim <= 0) {
        return shSampleRingZero;
    }
    int blockIndex = sampleIndexAbsolute / iSampleBlockSize;
    int blockOffset = sampleIndexAbsolute - blockIndex * iSampleBlockSize;
    int ringSlot = blockIndex % iSampleRingDepth;
    if (ringSlot < 0) {
        ringSlot += iSampleRingDepth;
    }
    int x = blockOffset - (blockOffset / blockDim) * blockDim;
    int y = blockOffset / blockDim;
    int rowOffset = ringSlot * blockDim;
    float u = (float(x) + 0.5) / float(blockDim);
    float v = (float(rowOffset + y) + 0.5) / float(blockDim * iSampleRingDepth);
    return texture(ringTex, vec2(u, v)).xy;
}

// Sample index helpers
int shSampleIndexFromTime(float t) {
    return int(floor(t * iSampleRate));
}

float shSampleTimeFromIndex(int sampleIndex) {
    return float(sampleIndex) / iSampleRate;
}

int shSampleBlockIndex(int sampleIndex) {
    return (iSampleBlockSize > 0) ? (sampleIndex / iSampleBlockSize) : 0;
}

int shSampleBlockOffset(int sampleIndex) {
    return (iSampleBlockSize > 0) ? (sampleIndex - (sampleIndex / iSampleBlockSize) * iSampleBlockSize) : 0;
}

int shSampleBlockStart(int sampleIndex) {
    return shSampleBlockIndex(sampleIndex) * iSampleBlockSize;
}

vec2 shSampleLerp(vec2 a, vec2 b, float t) {
    return mix(a, b, clamp(t, 0.0, 1.0));
}

vec2 sampleSound(int soundIndex, int sampleIndexAbsolute) {
    if (soundIndex == 0) return shSampleRing(iSampleRing0, sampleIndexAbsolute);
    if (soundIndex == 1) return shSampleRing(iSampleRing1, sampleIndexAbsolute);
    if (soundIndex == 2) return shSampleRing(iSampleRing2, sampleIndexAbsolute);
    if (soundIndex == 3) return shSampleRing(iSampleRing3, sampleIndexAbsolute);
    if (soundIndex == 4) return shSampleRing(iSampleRing4, sampleIndexAbsolute);
    if (soundIndex == 5) return shSampleRing(iSampleRing5, sampleIndexAbsolute);
    if (soundIndex == 6) return shSampleRing(iSampleRing6, sampleIndexAbsolute);
    if (soundIndex == 7) return shSampleRing(iSampleRing7, sampleIndexAbsolute);
    if (soundIndex == 8) return shSampleRing(iSampleRing8, sampleIndexAbsolute);
    if (soundIndex == 9) return shSampleRing(iSampleRing9, sampleIndexAbsolute);
    return shSampleRingZero;
}

