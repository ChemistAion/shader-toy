// Based on work by MysteryPancake (mysterypancake.github.io)
// Sources:
// https://www.shadertoy.com/view/mdlSRj
// https://www.shadertoy.com/view/WtByDR
// https://www.shadertoy.com/view/ctS3Dz

const float PI = 3.1415926;

// 1D hash, from https://www.shadertoy.com/view/4djSRW
float hash(float p) {
	p = fract(p * 0.1031);
	p *= p + 33.33;
	p *= p + p;
	return fract(p);
}

// MIDI note to frequency formula
float noteFreq(float note) {
	return 440.0 * exp2(floor(note - 69.0) / 12.0);
}
