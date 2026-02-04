// Audio Visualizer
//
// This shader visualizes audio from #iChannel0 "sound" using a 2-row texture:
// - Row 0 (v=0.25): FFT magnitude for each channel (R=Left, G=Right)
// - Row 1 (v=0.75): Time-domain waveform for each channel (R=Left, G=Right)
//
// Why 0.25 / 0.75?
// The audio texture is 2 pixels tall. Sampling at v=0.25 and v=0.75 hits the
// center of the first and second rows, avoiding interpolation at row borders.
//
// Values are byte-encoded 0..1 and mapped here to -1..1 for waveforms.
//
// Output:
// - Top half: combined FFT (avg L+R)
// - Bottom half: left/right waveforms split by screen halves

// #iSound0 keep 0-index reserved in case echo_iSound.glsl is used
#iSound1 "file://synth/supersaw_iSound.glsl"
// ...or, with echo effect:
// #iSound1 "file://synth/echo_iSound.glsl"
#iSound2 "file://synth/rain_iSound.glsl"
#iChannel0 "sound"

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
	vec2 uv = fragCoord.xy / iResolution.xy;
    
    // Audio data layout: row 0 = frequency, row 1 = time domain
    vec4 freq = texture2D(iChannel0, vec2(uv.x, 0.25));

    // Background
    vec3 bg = mix(vec3(0.02, 0.03, 0.05), vec3(0.01, 0.01, 0.02), uv.y);
    fragColor = vec4(bg, 1.0);

    // Split screen: top = FFT bars (combined), bottom = L/R waveform panels
    if (uv.y > 0.5) {
        float y = (uv.y - 0.5) / 0.5;
        float bar = smoothstep(0.0, 1.0, (freq.r + freq.g) * 0.5);
        float band = smoothstep(bar - 0.02, bar, y);
        vec3 col = mix(vec3(0.03, 0.15, 0.35), vec3(0.10, 0.90, 0.55), bar);
        fragColor.rgb = mix(fragColor.rgb, col, 1.0 - band);
    } else {
        float y = uv.y / 0.5;
        bool isLeft = uv.x < 0.5;
        float local = isLeft ? uv.x * 2.0 : (uv.x - 0.5) * 2.0;

        vec4 amp = texture2D(iChannel0, vec2(local, 0.75));
        float wave = (isLeft ? amp.r : amp.g) * 2.0 - 1.0;
        float center = 0.5 + 0.35 * wave;
        float line = smoothstep(0.0, 0.015, abs(y - center));
        vec3 colLeft = mix(vec3(0.8, 0.25, 0.2), vec3(1.0, 0.85, 0.4), abs(wave));
        vec3 colRight = mix(vec3(0.2, 0.5, 0.9), vec3(0.4, 0.9, 1.0), abs(wave));
        vec3 col = isLeft ? colLeft : colRight;
        fragColor.rgb = mix(fragColor.rgb, col, 1.0 - line);
    }
}
