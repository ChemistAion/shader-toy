// Created by MysteryPancake (mysterypancake.github.io)
// Synth sound shader: "Chords Experiment"
// Source: https://www.shadertoy.com/view/WtByDR
// Adapted for VS Code Shadertoy

#include "common.glsl"

// From https://www.shadertoy.com/view/llByWR
float sawtooth(float time, float x) {
    // Smooth harsh attack
    float smoothAttack = min(1.0, time * 50.0);
	return (1.0 - 2.0 * acos((1.0 - time) * -cos(x / 2.0)) / PI) * (2.0 * atan(sin(x / 2.0) / time) / PI) * smoothAttack;
}

float arpeggiate(float time, float baseNote, float range, float notesPerSecond, float repeat) {
	return mod(floor(time / notesPerSecond), repeat) * range + baseNote;
}

vec2 mainSound(int sampleIndex, float sampleTime) {		
	
	const float phaseOffset = 0.01;

	float bass = arpeggiate(sampleTime, 69.0, 3.0, 2.0, 2.0);
	float low = arpeggiate(sampleTime, 81.0, 3.0, 2.0, 2.0);
	float mid = arpeggiate(sampleTime, 85.0, 2.0, 1.0, 4.0);
	float high = arpeggiate(sampleTime, 93.0, 3.0, 2.0, 2.0);
	float higher = arpeggiate(sampleTime, 97.0, 2.0, 1.0, 4.0);
	if (mod(floor(sampleTime / 16.0), 2.0) != 0.0) {
		bass = arpeggiate(sampleTime, 69.0, 2.0, 2.0, 2.0);
		low = arpeggiate(sampleTime, 81.0, 2.0, 2.0, 2.0);
		mid = arpeggiate(sampleTime, 81.0, 2.0, 2.0, 4.0);
		high = arpeggiate(sampleTime, 93.0, 2.0, 2.0, 2.0);
		higher = arpeggiate(sampleTime, 105.0, 2.4, 0.25, 4.0);
	}
	
	float[] notes = float[] (bass, low, mid, high, higher);
	float[] amplitudes = float[] (1.2, 1.0, 1.2, 0.6, 0.3);
	
    vec2 result = vec2(0.0);
	
	for (int i = 0; i < notes.length(); i++) {
		float repeat = mod(sampleTime, 0.25) * (5.0 - cos(sampleTime) * 2.0);
		if (i == 0) {
			repeat = mod(sampleTime, 0.125) * (2.0 - cos(sampleTime));
		}
		repeat = min(repeat, 0.7 + cos(sampleTime * 0.25) * 0.3);
        
		float offsetLeft = sin(float(i)) * phaseOffset;
		result.x += sawtooth(repeat, (sampleTime + offsetLeft) * noteFreq(notes[i])) * amplitudes[i];
        
		float offsetRight = cos(float(i)) * phaseOffset;
		result.y += sawtooth(repeat, (sampleTime + offsetRight) * noteFreq(notes[i])) * amplitudes[i];
	}
    
	return result / float(notes.length());
}
