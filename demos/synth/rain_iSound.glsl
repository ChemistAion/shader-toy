// Created by MysteryPancake (mysterypancake.github.io)
// Synth sound shader: "Rain (Sound)"
// Source: https://www.shadertoy.com/view/ctS3Dz
// Adapted for VS Code Shadertoy

#include "common.glsl"

const float TAU = 6.28318530;

// From https://www.shadertoy.com/view/tttfRj
float noise(float s) {
    int si = int(floor(s));
    float sf = fract(s);
    sf = smoothstep(0.0, 1.0, sf);
    return mix(hash(float(si)), hash(float(si + 1)), sf) * 2.0 - 1.0;
}

// From https://www.shadertoy.com/view/sls3WM
float coloredNoise(float time, float freq, float Q) {
    return sin(TAU * freq * fract(time)) * noise(time * Q);
}

// Works like Waveshaper in FL Studio
float distort(float x, float time) {
    // Curved distortion, more bass
    float a = smoothstep(0.2, 1.0, abs(x));
    // Straight distortion, more treble
    float b = clamp((abs(x) - 0.6) * 1.5, 0.0, 1.0);
    // Unipolar distortion, same for positive and negative sides
    return sign(x) * mix(a, b, cos(time * 0.5) * 0.5 + 0.5);
}

vec2 mainSound(float sampleTime) {
    
    vec2 result = vec2(0.0);
    
    // Lightning
    float amplitude = min(1.0, exp(mod(sampleTime - 1.0, 6.0) * -0.5));
    result.x += coloredNoise(sampleTime, 20.0, 500.0) * amplitude;
    result.y += coloredNoise(sampleTime + 1.5, 20.0, 500.0) * amplitude;
    
    // Low frequency rumble
    result.x += coloredNoise(sampleTime, 100.0, 1000.0) * 0.3;
    result.y += coloredNoise(sampleTime + 1.5, 100.0, 1000.0) * 0.3;
    
    // Mid frequency rumble
    result.x += coloredNoise(sampleTime, 700.0, 2000.0) * 0.05;
    result.y += coloredNoise(sampleTime + 1.5, 700.0, 2000.0) * 0.05;
    
    // Distorted noise for rain
    result.x += distort(coloredNoise(sampleTime, 120.0, 2000.0), sampleTime) * 0.25;
    result.y += distort(coloredNoise(sampleTime + 1.5, 120.0, 2000.0), sampleTime) * 0.25;
    
    return result;
}
