/**
 * shader_heatmap.js — Per-pixel instruction-count heatmap engine for the preview webview.
 *
 * Port of FragCoord v0.7.1 heatmap pipeline:
 *   Shader instrumentation (Oh, z8, W8, _0, V8)
 *   Shader rewriting      (Ej, Sj, wj)
 *   Overlay rendering      (xM thermal/grayscale ramp)
 *   Temporal smoothing      (1 - exp(-9.75 * dt))
 *   Per-line counts         (Bv, $8)
 *
 * Loaded into the preview webview via WebviewModuleScriptExtension.
 * Exposes window.ShaderToy.heatmap namespace.
 */
(function () {
    'use strict';

    // ── Constants ────────────────────────────────────────────────

    const IC_OUTPUT = 'fragColor = vec4(float(_ic), 0.0, 0.0, 1.0)';

    const GLSL_KEYWORDS = new Set([
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
        'return', 'break', 'continue', 'discard', 'layout', 'in', 'out',
        'inout', 'uniform', 'varying', 'attribute', 'precision',
        'highp', 'mediump', 'lowp', 'struct',
        'float', 'int', 'uint', 'bool', 'void',
        'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
        'uvec2', 'uvec3', 'uvec4', 'mat2', 'mat3', 'mat4',
        'sampler2D', 'samplerCube', 'sampler3D',
        'const', 'flat', 'smooth'
    ]);

    const DEFAULT_OPACITY = 0.7;
    const DOWNSAMPLE_SIZE = 64;

    // Overlay shader (port of xM): thermal/grayscale color ramp
    const OVERLAY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_viewportSize;
uniform float u_minCount;
uniform float u_maxCount;
uniform float u_opacity;
uniform int u_colorScheme;
layout(location = 0) out vec4 fragColor;

vec3 thermalRamp(float t) {
  const vec3 c0 = vec3(0.0, 0.0, 0.0);
  const vec3 c1 = vec3(0.0, 0.0, 0.627);
  const vec3 c2 = vec3(0.784, 0.0, 0.0);
  const vec3 c3 = vec3(1.0, 0.588, 0.0);
  const vec3 c4 = vec3(1.0, 1.0, 0.0);
  const vec3 c5 = vec3(1.0, 1.0, 1.0);
  if (t < 0.2) return mix(c0, c1, t * 5.0);
  else if (t < 0.4) return mix(c1, c2, (t - 0.2) * 5.0);
  else if (t < 0.6) return mix(c2, c3, (t - 0.4) * 5.0);
  else if (t < 0.8) return mix(c3, c4, (t - 0.6) * 5.0);
  else return mix(c4, c5, (t - 0.8) * 5.0);
}
vec3 grayscaleRamp(float t) { return vec3(t); }

void main() {
  vec2 uv = gl_FragCoord.xy / u_viewportSize;
  float count = texture(u_source, uv).r;
  float range = u_maxCount - u_minCount;
  float t = range > 0.0 ? clamp((count - u_minCount) / range, 0.0, 1.0) : 0.5;
  vec3 color = u_colorScheme == 1 ? grayscaleRamp(t) : thermalRamp(t);
  fragColor = vec4(color, u_opacity);
}
`;

    const OVERLAY_VERT = `#version 300 es
precision highp float;
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

    // ── Instrumentation Engine (port of Oh, z8, W8, _0, V8) ─────

    /**
     * Inject _ic++ after every statement in a function body.
     * Port of FragCoord's Oh(body).
     */
    function instrumentBody(body) {
        var result = '';
        var i = 0;
        var parenDepth = 0;
        var inSingleLineComment = false;
        var inMultiLineComment = false;
        var inPreprocessor = false;
        var insideForHeader = false;

        while (i < body.length) {
            // Multi-line comment start
            if (!inSingleLineComment && !inPreprocessor &&
                i + 1 < body.length && body[i] === '/' && body[i + 1] === '*') {
                inMultiLineComment = true;
                result += '/*';
                i += 2;
                continue;
            }
            // Multi-line comment end
            if (inMultiLineComment && i + 1 < body.length &&
                body[i] === '*' && body[i + 1] === '/') {
                inMultiLineComment = false;
                result += '*/';
                i += 2;
                continue;
            }
            if (inMultiLineComment) { result += body[i]; i++; continue; }

            // Single-line comment
            if (!inMultiLineComment && !inPreprocessor &&
                i + 1 < body.length && body[i] === '/' && body[i + 1] === '/') {
                inSingleLineComment = true;
                result += '//';
                i += 2;
                continue;
            }

            // Preprocessor
            if (!inSingleLineComment && !inMultiLineComment &&
                body[i] === '#' && (i === 0 || body[i - 1] === '\n')) {
                inPreprocessor = true;
                result += '#';
                i++;
                continue;
            }

            // Newline resets
            if (body[i] === '\n') {
                if (inSingleLineComment) inSingleLineComment = false;
                if (inPreprocessor) inPreprocessor = false;
                result += '\n';
                i++;
                continue;
            }

            if (inSingleLineComment || inPreprocessor) { result += body[i]; i++; continue; }

            // Track parens
            if (body[i] === '(') {
                parenDepth++;
                result += '(';
                i++;
                continue;
            }
            if (body[i] === ')') {
                parenDepth--;
                if (parenDepth === 0 && insideForHeader) {
                    insideForHeader = false;
                }
                result += ')';
                i++;
                continue;
            }

            // Detect for() keyword
            if (parenDepth === 0 && !insideForHeader) {
                var forMatch = body.slice(i).match(/^for\s*\(/);
                if (forMatch) {
                    insideForHeader = true;
                    result += forMatch[0];
                    i += forMatch[0].length;
                    parenDepth++;
                    continue;
                }
            }

            // Semicolons: inject _ic++ at statement level
            if (body[i] === ';') {
                result += ';';
                if (parenDepth === 0 && !insideForHeader) {
                    result += '_ic++;';
                }
                i++;
                continue;
            }

            // Opening braces after flow control
            if (body[i] === '{') {
                result += '{';
                var beforeBrace = result.trimEnd();
                var isFlow = /\b(if|else|for|while|do|switch)\s*(\([^)]*\))?\s*$/.test(beforeBrace) ||
                             /\belse\s*$/.test(beforeBrace);
                if (isFlow) {
                    result += '_ic++;';
                }
                i++;
                continue;
            }

            result += body[i];
            i++;
        }

        return result;
    }

    /**
     * Wrap bare for-loop bodies in braces. Port of z8().
     */
    function normalizeForLoops(source) {
        var result = source;
        var changed = true;
        while (changed) {
            changed = false;
            var loopRe = /\b(for|while)\s*\(/g;
            var m;
            while ((m = loopRe.exec(result)) !== null) {
                var parenStart = m.index + m[0].length - 1;
                var depth = 1, pos = parenStart + 1;
                while (pos < result.length && depth > 0) {
                    if (result[pos] === '(') depth++;
                    else if (result[pos] === ')') depth--;
                    pos++;
                }
                if (depth !== 0) continue;
                var closeParen = pos - 1;
                var after = closeParen + 1;
                while (after < result.length && /\s/.test(result[after])) after++;
                if (after >= result.length || result[after] === '{' || result[after] === ';') continue;
                var wordMatch = result.slice(after).match(/^\w+/);
                if (wordMatch && (wordMatch[0] === 'for' || wordMatch[0] === 'while' ||
                    wordMatch[0] === 'if' || wordMatch[0] === 'return' || wordMatch[0] === 'break' ||
                    wordMatch[0] === 'continue' || wordMatch[0] === 'discard')) continue;

                // Find semicolon
                var pD = 0, bD = 0, semi = -1;
                for (var j = after; j < result.length; j++) {
                    if (result[j] === '(') pD++;
                    else if (result[j] === ')') pD--;
                    else if (result[j] === '{') bD++;
                    else if (result[j] === '}') bD--;
                    else if (result[j] === ';' && pD === 0 && bD === 0) { semi = j; break; }
                }
                if (semi === -1) continue;
                result = result.slice(0, semi + 1) + ' }' + result.slice(semi + 1);
                result = result.slice(0, closeParen + 1) + ' { ' + result.slice(closeParen + 1);
                changed = true;
                break;
            }
        }
        return result;
    }

    /**
     * Strip dead code after unconditional return/discard. Port of W8().
     */
    function stripDeadCode(body) {
        var lines = body.split('\n');
        var result = [];
        var braceDepth = 0;
        var dead = false;

        for (var li = 0; li < lines.length; li++) {
            var line = lines[li];
            var trimmed = line.trim();

            // Track braces (crude but effective for our purpose)
            for (var ci = 0; ci < line.length; ci++) {
                if (line[ci] === '{') { braceDepth++; dead = false; }
                if (line[ci] === '}') { braceDepth--; dead = false; }
            }

            if (dead) continue;
            result.push(line);

            // Detect unconditional return/discard
            if (/\breturn\b/.test(trimmed) || /\bdiscard\b/.test(trimmed)) {
                if (braceDepth <= 1) dead = true;
            }
        }

        return result.join('\n');
    }

    /**
     * Instrument ALL user-defined functions (not just main). Port of _0().
     */
    function instrumentAllFunctions(source, skipFuncName) {
        var funcRegex = /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
        var locations = [];
        var match;
        while ((match = funcRegex.exec(source)) !== null) {
            var returnType = match[1];
            var funcName = match[2];
            if (GLSL_KEYWORDS.has(returnType)) continue;
            if (GLSL_KEYWORDS.has(funcName)) continue;
            if (skipFuncName && funcName === skipFuncName) continue;
            var bodyStart = match.index + match[0].length;
            var depth = 1, pos = bodyStart;
            while (pos < source.length && depth > 0) {
                if (source[pos] === '{') depth++;
                else if (source[pos] === '}') depth--;
                pos++;
            }
            locations.push({ bodyStart: bodyStart, bodyEnd: pos - 1 });
        }
        var result = source;
        for (var i = locations.length - 1; i >= 0; i--) {
            var bs = locations[i].bodyStart;
            var be = locations[i].bodyEnd;
            var body = result.slice(bs, be);
            var instrumented = instrumentBody(body);
            result = result.slice(0, bs) + instrumented + result.slice(be);
        }
        return result;
    }

    /**
     * Insert int _ic; declaration before first user function. Port of V8().
     */
    function insertIcDeclaration(source) {
        var funcRegex = /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
        var match;
        while ((match = funcRegex.exec(source)) !== null) {
            if (!GLSL_KEYWORDS.has(match[1]) && !GLSL_KEYWORDS.has(match[2])) {
                return source.slice(0, match.index) + 'int _ic;\n' + source.slice(match.index);
            }
        }
        return source + '\nint _ic;\n';
    }

    // ── Shader Rewriting (port of Ej, Sj, wj) ──────────────────

    /**
     * Rewrite standard-format shader for heatmap. Port of Ej().
     */
    function rewriteStandardShader(source) {
        var src = instrumentAllFunctions(source, 'main');
        var mainMatch = src.match(/\bvoid\s+main\s*\(\s*\)\s*\{/);
        if (!mainMatch || mainMatch.index === undefined) return null;
        var bodyStart = mainMatch.index + mainMatch[0].length;
        var depth = 1, pos = bodyStart;
        while (pos < src.length && depth > 0) {
            if (src[pos] === '{') depth++;
            else if (src[pos] === '}') depth--;
            pos++;
        }
        var bodyEnd = pos - 1;
        var body = src.slice(bodyStart, bodyEnd);
        body = normalizeForLoops(body);
        body = instrumentBody(body);
        body = stripDeadCode(body);
        var prefix = src.slice(0, mainMatch.index);
        var suffix = src.slice(pos);
        var hasFragColor = /\bfragColor\b/.test(body);
        return insertIcDeclaration(prefix) +
            'void main() {\n  _ic = 0;\n' +
            (hasFragColor ? '  fragColor = vec4(0.0);\n' : '') +
            body + '\n  ' + IC_OUTPUT + ';\n}\n' + suffix;
    }

    /**
     * Rewrite ShaderToy-format shader for heatmap. Port of Sj().
     */
    function rewriteShaderToyShader(source) {
        var src = source.replace(/\bmainImage\b/g, '_ic_entry');
        src = instrumentAllFunctions(src);
        src = insertIcDeclaration(src);
        src += '\nvoid main() {\n  _ic = 0;\n  vec4 _dummyColor;\n' +
               '  _ic_entry(_dummyColor, gl_FragCoord.xy);\n  ' + IC_OUTPUT + ';\n}\n';
        return src;
    }

    /**
     * Instrument shader for heatmap rendering. Port of wj().
     */
    function instrumentShaderForHeatmap(source) {
        var hasMain = /\bvoid\s+main\s*\(\s*\)\s*\{/.test(source);
        var hasMainImage = /\bvoid\s+mainImage\s*\(/.test(source);
        if (hasMain) return rewriteStandardShader(source);
        if (hasMainImage) return rewriteShaderToyShader(source);
        return null;
    }

    // ── Per-Line Count Computation (port of Bv, $8) ─────────────

    /**
     * Count _ic++ occurrences per line. Port of Bv().
     */
    function countIcPerLine(source) {
        var re = /_ic\+\+/g;
        return source.split(/\r?\n/).map(function (line) {
            return (line.match(re) || []).length;
        });
    }

    function lineAtOffset(source, offset) {
        var count = 0;
        for (var i = 0; i < offset && i < source.length; i++) {
            if (source[i] === '\n') count++;
        }
        return count;
    }

    /**
     * Compute per-line instruction counts. Port of $8().
     */
    function computePerLineCounts(source) {
        var hasMain = /\bvoid\s+main\s*\(\s*\)\s*\{/.test(source);
        var hasMainImage = /\bvoid\s+mainImage\s*\(/.test(source);

        if (hasMainImage) {
            // ShaderToy format
            var totalLines = (source.match(/\n/g) || []).length + 1;
            var counts = new Array(totalLines).fill(0);
            var renamed = source.replace(/\bmainImage\b/g, '_ic_entry');
            var instrumented = instrumentAllFunctions(renamed);
            var funcRegex = /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
            var match;
            while ((match = funcRegex.exec(instrumented)) !== null) {
                if (GLSL_KEYWORDS.has(match[1]) || GLSL_KEYWORDS.has(match[2])) continue;
                var fbs = match.index + match[0].length;
                var fDepth = 1, fPos = fbs;
                while (fPos < instrumented.length && fDepth > 0) {
                    if (instrumented[fPos] === '{') fDepth++;
                    else if (instrumented[fPos] === '}') fDepth--;
                    fPos++;
                }
                var fBody = instrumented.slice(fbs, fPos - 1);
                var fCounts = countIcPerLine(instrumentBody(fBody));
                var fLineOffset = lineAtOffset(instrumented, fbs);
                for (var k = 0; k < fCounts.length; k++) {
                    var lineIdx = fLineOffset + k;
                    if (lineIdx < counts.length) counts[lineIdx] += fCounts[k];
                }
            }
            return counts;
        }

        if (hasMain) {
            // Standard format
            var totalLines2 = (source.match(/\n/g) || []).length + 1;
            var counts2 = new Array(totalLines2).fill(0);
            var src = instrumentAllFunctions(source, 'main');
            var mainMatch = src.match(/\bvoid\s+main\s*\(\s*\)\s*\{/);
            if (!mainMatch || mainMatch.index === undefined) return null;
            var mbs = mainMatch.index + mainMatch[0].length;
            var mDepth = 1, mPos = mbs;
            while (mPos < src.length && mDepth > 0) {
                if (src[mPos] === '{') mDepth++;
                else if (src[mPos] === '}') mDepth--;
                mPos++;
            }
            var mBody = src.slice(mbs, mPos - 1);
            mBody = normalizeForLoops(mBody);
            mBody = instrumentBody(mBody);
            mBody = stripDeadCode(mBody);
            var mainCounts = countIcPerLine(mBody);
            var mainLineOff = lineAtOffset(src, mbs);
            for (var mi = 0; mi < mainCounts.length; mi++) {
                var mLineIdx = mainLineOff + mi;
                if (mLineIdx < counts2.length) counts2[mLineIdx] += mainCounts[mi];
            }
            // Also count in other user functions
            var funcRegex2 = /\b(\w+)\s+(\w+)\s*\([^)]*\)\s*\{/g;
            var match2;
            while ((match2 = funcRegex2.exec(src)) !== null) {
                if (GLSL_KEYWORDS.has(match2[1]) || GLSL_KEYWORDS.has(match2[2])) continue;
                if (match2[2] === 'main') continue;
                var fbs2 = match2.index + match2[0].length;
                var fD2 = 1, fP2 = fbs2;
                while (fP2 < src.length && fD2 > 0) {
                    if (src[fP2] === '{') fD2++;
                    else if (src[fP2] === '}') fD2--;
                    fP2++;
                }
                var fBody2 = src.slice(fbs2, fP2 - 1);
                var fC2 = countIcPerLine(instrumentBody(fBody2));
                var fLO2 = lineAtOffset(src, fbs2);
                for (var k2 = 0; k2 < fC2.length; k2++) {
                    var li2 = fLO2 + k2;
                    if (li2 < counts2.length) counts2[li2] += fC2[k2];
                }
            }
            return counts2;
        }

        return null;
    }

    // ── WebGL Helpers ────────────────────────────────────────────

    var _overlayProgram = null;
    var _overlayVAO = null;
    var _heatmapFBO = null;
    var _heatmapTexture = null;
    var _downsampleFBO = null;
    var _downsampleTexture = null;
    var _heatmapFBOSize = { w: 0, h: 0 };

    function createFloatFBO(glCtx, w, h) {
        var tex = glCtx.createTexture();
        glCtx.bindTexture(glCtx.TEXTURE_2D, tex);
        glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA32F, w, h, 0, glCtx.RGBA, glCtx.FLOAT, null);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.NEAREST);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.NEAREST);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
        glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);
        var fbo = glCtx.createFramebuffer();
        glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fbo);
        glCtx.framebufferTexture2D(glCtx.FRAMEBUFFER, glCtx.COLOR_ATTACHMENT0, glCtx.TEXTURE_2D, tex, 0);
        var status = glCtx.checkFramebufferStatus(glCtx.FRAMEBUFFER);
        glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);
        if (status !== glCtx.FRAMEBUFFER_COMPLETE) {
            glCtx.deleteTexture(tex);
            glCtx.deleteFramebuffer(fbo);
            return null;
        }
        return { fbo: fbo, texture: tex, w: w, h: h };
    }

    function ensureHeatmapFBO(glCtx, w, h) {
        if (_heatmapFBO && _heatmapFBOSize.w === w && _heatmapFBOSize.h === h) return true;
        if (_heatmapFBO) {
            glCtx.deleteFramebuffer(_heatmapFBO.fbo);
            glCtx.deleteTexture(_heatmapFBO.texture);
        }
        _heatmapFBO = createFloatFBO(glCtx, w, h);
        if (_heatmapFBO) {
            _heatmapFBOSize = { w: w, h: h };
            _heatmapTexture = _heatmapFBO.texture;
            return true;
        }
        return false;
    }

    function ensureDownsampleFBO(glCtx) {
        if (_downsampleFBO) return true;
        var fboObj = createFloatFBO(glCtx, DOWNSAMPLE_SIZE, DOWNSAMPLE_SIZE);
        if (!fboObj) return false;
        _downsampleFBO = fboObj;
        _downsampleTexture = fboObj.texture;
        return true;
    }

    function compileShaderGL(glCtx, type, src) {
        var sh = glCtx.createShader(type);
        glCtx.shaderSource(sh, src);
        glCtx.compileShader(sh);
        if (!glCtx.getShaderParameter(sh, glCtx.COMPILE_STATUS)) {
            glCtx.deleteShader(sh);
            return null;
        }
        return sh;
    }

    function createProgram(glCtx, vSrc, fSrc) {
        var vs = compileShaderGL(glCtx, glCtx.VERTEX_SHADER, vSrc);
        var fs = compileShaderGL(glCtx, glCtx.FRAGMENT_SHADER, fSrc);
        if (!vs || !fs) { glCtx.deleteShader(vs); glCtx.deleteShader(fs); return null; }
        var prog = glCtx.createProgram();
        glCtx.attachShader(prog, vs);
        glCtx.attachShader(prog, fs);
        glCtx.linkProgram(prog);
        if (!glCtx.getProgramParameter(prog, glCtx.LINK_STATUS)) {
            glCtx.deleteProgram(prog);
            return null;
        }
        glCtx.deleteShader(vs);
        glCtx.deleteShader(fs);
        return prog;
    }

    function ensureOverlayProgram(glCtx) {
        if (_overlayProgram) return true;
        _overlayProgram = createProgram(glCtx, OVERLAY_VERT, OVERLAY_FRAG);
        if (!_overlayProgram) return false;
        // Full-screen quad VAO
        _overlayVAO = glCtx.createVertexArray();
        glCtx.bindVertexArray(_overlayVAO);
        var buf = glCtx.createBuffer();
        glCtx.bindBuffer(glCtx.ARRAY_BUFFER, buf);
        glCtx.bufferData(glCtx.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), glCtx.STATIC_DRAW);
        var loc = glCtx.getAttribLocation(_overlayProgram, 'a_position');
        glCtx.enableVertexAttribArray(loc);
        glCtx.vertexAttribPointer(loc, 2, glCtx.FLOAT, false, 0, 0);
        glCtx.bindVertexArray(null);
        return true;
    }

    // ── Heatmap State ───────────────────────────────────────────

    var _active = false;
    var _opacity = DEFAULT_OPACITY;
    var _colorScheme = 0; // 0 = thermal, 1 = grayscale
    var _smoothMin = 0;
    var _smoothMax = 0;
    var _smoothInitialized = false;
    var _lastTime = 0;
    var _lastSourceHash = '';
    var _cachedInstrumented = null;
    var _heatmapMaterial = null;
    var _originalMaterials = new Map();
    var _debounceTimer = null;

    // Simple hash for caching
    function simpleHash(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) - h + str.charCodeAt(i)) | 0;
        }
        return h;
    }

    /** Get shader source from textarea (same as inspector) */
    function getShaderSource() {
        var textareas = document.querySelectorAll('textarea[data-shadertoy="shader"]');
        if (textareas.length === 0) return '';
        return textareas[textareas.length - 1].value || '';
    }

    /** Instrument and cache */
    function getInstrumentedShader(source) {
        var hash = simpleHash(source);
        if (hash === _lastSourceHash && _cachedInstrumented) return _cachedInstrumented;
        _cachedInstrumented = instrumentShaderForHeatmap(source);
        _lastSourceHash = hash;
        return _cachedInstrumented;
    }

    /**
     * Run one heatmap frame: instrument shader → render to FBO → downsample → overlay.
     * Called after the normal render pass completes.
     */
    function renderHeatmapFrame() {
        if (!_active) return;

        try {
            if (typeof gl === 'undefined' || typeof buffers === 'undefined' || buffers.length === 0) return;

            var source = getShaderSource();
            if (!source) return;

            var instrumented = getInstrumentedShader(source);
            if (!instrumented) return;

            var canvas = document.getElementById('canvas');
            if (!canvas) return;
            var w = canvas.width;
            var h = canvas.height;

            // Ensure FBOs
            if (!ensureHeatmapFBO(gl, w, h)) return;
            if (!ensureDownsampleFBO(gl)) return;
            if (!ensureOverlayProgram(gl)) return;

            // Get the final buffer's original material for uniforms
            var finalIdx = buffers.length - 1;
            var finalBuffer = buffers[finalIdx];
            var origMat = _originalMaterials.get(finalIdx) || finalBuffer.Shader;
            if (!_originalMaterials.has(finalIdx)) {
                _originalMaterials.set(finalIdx, finalBuffer.Shader);
            }

            // Prepare the instrumented fragment shader
            var prepared = instrumented;
            if (window.ShaderToy && window.ShaderToy.shaderCompile &&
                window.ShaderToy.shaderCompile.prepareFragmentShader) {
                var isWebGL2 = origMat.glslVersion === THREE.GLSL3;
                prepared = window.ShaderToy.shaderCompile.prepareFragmentShader(instrumented, isWebGL2);
            }

            // Create heatmap material (reuse if shader hasn't changed)
            if (!_heatmapMaterial || _heatmapMaterial._srcHash !== _lastSourceHash) {
                var uniforms = {};
                for (var key in origMat.uniforms) {
                    uniforms[key] = origMat.uniforms[key];
                }
                _heatmapMaterial = new THREE.ShaderMaterial({
                    glslVersion: origMat.glslVersion,
                    fragmentShader: prepared,
                    vertexShader: origMat.vertexShader,
                    uniforms: uniforms,
                    depthWrite: false,
                    depthTest: false
                });
                _heatmapMaterial._srcHash = _lastSourceHash;
            }

            // Save THREE.js state
            var prevTarget = renderer.getRenderTarget();

            // Render instrumented shader to heatmap FBO via THREE.js
            // We need a WebGLRenderTarget wrapping our FBO — use raw GL instead
            // Temporarily swap material, render to our FBO
            var savedMaterial = finalBuffer.Shader;
            finalBuffer.Shader = _heatmapMaterial;

            // Use a raw WebGLRenderTarget
            if (!_heatmapFBO._threeTarget) {
                _heatmapFBO._threeTarget = new THREE.WebGLRenderTarget(w, h, {
                    type: THREE.FloatType,
                    format: THREE.RGBAFormat,
                    minFilter: THREE.NearestFilter,
                    magFilter: THREE.NearestFilter
                });
            }
            if (_heatmapFBO._threeTarget.width !== w || _heatmapFBO._threeTarget.height !== h) {
                _heatmapFBO._threeTarget.setSize(w, h);
            }

            // Render heatmap pass via THREE
            if (typeof quad !== 'undefined' && typeof scene !== 'undefined' && typeof camera !== 'undefined') {
                quad.material = _heatmapMaterial;
                renderer.setRenderTarget(_heatmapFBO._threeTarget);
                renderer.render(scene, camera);
            }

            // Restore original material
            finalBuffer.Shader = savedMaterial;
            quad.material = savedMaterial;
            renderer.setRenderTarget(prevTarget);

            // Read back from the THREE render target to extract min/max
            var readBuf = new Float32Array(4 * DOWNSAMPLE_SIZE * DOWNSAMPLE_SIZE);

            // Use THREE.js readRenderTargetPixels for the full-res target, sample a grid
            // For efficiency, read a downsampled region
            var glState = renderer.state;

            // Bind the heatmap render target and read pixels
            var props = renderer.properties.get(_heatmapFBO._threeTarget);
            if (props && props.__webglFramebuffer) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, props.__webglFramebuffer);
                // Read center sample points on a grid
                var stepX = Math.max(1, Math.floor(w / DOWNSAMPLE_SIZE));
                var stepY = Math.max(1, Math.floor(h / DOWNSAMPLE_SIZE));
                var samplePixel = new Float32Array(4);
                var minVal = Infinity, maxVal = -Infinity;
                var sampleCount = 0;
                for (var sy = 0; sy < h && sampleCount < DOWNSAMPLE_SIZE * DOWNSAMPLE_SIZE; sy += stepY) {
                    for (var sx = 0; sx < w && sampleCount < DOWNSAMPLE_SIZE * DOWNSAMPLE_SIZE; sx += stepX) {
                        gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.FLOAT, samplePixel);
                        var val = samplePixel[0];
                        if (isFinite(val)) {
                            if (val < minVal) minVal = val;
                            if (val > maxVal) maxVal = val;
                        }
                        sampleCount++;
                    }
                }
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                if (!isFinite(minVal)) { minVal = 0; maxVal = 0; }

                // Temporal smoothing
                var now = performance.now();
                var dt = _lastTime > 0 ? (now - _lastTime) / 1000 : 0;
                _lastTime = now;

                if (!_smoothInitialized) {
                    _smoothMin = minVal;
                    _smoothMax = maxVal;
                    _smoothInitialized = true;
                } else {
                    var alpha = 1 - Math.exp(-9.75 * dt);
                    _smoothMin += (minVal - _smoothMin) * alpha;
                    _smoothMax += (maxVal - _smoothMax) * alpha;
                }

                // Render overlay using raw GL
                renderOverlay(gl, props.__webglFramebuffer, w, h, _smoothMin, _smoothMax);

                // Report data to extension host
                if (typeof vscode !== 'undefined' && vscode) {
                    vscode.postMessage({
                        command: 'heatmapData',
                        minCount: _smoothMin,
                        maxCount: _smoothMax
                    });
                }
            }

            // Per-line counts (throttled: only when source changes)
            maybeComputeAndSendLineCounts(source);

        } catch (err) {
            // Silently handle errors to not break the render loop
            if (typeof vscode !== 'undefined' && vscode) {
                vscode.postMessage({
                    command: 'heatmapData',
                    minCount: 0,
                    maxCount: 0,
                    error: err.message || String(err)
                });
            }
        }
    }

    /** Render the thermal/grayscale overlay via raw WebGL */
    function renderOverlay(glCtx, heatmapFramebuffer, viewW, viewH, minCount, maxCount) {
        if (!_overlayProgram || !_overlayVAO) return;

        // Read the heatmap texture from the THREE render target
        glCtx.bindFramebuffer(glCtx.READ_FRAMEBUFFER, heatmapFramebuffer);
        glCtx.bindFramebuffer(glCtx.DRAW_FRAMEBUFFER, null);

        // Draw overlay
        glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);
        glCtx.viewport(0, 0, viewW, viewH);

        glCtx.useProgram(_overlayProgram);

        // Bind heatmap texture
        // We need to extract the texture from the THREE render target
        if (_heatmapFBO && _heatmapFBO._threeTarget) {
            var threeProps = renderer.properties.get(_heatmapFBO._threeTarget.texture);
            if (threeProps && threeProps.__webglTexture) {
                glCtx.activeTexture(glCtx.TEXTURE0);
                glCtx.bindTexture(glCtx.TEXTURE_2D, threeProps.__webglTexture);
            }
        }

        glCtx.uniform1i(glCtx.getUniformLocation(_overlayProgram, 'u_source'), 0);
        glCtx.uniform2f(glCtx.getUniformLocation(_overlayProgram, 'u_viewportSize'), viewW, viewH);
        glCtx.uniform1f(glCtx.getUniformLocation(_overlayProgram, 'u_minCount'), minCount);
        glCtx.uniform1f(glCtx.getUniformLocation(_overlayProgram, 'u_maxCount'), maxCount);
        glCtx.uniform1f(glCtx.getUniformLocation(_overlayProgram, 'u_opacity'), _opacity);
        glCtx.uniform1i(glCtx.getUniformLocation(_overlayProgram, 'u_colorScheme'), _colorScheme);

        glCtx.enable(glCtx.BLEND);
        glCtx.blendFunc(glCtx.SRC_ALPHA, glCtx.ONE_MINUS_SRC_ALPHA);

        glCtx.bindVertexArray(_overlayVAO);
        glCtx.drawArrays(glCtx.TRIANGLE_STRIP, 0, 4);
        glCtx.bindVertexArray(null);

        glCtx.disable(glCtx.BLEND);
    }

    var _lineCountsHash = '';
    function maybeComputeAndSendLineCounts(source) {
        var hash = String(simpleHash(source));
        if (hash === _lineCountsHash) return;
        _lineCountsHash = hash;

        var counts = computePerLineCounts(source);
        if (!counts) return;

        var sparse = [];
        for (var i = 0; i < counts.length; i++) {
            if (counts[i] > 0) {
                sparse.push({ line: i + 1, count: counts[i] });
            }
        }
        if (sparse.length > 0 && typeof vscode !== 'undefined' && vscode) {
            vscode.postMessage({ command: 'heatmapLineCounts', counts: sparse });
        }
    }

    /** Restore state when heatmap is deactivated */
    function deactivate() {
        _active = false;
        _smoothInitialized = false;
        _cachedInstrumented = null;
        _lastSourceHash = '';
        _lineCountsHash = '';
        if (_heatmapMaterial) {
            _heatmapMaterial.dispose();
            _heatmapMaterial = null;
        }
        _originalMaterials.clear();
    }

    // ── Message Handling ────────────────────────────────────────

    function handleMessage(msg) {
        switch (msg.command) {
            case 'heatmapOn':
                _active = true;
                _smoothInitialized = false;
                _lastSourceHash = '';
                _lineCountsHash = '';
                break;

            case 'heatmapOff':
                deactivate();
                break;

            case 'setHeatmapOpacity':
                if (typeof msg.opacity === 'number') {
                    _opacity = Math.max(0, Math.min(1, msg.opacity));
                }
                break;

            case 'setHeatmapColorScheme':
                _colorScheme = msg.scheme === 'grayscale' ? 1 : 0;
                break;
        }
    }

    // ── Initialization ──────────────────────────────────────────

    window.ShaderToy = window.ShaderToy || {};
    window.ShaderToy.heatmap = {
        handleMessage: handleMessage,
        renderFrame: renderHeatmapFrame,
        isActive: function () { return _active; },

        // Called on hot-reload to clear stale references
        onHotReload: function () {
            _originalMaterials.clear();
            _heatmapMaterial = null;
            _lastSourceHash = '';
            _lineCountsHash = '';
            _cachedInstrumented = null;
            if (_active) {
                _smoothInitialized = false;
            }
        },

        // Expose instrumentation for testing
        instrument: {
            instrumentBody: instrumentBody,
            normalizeForLoops: normalizeForLoops,
            stripDeadCode: stripDeadCode,
            instrumentAllFunctions: instrumentAllFunctions,
            instrumentShaderForHeatmap: instrumentShaderForHeatmap,
            computePerLineCounts: computePerLineCounts
        }
    };
})();
