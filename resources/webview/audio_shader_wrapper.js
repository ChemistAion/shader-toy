(function (global) {
    'use strict';

    const root = global.ShaderToy = global.ShaderToy || {};

    if (!root.audioShaderWrapper) {
        root.audioShaderWrapper = {};
    }

    const buildSoundFooter = function (precisionMode, width) {
        const safeWidth = Math.max(1, Math.floor(width || 1));
        if (precisionMode === '16bPACK') {
            return `
int _st_sampleIndex() {
    int x = int(floor(gl_FragCoord.x));
    int y = int(floor(gl_FragCoord.y));
    return x + y * ${safeWidth};
}

vec2 _st_pack16(float v) {
    v = clamp(v * 0.5 + 0.5, 0.0, 1.0);
    float i = floor(v * 65535.0 + 0.5);
    float hi = floor(i / 256.0);
    float lo = i - hi * 256.0;
    return vec2(lo, hi) / 255.0;
}

vec4 _st_packSound(vec2 v) {
    vec2 l = _st_pack16(v.x);
    vec2 r = _st_pack16(v.y);
    return vec4(l.x, l.y, r.x, r.y);
}

void main() {
    int localIndex = _st_sampleIndex();
    float baseSample = iAudioTime * iSampleRate;
    int sampleIndex = int(baseSample) + localIndex;
    float sampleTime = iAudioTime + float(localIndex) / iSampleRate;
    vec2 s = mainSound(sampleIndex, sampleTime);
    gl_FragColor = _st_packSound(s);
}
`;
        }
        if (precisionMode === '8bPACK') {
            return `
int _st_sampleIndex() {
    int x = int(floor(gl_FragCoord.x));
    int y = int(floor(gl_FragCoord.y));
    return x + y * ${safeWidth};
}

float _st_pack8(float v) {
    return clamp(v * 0.5 + 0.5, 0.0, 1.0);
}

void main() {
    int localIndex = _st_sampleIndex();
    float baseSample = iAudioTime * iSampleRate;
    int sampleIndex = int(baseSample) + localIndex;
    float sampleTime = iAudioTime + float(localIndex) / iSampleRate;
    vec2 s = mainSound(sampleIndex, sampleTime);
    gl_FragColor = vec4(_st_pack8(s.x), _st_pack8(s.y), 0.0, 1.0);
}
`;
        }
        return `
int _st_sampleIndex() {
    int x = int(floor(gl_FragCoord.x));
    int y = int(floor(gl_FragCoord.y));
    return x + y * ${safeWidth};
}

void main() {
    int localIndex = _st_sampleIndex();
    float baseSample = iAudioTime * iSampleRate;
    int sampleIndex = int(baseSample) + localIndex;
    float sampleTime = iAudioTime + float(localIndex) / iSampleRate;
    vec2 s = mainSound(sampleIndex, sampleTime);
    gl_FragColor = vec4(s.x, s.y, 0.0, 1.0);
}
`;
    };

    root.audioShaderWrapper.buildSoundSource = function (source, precisionMode, width) {
        const shaderSource = source || '';
        const hasMain = /void\s+main\s*\(\s*\)\s*\{/.test(shaderSource);
        const hasMainSound = /\bmainSound\s*\(/.test(shaderSource);
        if (!hasMain && hasMainSound) {
            return shaderSource + buildSoundFooter(precisionMode, width);
        }
        return shaderSource;
    };
})(typeof window !== 'undefined' ? window : globalThis);
