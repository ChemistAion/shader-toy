/**
 * shader_inspect.js — Variable inspector engine for the preview webview.
 *
 * Port of FragCoord v0.7.1 inspector pipeline:
 *   Type inference (a2, C0, mb, r4, ep, $v, Dj, s4)
 *   Shader rewriting (Bj, vb, gb, Oj, H8, Y1, q8, K8, Fj, K1, G8)
 *
 * Loaded into the preview webview via WebviewModuleScriptExtension.
 * Exposes window.ShaderToy.inspector namespace.
 */
(function () {
    'use strict';

    // ── Constants & Tables ──────────────────────────────────────────

    const BUILTIN_VARIABLES = {
        gl_FragCoord: 'vec4', gl_FragColor: 'vec4', gl_FragDepth: 'float',
        gl_PointCoord: 'vec2', gl_Position: 'vec4', gl_PointSize: 'float',
        gl_VertexID: 'int', gl_InstanceID: 'int', gl_FrontFacing: 'bool',
        fragColor: 'vec4'
    };

    const UNIFORM_TYPES = {
        u_resolution: 'vec2', u_time: 'float', u_time_delta: 'float',
        u_frame: 'int', u_mouse: 'vec4', u_drag: 'vec2', u_scroll: 'float',
        u_date: 'vec4', u_refresh_rate: 'float',
        iResolution: 'vec3', iTime: 'float', iTimeDelta: 'float',
        iFrame: 'int', iMouse: 'vec4', iDate: 'vec4',
        iChannelResolution: 'vec3', iChannelTime: 'float'
    };

    const STANDARD_UNIFORMS = new Set([
        'u_resolution', 'u_time', 'u_time_delta', 'u_frame', 'u_mouse',
        'u_drag', 'u_scroll', 'u_date', 'u_refresh_rate',
        'iResolution', 'iTime', 'iTimeDelta', 'iFrame', 'iMouse', 'iDate'
    ]);

    const TYPE_REGEX_STR = 'float|int|uint|vec[234]|ivec[234]|uvec[234]';

    const GLSL_KEYWORDS = new Set([
        'true', 'false', 'if', 'else', 'for', 'while', 'switch', 'case',
        'break', 'continue', 'discard', 'return', 'const', 'in', 'out',
        'inout', 'uniform', 'varying', 'attribute', 'flat', 'smooth',
        'float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4',
        'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
        'mat2', 'mat3', 'mat4', 'sampler2D', 'samplerCube', 'void', 'struct',
        'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
        'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
        'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
        'abs', 'sign', 'floor', 'ceil', 'round', 'trunc', 'fract',
        'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep',
        'length', 'distance', 'dot', 'cross', 'normalize',
        'reflect', 'refract', 'dFdx', 'dFdy', 'fwidth',
        'determinant', 'inverse', 'transpose', 'outerProduct', 'matrixCompMult',
        'equal', 'notEqual', 'lessThan', 'lessThanEqual',
        'greaterThan', 'greaterThanEqual',
        'texture', 'texture2D', 'textureCube', 'texelFetch',
        'any', 'all', 'not'
    ]);

    const SCALAR_RETURN_FUNCS = new Set(['length', 'distance', 'dot']);

    const INSP_FC = '_inspFC';

    const DEFAULT_MAPPING = { mode: 'linear', min: 0, max: 1, highlightOutOfRange: false };

    const RANGE_ANNOTATION = /\/\/\s*\[\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\]/;
    const SIMPLE_VARIABLE_RE = /^[a-zA-Z_]\w*(?:\.[xyzwrgba]{1,4})?$/;

    // ── Utility ─────────────────────────────────────────────────────

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function typeDimension(t) {
        switch (t) {
            case 'vec2': case 'ivec2': case 'uvec2': return 2;
            case 'vec3': case 'ivec3': case 'uvec3': return 3;
            case 'vec4': case 'ivec4': case 'uvec4': return 4;
            default: return 1;
        }
    }

    function isSupportedInspectableType(type) {
        return /^(float|int|uint|vec[234]|ivec[234]|uvec[234])$/.test(type || '');
    }

    function isVectorType(type) {
        return /^(vec[234]|ivec[234]|uvec[234])$/.test(type || '');
    }

    function getInspectableComponentCount(type) {
        return Math.max(1, Math.min(4, typeDimension(type)));
    }

    // ── Type Inference (port of a2 pipeline) ────────────────────────

    /** Resolve swizzle suffix → GLSL type (port of $v) */
    function resolveSwizzle(suffix) {
        if (!/^\.(x|y|z|w|r|g|b|a|xy|xz|xw|yx|yz|yw|zx|zy|zw|wx|wy|wz|xyz|xyw|xzw|yzw|rgba|rgb|xyzw)$/.test(suffix)) {
            return null;
        }
        const len = suffix.length - 1;
        return len === 1 ? 'float' : len === 2 ? 'vec2' : len === 3 ? 'vec3' : len === 4 ? 'vec4' : null;
    }

    /** Parse function signature (port of ep) */
    function parseFunctionSignature(source, name) {
        const escaped = escapeRegex(name);
        const re = new RegExp(`\\b(${TYPE_REGEX_STR})\\s+${escaped}\\s*\\(([^)]*)\\)`, 'g');
        const m = re.exec(source);
        return m ? { returnType: m[1], name: name, params: m[2] } : null;
    }

    /** Generate mock arguments for function call visualization (port of G8) */
    function generateMockArgs(params) {
        if (!params.trim()) return '';
        return params.split(',').map(p => p.trim().split(/\s+/)[0]).map(t => {
            if (t === 'vec2') return 'gl_FragCoord.xy / u_resolution.xy';
            if (t === 'vec3') return 'vec3(gl_FragCoord.xy / u_resolution.xy, 0.0)';
            if (t === 'vec4') return 'vec4(gl_FragCoord.xy / u_resolution.xy, 0.0, 1.0)';
            if (t === 'float') return 'u_time';
            if (t === 'int') return '0';
            if (t === 'bool') return 'false';
            return 'vec2(0.0)';
        }).join(', ');
    }

    /** Infer type from literal/constructor (port of n4) */
    function inferLiteralType(expr) {
        const t = expr.trim();
        if (/^-?\d+\.?\d*([eE][+-]?\d+)?[fF]?$/.test(t)) return 'float';
        if (/^-?\d+$/.test(t)) return 'int';
        const m = t.match(new RegExp(`^(${TYPE_REGEX_STR})\\s*\\(`));
        if (m) return m[1];
        const m2 = t.match(new RegExp(`^(${TYPE_REGEX_STR})\b`));
        return m2 ? m2[1] : null;
    }

    /** Resolve variable type from builtins, uniforms, or declarations (port of C0) */
    function resolveVariableType(source, name, targetLine) {
        if (BUILTIN_VARIABLES[name] !== undefined) return BUILTIN_VARIABLES[name];
        if (UNIFORM_TYPES[name] !== undefined) return UNIFORM_TYPES[name];

        // Handle swizzle: e.g., color.rgb
        const dotIdx = name.indexOf('.');
        if (dotIdx > 0) {
            const base = name.slice(0, dotIdx);
            const swiz = name.slice(dotIdx);
            const baseType = resolveVariableType(source, base, targetLine);
            const swizzleType = resolveSwizzle(swiz);
            if (baseType && swizzleType) {
                return swizzleType;
            }
            return baseType;
        }

        // Check declaration in source — prefer nearest to targetLine
        const escaped = escapeRegex(name);
        const declRe = new RegExp(`\\b(${TYPE_REGEX_STR})\\s+${escaped}\\b`, 'g');
        let m, bestMatch = null;
        if (targetLine !== undefined && targetLine > 0) {
            // Find all matches and pick the nearest one at or before target line
            while ((m = declRe.exec(source)) !== null) {
                const matchLine = lineAtOffset(source, m.index);
                if (matchLine <= targetLine) {
                    if (!bestMatch || matchLine >= bestMatch.line) {
                        bestMatch = { type: m[1], line: matchLine };
                    }
                }
            }
            // Fallback: if no match before target, take the first match
            if (!bestMatch) {
                declRe.lastIndex = 0;
                m = declRe.exec(source);
                if (m) bestMatch = { type: m[1], line: 0 };
            }
        } else {
            // No line info — take the last match (most likely in-scope)
            while ((m = declRe.exec(source)) !== null) {
                bestMatch = { type: m[1], line: 0 };
            }
        }
        return bestMatch ? bestMatch.type : null;
    }

    function tryResolveInspectableVariable(source, variable, targetLine) {
        const candidate = (variable || '').trim();
        if (!candidate || !SIMPLE_VARIABLE_RE.test(candidate)) return null;

        const dotIdx = candidate.indexOf('.');
        const base = dotIdx > 0 ? candidate.slice(0, dotIdx) : candidate;
        const swizzle = dotIdx > 0 ? candidate.slice(dotIdx) : '';
        if (GLSL_KEYWORDS.has(base)) return null;

        const def = resolveDefine(base, source);
        const baseType = def ? inferLiteralType(def) : resolveVariableType(source, base, targetLine);
        if (!isSupportedInspectableType(baseType)) return null;

        if (!swizzle) {
            return {
                variable: candidate,
                resolvedExpr: def ?? candidate,
                type: baseType
            };
        }

        const swizzleType = resolveSwizzle(swizzle);
        if (!swizzleType || typeDimension(baseType) < 2) return null;

        if (isVectorType(baseType)) {
            return {
                variable: base,
                resolvedExpr: def ? `(${def})` : base,
                type: baseType
            };
        }

        return {
            variable: candidate,
            resolvedExpr: def ? `(${def})${swizzle}` : candidate,
            type: swizzleType
        };
    }

    /** Complex expression analysis (port of mb) */
    function inferExpressionType(expr, source) {
        let best = 'float';
        let bestDim = 1;
        const promote = (t) => {
            if (!t) return;
            const d = typeDimension(t);
            if (d > bestDim) { best = t; bestDim = d; }
        };

        // Type constructors: vec3(...)
        const ctorRe = new RegExp(`\\b(${TYPE_REGEX_STR})\\s*\\(`, 'g');
        let m;
        while ((m = ctorRe.exec(expr)) !== null) promote(m[1]);
        if (bestDim > 1) return best;

        // Function calls
        const fnRe = /\b(\w+)\s*\(/g;
        while ((m = fnRe.exec(expr)) !== null) {
            const fn = m[1];
            if (fn === 'texture' || fn === 'texture2D' || fn === 'textureCube') promote('vec4');
            else if (fn === 'cross') promote('vec3');
            else {
                const sig = parseFunctionSignature(source, fn);
                if (sig) promote(sig.returnType);
            }
        }
        if (bestDim > 1) return best;

        // Swizzle suffixes
        const swizRe = /\b\w+(\.[xyzwrgba]+)\b/g;
        while ((m = swizRe.exec(expr)) !== null) {
            const t = resolveSwizzle(m[1]);
            if (t) promote(t);
        }

        // Uniform references
        for (const [u, t] of Object.entries(UNIFORM_TYPES)) {
            if (new RegExp(`\\b${escapeRegex(u)}\\b`).test(expr)) promote(t);
        }

        // Variable declarations in scope
        const idRe = /\b([a-zA-Z_]\w*)\b/g;
        while ((m = idRe.exec(expr)) !== null) {
            const id = m[1];
            if (!GLSL_KEYWORDS.has(id) && !STANDARD_UNIFORMS.has(id)) {
                promote(resolveVariableType(source, id));
            }
        }

        return best;
    }

    /** Function call type inference (port of r4) */
    function inferFunctionCallType(expr, source) {
        const t = expr.trim();
        const m = t.match(/^(\w+)\s*\(/);
        if (m) {
            const fn = m[1];
            if (new RegExp(`^(${TYPE_REGEX_STR})$`).test(fn)) return fn;
            if (SCALAR_RETURN_FUNCS.has(fn)) return 'float';
            if (fn === 'texture' || fn === 'texture2D' || fn === 'textureCube') return 'vec4';
            if (fn === 'cross') return 'vec3';
            const sig = parseFunctionSignature(source, fn);
            if (sig) return sig.returnType;
            return inferExpressionType(t.slice(m[0].length), source);
        }
        return inferExpressionType(t, source);
    }

    /** Parse #define macros (port of Dj) */
    function parseDefines(source) {
        const defs = {};
        const re = /^\s*#\s*define\s+(\w+)(?!\s*\()\s+(.+)$/gm;
        let m;
        while ((m = re.exec(source)) !== null) {
            let val = m[2].trim();
            const commentIdx = val.indexOf('//');
            if (commentIdx >= 0) val = val.slice(0, commentIdx).trimEnd();
            if (val) defs[m[1]] = val;
        }
        return defs;
    }

    /** Resolve #define macro value (port of s4) */
    function resolveDefine(name, source) {
        if (!/^\w+$/.test(name)) return null;
        return parseDefines(source)[name] ?? null;
    }

    /** Main type resolver (port of a2) */
    function inferType(source, variable, targetLine) {
        // 1. User function?
        const sig = parseFunctionSignature(source, variable);
        if (sig) return sig.returnType;

        // 2. #define macro?
        const def = resolveDefine(variable, source);
        if (def) return inferLiteralType(def);

        // 3. Simple word → builtins / uniforms / declarations
        if (/^\w+$/.test(variable)) return resolveVariableType(source, variable, targetLine);

        // 4. Complex expression → function call / heuristic
        return inferFunctionCallType(variable, source);
    }

    // ── Shader Rewriting (port of Bj/Oj pipeline) ──────────────────

    /** Coerce any GLSL type to vec4 for visualization (port of K1) */
    function coerceToVec4(expr, type) {
        switch (type) {
            case 'float': case 'int': case 'uint':
                return `vec4(${expr}, ${expr}, ${expr}, 1.0)`;
            case 'vec2': case 'ivec2': case 'uvec2':
                return `vec4(${expr}, 0.0, 1.0)`;
            case 'vec3': case 'ivec3': case 'uvec3':
                return `vec4(${expr}, 1.0)`;
            case 'vec4': case 'ivec4': case 'uvec4':
                return `vec4(${expr})`;
            default:
                return `vec4(vec3(${expr}), 1.0)`;
        }
    }

    /** Generate _inspMap() GLSL function (port of Fj) */
    function generateInspMap(mapping) {
        const mn = mapping.min.toFixed(6);
        const mx = mapping.max.toFixed(6);
        const range = Math.max(mapping.max - mapping.min, 1e-6).toFixed(6);

        const oor = (mapping.highlightOutOfRange ?? false) ? `
  bool belowMin = any(lessThan(v.rgb, vec3(${mn})));
  bool aboveMax = any(greaterThan(v.rgb, vec3(${mx})));
  if (belowMin || aboveMax) {
    float _ck = mod(floor(gl_FragCoord.x / 4.0) + floor(gl_FragCoord.y / 4.0), 2.0);
    if (belowMin) return vec4(_ck, 0.0, _ck, 1.0);
    else          return vec4(0.0, _ck, _ck, 1.0);
  }
` : '';

        switch (mapping.mode) {
            case 'linear': return `
vec4 _inspMap(vec4 v) {${oor}
  vec3 t = clamp((v.rgb - ${mn}) / ${range}, 0.0, 1.0);
  return vec4(t, 1.0);
}
`;
            case 'sigmoid': return `
vec4 _inspMap(vec4 v) {${oor}
  vec3 t = (v.rgb - ${mn}) / ${range};
  vec3 s = vec3(1.0) / (vec3(1.0) + exp(-8.0 * (2.0 * t - 1.0)));
  return vec4(s, 1.0);
}
`;
            case 'log': return `
vec4 _inspMap(vec4 v) {${oor}
  vec3 t = clamp((v.rgb - ${mn}) / ${range}, 0.0, 1.0);
  vec3 o = log2(1.0 + t * 255.0) / log2(256.0);
  return vec4(o, 1.0);
}
`;
            default: return generateInspMap({ ...mapping, mode: 'linear' });
        }
    }

    /** Find void main() boundaries (port of H8) */
    function findMainFunction(source) {
        // Try mainImage first (ShaderToy convention)
        let m = source.match(/\bvoid\s+mainImage\s*\(\s*out\s+vec4\s+\w+\s*,\s*(?:in\s+)?vec2\s+\w+\s*\)\s*\{/);
        if (m && m.index !== undefined) {
            const mainDeclStart = m.index;
            const bodyStart = m.index + m[0].length;
            let depth = 1, i = bodyStart;
            while (i < source.length && depth > 0) {
                if (source[i] === '{') depth++;
                else if (source[i] === '}') depth--;
                i++;
            }
            return { mainDeclStart, bodyStart, closeBrace: i - 1, isMainImage: true };
        }

        // Standard void main()
        m = source.match(/\bvoid\s+main\s*\(\s*\)\s*\{/);
        if (!m || m.index === undefined) return null;
        const mainDeclStart = m.index;
        const bodyStart = m.index + m[0].length;
        let depth = 1, i = bodyStart;
        while (i < source.length && depth > 0) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') depth--;
            i++;
        }
        return { mainDeclStart, bodyStart, closeBrace: i - 1, isMainImage: false };
    }

    /** Replace fragColor/gl_FragColor with _inspFC (port of Y1) */
    function replaceFragColor(body) {
        return body.replace(/\b(?:fragColor|gl_FragColor)\b/g, INSP_FC);
    }

    /** Get line number from character offset (port of Uj helper) */
    function lineAtOffset(source, offset) {
        return (source.slice(0, offset).match(/\n/g) || []).length + 1;
    }

    /** Get the line count of the shader preamble (before #line 1 0 directive). */
    function getPreambleOffset(source) {
        const m = source.match(/(^|\n)#line\s+1\b/);
        if (!m) return 0;
        // The #line directive itself is on this line; user code starts on the next line
        return lineAtOffset(source, m.index + (m[1].length || 0));
    }

    /** Compute insertion point in main body (port of q8) */
    function findInsertionPoint(body, variable, source, bodyStart, inspectorLine) {
        if (inspectorLine === undefined) return body.length;

        const mainStartLine = lineAtOffset(source, bodyStart);
        const relativeLine = inspectorLine - mainStartLine;
        const lines = body.split('\n');

        if (relativeLine < 0 || relativeLine >= lines.length) return body.length;

        // Compute offset to end of target line
        let offset = 0;
        for (let k = 0; k < relativeLine; k++) offset += lines[k].length + 1;
        let endOfLine = offset + lines[relativeLine].length + 1;
        endOfLine = Math.min(endOfLine, body.length);

        // Check for unclosed parens/brackets at endOfLine
        let parenDepth = 0, bracketDepth = 0;
        for (let k = 0; k < endOfLine; k++) {
            const ch = body[k];
            if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth--;
            else if (ch === '[') bracketDepth++;
            else if (ch === ']') bracketDepth--;
        }
        if (parenDepth > 0 || bracketDepth > 0) {
            const semi = body.indexOf(';', endOfLine);
            if (semi !== -1) endOfLine = semi + 1;
        }

        // Check for unclosed parens at start offset → skip to endOfLine
        let startParen = 0, startBracket = 0;
        for (let k = 0; k < offset; k++) {
            const ch = body[k];
            if (ch === '(') startParen++;
            else if (ch === ')') startParen--;
            else if (ch === '[') startBracket++;
            else if (ch === ']') startBracket--;
        }
        if (startParen > 0 || startBracket > 0) return endOfLine;

        // If the variable is declared on this line, return insertion at end of line
        const varWord = variable.match(/^\w+/);
        if (varWord) {
            const escaped = escapeRegex(varWord[0]);
            if (new RegExp(`\\b(?:float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|mat[234])\\s+${escaped}\\b`).test(lines[relativeLine])) {
                return endOfLine;
            }
        }

        return offset;
    }

    /** Fix bare for-loop expressions (port of K8) */
    function fixForLoopScoping(source) {
        const LOOP_KEYWORDS = new Set([
            'for', 'while', 'do', 'if', 'switch', 'return', 'break', 'continue', 'discard',
            'float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4',
            'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
            'mat2', 'mat3', 'mat4', 'const', 'highp', 'mediump', 'lowp'
        ]);

        let result = source;
        let changed = true;
        while (changed) {
            changed = false;
            const loopRe = /\b(?:for|while)\s*\(/g;
            let m;
            while ((m = loopRe.exec(result)) !== null) {
                const parenStart = m.index + m[0].length - 1;
                let depth = 1, pos = parenStart + 1;
                while (pos < result.length && depth > 0) {
                    if (result[pos] === '(') depth++;
                    else if (result[pos] === ')') depth--;
                    pos++;
                }
                if (depth !== 0) continue;

                const closeParen = pos - 1;
                let afterParen = closeParen + 1;
                while (afterParen < result.length && /\s/.test(result[afterParen])) afterParen++;

                if (afterParen >= result.length || result[afterParen] === '{' || result[afterParen] === ';') continue;

                const wordMatch = result.slice(afterParen).match(/^\w+/);
                if (wordMatch && LOOP_KEYWORDS.has(wordMatch[0])) continue;

                // Find the semicolon that ends this bare statement
                let pDepth = 0, bDepth = 0, semiPos = -1;
                for (let j = afterParen; j < result.length; j++) {
                    if (result[j] === '(') pDepth++;
                    else if (result[j] === ')') pDepth--;
                    else if (result[j] === '{') bDepth++;
                    else if (result[j] === '}') bDepth--;
                    else if (result[j] === ';' && pDepth === 0 && bDepth === 0) {
                        semiPos = j;
                        break;
                    }
                }
                if (semiPos === -1) continue;

                // Wrap in braces
                result = result.slice(0, semiPos + 1) + ' }' + result.slice(semiPos + 1);
                result = result.slice(0, closeParen + 1) + ' {' + result.slice(closeParen + 1);
                changed = true;
                break;
            }
        }
        return result;
    }

    /** Parse range annotation from comments (port of Pj) */
    function parseRangeAnnotation(source, variable) {
        const lines = source.split(/\r?\n/);
        const escaped = escapeRegex(variable);
        const varRe = new RegExp(`\\b${escaped}\\b`);

        for (let i = 0; i < lines.length; i++) {
            if (!varRe.test(lines[i])) continue;
            const m = lines[i].match(RANGE_ANNOTATION);
            if (m) {
                const min = parseFloat(m[1]), max = parseFloat(m[2]);
                if (!isNaN(min) && !isNaN(max) && max >= min) return { min, max };
            }
            if (i > 0) {
                const m2 = lines[i - 1].match(RANGE_ANNOTATION);
                if (m2) {
                    const min = parseFloat(m2[1]), max = parseFloat(m2[2]);
                    if (!isNaN(min) && !isNaN(max) && max >= min) return { min, max };
                }
            }
        }
        return null;
    }

    /** Build inspector shader with mapping (port of vb) */
    function buildInspectorShader(source, variable, vec4Expr, mapping, isFunc, inspectorLine) {
        const inspMap = generateInspMap(mapping);
        const bounds = findMainFunction(source);
        if (!bounds) return null;

        const prefix = source.slice(0, bounds.mainDeclStart);
        // Preserve anything after the target function (e.g. the void main() wrapper for mainImage shaders)
        const suffix = source.slice(bounds.closeBrace + 1);

        if (isFunc) {
            if (bounds.isMainImage) {
                return prefix + inspMap +
                    `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n` +
                    `  fragColor = _inspMap(${vec4Expr});\n}\n` + suffix;
            }
            return prefix + inspMap +
                `void main() {\n  gl_FragColor = _inspMap(${vec4Expr});\n}\n`;
        }

        let body = source.slice(bounds.bodyStart, bounds.closeBrace);
        body = fixForLoopScoping(body);
        body = replaceFragColor(body);
        const mappedExpr = replaceFragColor(vec4Expr);

        const insertPt = findInsertionPoint(body, variable, source, bounds.bodyStart, inspectorLine);
        const before = body.slice(0, insertPt);
        const after = body.slice(insertPt);

        if (bounds.isMainImage) {
            return prefix + inspMap +
                `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n` +
                `vec4 ${INSP_FC} = vec4(0.0);\n` +
                before +
                `\n  fragColor = _inspMap(${mappedExpr});` + after +
                `\n}\n` + suffix;
        }
        return prefix + inspMap +
            `void main() {\nvec4 ${INSP_FC} = vec4(0.0);\n` +
            before +
            `\n  gl_FragColor = _inspMap(${mappedExpr});` + after +
            `\n}\n`;
    }

    /** Build compare shader without mapping (port of gb) */
    function buildCompareShader(source, variable, vec4Expr, isFunc, inspectorLine) {
        const bounds = findMainFunction(source);
        if (!bounds) return null;

        const prefix = source.slice(0, bounds.mainDeclStart);
        // Preserve anything after the target function (e.g. the void main() wrapper for mainImage shaders)
        const suffix = source.slice(bounds.closeBrace + 1);

        if (isFunc) {
            if (bounds.isMainImage) {
                return prefix +
                    `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n` +
                    `  fragColor = ${vec4Expr};\n}\n` + suffix;
            }
            return prefix + `void main() {\n  gl_FragColor = ${vec4Expr};\n}\n`;
        }

        let body = source.slice(bounds.bodyStart, bounds.closeBrace);
        body = fixForLoopScoping(body);
        body = replaceFragColor(body);
        const mappedExpr = replaceFragColor(vec4Expr);

        const insertPt = findInsertionPoint(body, variable, source, bounds.bodyStart, inspectorLine);
        const before = body.slice(0, insertPt);
        const after = body.slice(insertPt);

        if (bounds.isMainImage) {
            return prefix +
                `void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n` +
                `vec4 ${INSP_FC} = vec4(0.0);\n` +
                before +
                `\n  fragColor = ${mappedExpr};` + after +
                `\n}\n` + suffix;
        }
        return prefix +
            `void main() {\nvec4 ${INSP_FC} = vec4(0.0);\n` +
            before +
            `\n  gl_FragColor = ${mappedExpr};` + after +
            `\n}\n`;
    }

    /** Main entry: rewrite for inspector with mapping (port of Bj) */
    function rewriteForInspector(source, variable, mapping, inspectorLine) {
        mapping = mapping || DEFAULT_MAPPING;

        const sig = parseFunctionSignature(source, variable);
        if (sig) {
            const args = generateMockArgs(sig.params);
            const call = `${sig.name}(${args})`;
            const vec4Expr = coerceToVec4(call, sig.returnType);
            return buildInspectorShader(source, variable, vec4Expr, mapping, true, inspectorLine);
        }

        const def = resolveDefine(variable, source);
        const resolved = def ?? variable;
        const type = def ? inferLiteralType(def) :
            (/^\w+$/.test(variable) ? resolveVariableType(source, variable, inspectorLine) : inferFunctionCallType(variable, source));

        return buildInspectorShader(source, variable, coerceToVec4(resolved, type), mapping, false, inspectorLine);
    }

    /** Main entry: rewrite for compare/raw output (port of Oj) */
    function rewriteForCompare(source, variable, inspectorLine) {
        const sig = parseFunctionSignature(source, variable);
        if (sig) {
            const args = generateMockArgs(sig.params);
            const call = `${sig.name}(${args})`;
            const vec4Expr = coerceToVec4(call, sig.returnType);
            return buildCompareShader(source, variable, vec4Expr, true, inspectorLine);
        }

        const def = resolveDefine(variable, source);
        const resolved = def ?? variable;
        const type = def ? inferLiteralType(def) :
            (/^\w+$/.test(variable) ? resolveVariableType(source, variable, inspectorLine) : inferFunctionCallType(variable, source));

        return buildCompareShader(source, variable, coerceToVec4(resolved, type), false, inspectorLine);
    }

    // ── Webview Integration ─────────────────────────────────────────

    let _active = false;
    let _variable = '';
    let _line = 0;
    let _mapping = { ...DEFAULT_MAPPING };
    let _compareMode = false;
    let _compareSplit = 0.5;
    let _hoverEnabled = true;
    let _histogramEnabled = true;
    let _histogramIntervalMs = 200;
    let _histogramSampleStride = 8;
    let _histogramDirty = false;
    let _histogramTimer = null;
    let _histogramPixelBuf = null;   // cached Uint8Array for readback
    let _histogramFloatBuf = null;
    let _histogramQueuedPixelBuf = null;
    let _histogramQueuedFloatBuf = null;
    let _histogramQueuedTotalPixels = 0;
    let _histogramQueuedGeneration = 0;
    let _histogramQueuedStartedAtMs = 0;
    let _histogramQueuedValueMode = 'byte';
    let _histogramQueuedSampleStride = 8;
    let _histogramQueuedDisplayMin = 0;
    let _histogramQueuedDisplayMax = 1;
    let _histogramHasQueuedFrame = false;
    let _histogramProcessing = false;
    let _histogramStalled = false;
    let _histogramGeneration = 0;
    let _histogramMaterial = null;
    let _histogramTarget = null;
    let _lastHistogramSource = '';
    let _inspectorMaterial = null;
    let _inspectorType = '';
    let _compareOriginalMaterial = null;
    let _compareOverlayRoot = null;
    let _compareOverlayDivider = null;
    let _compareOverlayLeft = null;
    let _compareOverlayRight = null;
    let _originalMaterials = new Map();  // bufferIndex → original material
    let _originalFragmentShaders = new Map(); // bufferIndex → original fragment shader source
    let _lastRewrittenSource = '';
    let _debounceTimer = null;

    function requestPreviewFrame() {
        if (typeof paused !== 'undefined' && paused && typeof freezeSimulationOnNextForcedRender !== 'undefined') {
            freezeSimulationOnNextForcedRender = true;
        }
        if (typeof forceRenderOneFrame !== 'undefined') {
            forceRenderOneFrame = true;
        }
    }

    function markShaderMaterialDirty(material) {
        material.needsUpdate = true;
        if (typeof quad !== 'undefined' && quad) {
            quad.material = material;
        }
        requestPreviewFrame();
    }

    function normalizeHistogramInterval(intervalMs) {
        const numericInterval = Number(intervalMs);
        return numericInterval === 200 || numericInterval === 100 || numericInterval === 1000
            ? numericInterval
            : 1000;
    }

    function normalizeHistogramSampleStride(sampleStride) {
        const numericStride = Number(sampleStride);
        return numericStride === 1 || numericStride === 8 || numericStride === 64
            ? numericStride
            : 8;
    }

    function normalizeCompareSplit(split) {
        const numericSplit = Number(split);
        if (!Number.isFinite(numericSplit)) return 0.5;
        return Math.max(0.1, Math.min(0.9, numericSplit));
    }

    function getNowMs() {
        if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    function canUseRawHistogram() {
        return typeof THREE !== 'undefined' &&
            typeof renderer !== 'undefined' && renderer &&
            typeof renderer.readRenderTargetPixels === 'function' &&
            typeof supportsFloatFramebuffer !== 'undefined' &&
            supportsFloatFramebuffer;
    }

    function scheduleHistogramWork(callback) {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(callback, { timeout: 50 });
            return;
        }
        setTimeout(function () {
            callback({
                didTimeout: true,
                timeRemaining: function () { return 0; }
            });
        }, 0);
    }

    function ensureHistogramByteBuffer(needed, queued) {
        if (queued) {
            if (!_histogramQueuedPixelBuf || _histogramQueuedPixelBuf.length < needed) {
                _histogramQueuedPixelBuf = new Uint8Array(needed);
            }
            return _histogramQueuedPixelBuf;
        }
        if (!_histogramPixelBuf || _histogramPixelBuf.length < needed) {
            _histogramPixelBuf = new Uint8Array(needed);
        }
        return _histogramPixelBuf;
    }

    function ensureHistogramFloatBuffer(totalPixels, queued) {
        const needed = totalPixels * 4;
        if (queued) {
            if (!_histogramQueuedFloatBuf || _histogramQueuedFloatBuf.length < needed) {
                _histogramQueuedFloatBuf = new Float32Array(needed);
            }
            return _histogramQueuedFloatBuf;
        }
        if (!_histogramFloatBuf || _histogramFloatBuf.length < needed) {
            _histogramFloatBuf = new Float32Array(needed);
        }
        return _histogramFloatBuf;
    }

    function disposeHistogramResources() {
        if (_histogramMaterial && typeof _histogramMaterial.dispose === 'function') {
            _histogramMaterial.dispose();
        }
        if (_histogramTarget && typeof _histogramTarget.dispose === 'function') {
            _histogramTarget.dispose();
        }
        _histogramMaterial = null;
        _histogramTarget = null;
        _lastHistogramSource = '';
    }

    function syncHistogramMaterial(origMat, preparedSource) {
        if (!preparedSource || !canUseRawHistogram()) {
            disposeHistogramResources();
            return;
        }

        if (_histogramMaterial && _lastHistogramSource === preparedSource &&
            _histogramMaterial.vertexShader === origMat.vertexShader &&
            _histogramMaterial.glslVersion === origMat.glslVersion) {
            _histogramMaterial.uniforms = origMat.uniforms;
            return;
        }

        if (_histogramMaterial && typeof _histogramMaterial.dispose === 'function') {
            _histogramMaterial.dispose();
        }

        _histogramMaterial = new THREE.ShaderMaterial({
            glslVersion: origMat.glslVersion,
            fragmentShader: preparedSource,
            vertexShader: origMat.vertexShader,
            uniforms: origMat.uniforms,
            depthWrite: false,
            depthTest: false
        });
        _lastHistogramSource = preparedSource;
    }

    function disposeCompareOriginalMaterial() {
        if (_compareOriginalMaterial && typeof _compareOriginalMaterial.dispose === 'function') {
            _compareOriginalMaterial.dispose();
        }
        _compareOriginalMaterial = null;
    }

    function syncCompareOriginalMaterial(bufferIndex, origMat) {
        if (typeof THREE === 'undefined') return;
        const originalFragmentShader = _originalFragmentShaders.get(bufferIndex);
        if (typeof originalFragmentShader !== 'string') {
            disposeCompareOriginalMaterial();
            return;
        }

        if (_compareOriginalMaterial &&
            _compareOriginalMaterial.fragmentShader === originalFragmentShader &&
            _compareOriginalMaterial.vertexShader === origMat.vertexShader &&
            _compareOriginalMaterial.glslVersion === origMat.glslVersion) {
            _compareOriginalMaterial.uniforms = origMat.uniforms;
            return;
        }

        disposeCompareOriginalMaterial();
        _compareOriginalMaterial = new THREE.ShaderMaterial({
            glslVersion: origMat.glslVersion,
            fragmentShader: originalFragmentShader,
            vertexShader: origMat.vertexShader,
            uniforms: origMat.uniforms,
            depthWrite: false,
            depthTest: false
        });
    }

    function ensureCompareOverlay() {
        if (_compareOverlayRoot || typeof document === 'undefined') return;
        const root = document.createElement('div');
        root.style.position = 'fixed';
        root.style.pointerEvents = 'none';
        root.style.zIndex = '30';
        root.style.display = 'none';

        const divider = document.createElement('div');
        divider.style.position = 'absolute';
        divider.style.top = '0';
        divider.style.bottom = '0';
        divider.style.width = '2px';
        divider.style.background = 'rgba(255, 255, 255, 0.8)';
        divider.style.boxShadow = '0 0 0 1px rgba(0, 0, 0, 0.35)';

        const leftLabel = document.createElement('div');
        leftLabel.textContent = 'Original';
        leftLabel.style.position = 'absolute';
        leftLabel.style.left = '8px';
        leftLabel.style.top = '8px';
        leftLabel.style.padding = '2px 6px';
        leftLabel.style.borderRadius = '999px';
        leftLabel.style.background = 'rgba(0, 0, 0, 0.55)';
        leftLabel.style.color = '#ffffff';
        leftLabel.style.font = '12px "Segoe UI", sans-serif';

        const rightLabel = document.createElement('div');
        rightLabel.textContent = 'Inspect';
        rightLabel.style.position = 'absolute';
        rightLabel.style.right = '8px';
        rightLabel.style.top = '8px';
        rightLabel.style.padding = '2px 6px';
        rightLabel.style.borderRadius = '999px';
        rightLabel.style.background = 'rgba(0, 0, 0, 0.55)';
        rightLabel.style.color = '#ffffff';
        rightLabel.style.font = '12px "Segoe UI", sans-serif';

        root.appendChild(divider);
        root.appendChild(leftLabel);
        root.appendChild(rightLabel);
        document.body.appendChild(root);

        _compareOverlayRoot = root;
        _compareOverlayDivider = divider;
        _compareOverlayLeft = leftLabel;
        _compareOverlayRight = rightLabel;
    }

    function updateCompareOverlay() {
        ensureCompareOverlay();
        if (!_compareOverlayRoot) return;

        const canvas = document.getElementById('canvas');
        const shouldShow = !!(_active && _compareMode && _inspectorMaterial && _compareOriginalMaterial && canvas);
        _compareOverlayRoot.style.display = shouldShow ? 'block' : 'none';
        if (!shouldShow) return;

        const rect = canvas.getBoundingClientRect();
        _compareOverlayRoot.style.left = rect.left + 'px';
        _compareOverlayRoot.style.top = rect.top + 'px';
        _compareOverlayRoot.style.width = rect.width + 'px';
        _compareOverlayRoot.style.height = rect.height + 'px';
        _compareOverlayDivider.style.left = Math.floor(rect.width * _compareSplit) + 'px';
    }

    function renderBuffer(buffer, bufferIndex, totalBuffers) {
        if (!_active || !_compareMode || !_inspectorMaterial || !_compareOriginalMaterial) return false;
        if (!buffer || bufferIndex !== totalBuffers - 1) return false;
        if (typeof renderer === 'undefined' || !renderer || typeof renderer.render !== 'function') return false;
        if (typeof quad === 'undefined' || !quad || typeof scene === 'undefined' || typeof camera === 'undefined') return false;

        const canvas = renderer.domElement || document.getElementById('canvas');
        const width = canvas && canvas.width ? canvas.width : 0;
        const height = canvas && canvas.height ? canvas.height : 0;
        if (width <= 0 || height <= 0) return false;

        const splitX = Math.max(0, Math.min(width, Math.floor(width * _compareSplit)));
        const rightWidth = Math.max(0, width - splitX);
        const previousMaterial = quad.material;

        renderer.setRenderTarget(buffer.Target);
        if (typeof renderer.setScissorTest === 'function') renderer.setScissorTest(true);

        if (splitX > 0) {
            quad.material = _compareOriginalMaterial;
            if (typeof renderer.setViewport === 'function') renderer.setViewport(0, 0, splitX, height);
            if (typeof renderer.setScissor === 'function') renderer.setScissor(0, 0, splitX, height);
            renderer.render(scene, camera);
        }

        if (rightWidth > 0) {
            quad.material = _inspectorMaterial;
            if (typeof renderer.setViewport === 'function') renderer.setViewport(splitX, 0, rightWidth, height);
            if (typeof renderer.setScissor === 'function') renderer.setScissor(splitX, 0, rightWidth, height);
            renderer.render(scene, camera);
        }

        if (typeof renderer.setScissorTest === 'function') renderer.setScissorTest(false);
        if (typeof renderer.setViewport === 'function') renderer.setViewport(0, 0, width, height);
        if (typeof renderer.setScissor === 'function') renderer.setScissor(0, 0, width, height);
        quad.material = previousMaterial;
        updateCompareOverlay();
        return true;
    }

    function ensureHistogramTarget(width, height) {
        if (!canUseRawHistogram()) return null;
        if (_histogramTarget && _histogramTarget.width === width && _histogramTarget.height === height) {
            return _histogramTarget;
        }
        if (_histogramTarget && typeof _histogramTarget.dispose === 'function') {
            _histogramTarget.dispose();
        }
        _histogramTarget = new THREE.WebGLRenderTarget(width, height, {
            type: THREE.FloatType,
            depthBuffer: false,
            stencilBuffer: false
        });
        if (_histogramTarget.texture) {
            _histogramTarget.texture.minFilter = THREE.NearestFilter;
            _histogramTarget.texture.magFilter = THREE.NearestFilter;
        }
        return _histogramTarget;
    }

    function getHistogramCaptureDimensions(width, height, sampleStride) {
        const stride = normalizeHistogramSampleStride(sampleStride);
        if (stride === 1) {
            return { width: width, height: height, effectiveSampleStride: 1 };
        }

        const scale = 1 / Math.sqrt(stride);
        return {
            width: Math.max(1, Math.floor(width * scale)),
            height: Math.max(1, Math.floor(height * scale)),
            effectiveSampleStride: 1
        };
    }

    function postHistogram(binsR, binsG, binsB, binsA, samples, domainMin, domainMax, timeMs, componentCount, stalled) {
        if (typeof vscode !== 'undefined' && vscode) {
            vscode.postMessage({
                command: 'inspectorHistogram',
                histogram: {
                    binsR: binsR,
                    binsG: binsG,
                    binsB: binsB,
                    binsA: binsA,
                    bins: binsR.length,
                    samples: samples,
                    timeMs: timeMs,
                    autoMin: domainMin,
                    autoMax: domainMax,
                    componentCount: componentCount,
                    stalled: !!stalled
                }
            });
        }
    }

    function drainQueuedHistogram() {
        _histogramHasQueuedFrame = false;
        _histogramQueuedTotalPixels = 0;
        _histogramQueuedStartedAtMs = 0;
    }

    function cancelHistogramWork() {
        _histogramGeneration++;
        _histogramDirty = false;
        _histogramHasQueuedFrame = false;
        _histogramQueuedTotalPixels = 0;
        _histogramQueuedStartedAtMs = 0;
        _histogramQueuedValueMode = 'byte';
        _histogramQueuedSampleStride = 8;
        _histogramQueuedDisplayMin = 0;
        _histogramQueuedDisplayMax = 1;
        _histogramProcessing = false;
        _histogramStalled = false;
    }

    function startHistogramProcessing(pixels, totalPixels, generation, initialTimeMs, valueMode, sampleStride, displayMin, displayMax) {
        if (!pixels || totalPixels <= 0) return;

        _histogramProcessing = true;
        _histogramStalled = false;

        const BINS = 128;
        const binsR = new Float32Array(BINS);
        const binsG = new Float32Array(BINS);
        const binsB = new Float32Array(BINS);
        const binsA = new Float32Array(BINS);
        const byteScale = 1 / 255;
        const domainEpsilon = valueMode === 'float' ? 1e-9 : 1;
        const componentCount = getInspectableComponentCount(_inspectorType);

        let offset = 0;
        let pixelIndex = 0;
        let samples = 0;
        let phase = 'scan';
        let domainMinRaw = Number.POSITIVE_INFINITY;
        let domainMaxRaw = Number.NEGATIVE_INFINITY;
        let stableDomain = null;
        let activeProcessingMs = 0;
        const effectiveSampleStride = normalizeHistogramSampleStride(sampleStride);

        function getStableDomain(domainMin, domainMax) {
            if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax)) {
                return valueMode === 'float'
                    ? { min: 0, max: 1, span: 1, collapsed: false }
                    : { min: 0, max: 255, span: 255, collapsed: false };
            }
            const span = domainMax - domainMin;
            if (Math.abs(span) <= domainEpsilon) {
                return { min: domainMin, max: domainMax, span: 1, collapsed: true };
            }
            return { min: domainMin, max: domainMax, span: span, collapsed: false };
        }

        function toDisplayValue(value) {
            return valueMode === 'float' ? value : value * byteScale;
        }

        function step(deadline) {
            if (generation !== _histogramGeneration || !_active || !_histogramEnabled) {
                _histogramProcessing = false;
                _histogramStalled = false;
                drainQueuedHistogram();
                return;
            }

            const stepStartedAtMs = getNowMs();
            let processed = 0;
            const useDeadline = deadline && typeof deadline.timeRemaining === 'function';
            while (pixelIndex < totalPixels) {
                offset = pixelIndex * 4;
                const rv = pixels[offset];
                const gv = pixels[offset + 1];
                const bv = pixels[offset + 2];
                const av = pixels[offset + 3];

                if (phase === 'scan') {
                    let lo = rv;
                    let hi = rv;
                    if (componentCount >= 2) {
                        lo = Math.min(lo, gv);
                        hi = Math.max(hi, gv);
                    }
                    if (componentCount >= 3) {
                        lo = Math.min(lo, bv);
                        hi = Math.max(hi, bv);
                    }
                    if (componentCount >= 4) {
                        lo = Math.min(lo, av);
                        hi = Math.max(hi, av);
                    }
                    if (lo < domainMinRaw) domainMinRaw = lo;
                    if (hi > domainMaxRaw) domainMaxRaw = hi;
                } else {
                    if (stableDomain.collapsed) {
                        const centerIdx = BINS >> 1;
                        binsR[centerIdx]++;
                        if (componentCount >= 2) binsG[centerIdx]++;
                        if (componentCount >= 3) binsB[centerIdx]++;
                        if (componentCount >= 4) binsA[centerIdx]++;
                    } else {
                        const rIdx = Math.min(Math.max(Math.floor(((rv - stableDomain.min) / stableDomain.span) * BINS), 0), BINS - 1);
                        binsR[rIdx]++;
                        if (componentCount >= 2) {
                            const gIdx = Math.min(Math.max(Math.floor(((gv - stableDomain.min) / stableDomain.span) * BINS), 0), BINS - 1);
                            binsG[gIdx]++;
                        }
                        if (componentCount >= 3) {
                            const bIdx = Math.min(Math.max(Math.floor(((bv - stableDomain.min) / stableDomain.span) * BINS), 0), BINS - 1);
                            binsB[bIdx]++;
                        }
                        if (componentCount >= 4) {
                            const aIdx = Math.min(Math.max(Math.floor(((av - stableDomain.min) / stableDomain.span) * BINS), 0), BINS - 1);
                            binsA[aIdx]++;
                        }
                    }
                    samples++;
                }

                pixelIndex += effectiveSampleStride;
                processed++;

                if (useDeadline) {
                    if (processed >= 8192 && deadline.timeRemaining() <= 1) {
                        break;
                    }
                } else if (processed >= 65536) {
                    break;
                }
            }

            activeProcessingMs += getNowMs() - stepStartedAtMs;

            if (pixelIndex < totalPixels) {
                scheduleHistogramWork(step);
                return;
            }

            if (phase === 'scan') {
                stableDomain = getStableDomain(domainMinRaw, domainMaxRaw);
                phase = 'bin';
                pixelIndex = 0;
                scheduleHistogramWork(step);
                return;
            }

            _histogramProcessing = false;
            const stalled = _histogramStalled;
            _histogramStalled = false;
            postHistogram(
                binsR,
                binsG,
                binsB,
                binsA,
                samples,
                toDisplayValue(domainMinRaw),
                toDisplayValue(domainMaxRaw),
                initialTimeMs + activeProcessingMs,
                componentCount,
                stalled
            );
            drainQueuedHistogram();
        }

        scheduleHistogramWork(step);
    }

    /** Get the shader source for the final (image) buffer */
    function getShaderSource() {
        // On master, shaders live in <script type='x-shader/x-fragment'> tags
        const scripts = document.querySelectorAll('script[type="x-shader/x-fragment"]');
        if (scripts.length === 0) {
            // Fallback: try <textarea data-shadertoy="shader"> (hot-reload branch)
            const textareas = document.querySelectorAll('textarea[data-shadertoy="shader"]');
            if (textareas.length === 0) return '';
            return textareas[textareas.length - 1].value || '';
        }
        // The last script is the final/image buffer
        return scripts[scripts.length - 1].textContent || '';
    }

    /** Attempt to rewrite and recompile the inspector shader */
    function updateInspection() {
        if (!_active || !_variable) return;

        if (_debounceTimer) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(doInspection, 100);
    }

    function doInspection() {
        try {
            const source = getShaderSource();
            if (!source) {
                postStatus('error', 'No shader source found');
                return;
            }

            // Adjust VS Code editor line → source line (account for preamble)
            const sourceLine = _line > 0 ? _line + getPreambleOffset(source) : _line;
            const inspectTarget = tryResolveInspectableVariable(source, _variable, sourceLine);
            if (!inspectTarget) {
                return;
            }

            _variable = inspectTarget.variable;

            const type = inspectTarget.type;
            _inspectorType = type;
            const vec4Expr = coerceToVec4(inspectTarget.resolvedExpr, type);
            const rewritten = buildInspectorShader(source, inspectTarget.variable, vec4Expr, _mapping, false, sourceLine);

            if (!rewritten) {
                postStatus('error', 'Could not find main() in shader');
                return;
            }

            if (rewritten === _lastRewrittenSource) return;
            _lastRewrittenSource = rewritten;

            // Recompile via THREE.js
            if (typeof buffers !== 'undefined' && buffers.length > 0) {
                const finalIdx = buffers.length - 1;
                const finalBuffer = buffers[finalIdx];

                // Rewrite the original material in place so the existing render loop,
                // texture bindings, and uniform update paths all keep targeting the same object.
                const origMat = _originalMaterials.get(finalIdx) || finalBuffer.Shader;
                if (!_originalMaterials.has(finalIdx)) {
                    _originalMaterials.set(finalIdx, finalBuffer.Shader);
                    _originalFragmentShaders.set(finalIdx, finalBuffer.Shader.fragmentShader);
                }

                // Prepare the fragment shader the same way the normal compile path does:
                // adds layout(location=0) out, #define gl_FragColor, #define texture2D, etc.
                let prepared = rewritten;
                let histogramPrepared = rewriteForCompare(source, _variable, sourceLine);
                if (window.ShaderToy && window.ShaderToy.shaderCompile &&
                    window.ShaderToy.shaderCompile.prepareFragmentShader) {
                    const isWebGL2 = origMat.glslVersion === THREE.GLSL3;
                    prepared = window.ShaderToy.shaderCompile.prepareFragmentShader(rewritten, isWebGL2);
                    if (histogramPrepared) {
                        histogramPrepared = window.ShaderToy.shaderCompile.prepareFragmentShader(histogramPrepared, isWebGL2);
                    }
                }

                if (typeof currentShader !== 'undefined') {
                    currentShader = {
                        Name: finalBuffer.Name,
                        File: finalBuffer.File,
                        LineOffset: finalBuffer.LineOffset
                    };
                }

                origMat.fragmentShader = prepared;
                markShaderMaterialDirty(origMat);
                finalBuffer.Shader = origMat;
                _inspectorMaterial = origMat;
                syncHistogramMaterial(origMat, histogramPrepared);
                syncCompareOriginalMaterial(finalIdx, origMat);
                updateCompareOverlay();

                postStatus('ok', 'Inspecting: ' + _variable + ' (' + type + ')', _variable, type);
            }
        } catch (err) {
            postStatus('error', 'Rewrite error: ' + (err.message || err));
        }
    }

    /** Restore original shader material */
    function restoreOriginal() {
        if (typeof buffers !== 'undefined') {
            for (const [idx, mat] of _originalMaterials.entries()) {
                if (buffers[idx]) {
                    const originalFragmentShader = _originalFragmentShaders.get(idx);
                    if (typeof originalFragmentShader === 'string') {
                        mat.fragmentShader = originalFragmentShader;
                        markShaderMaterialDirty(mat);
                    }
                    buffers[idx].Shader = mat;
                }
            }
        }
        _originalMaterials.clear();
        _originalFragmentShaders.clear();
        disposeHistogramResources();
        disposeCompareOriginalMaterial();
        _inspectorMaterial = null;
        _inspectorType = '';
        _lastRewrittenSource = '';
        updateCompareOverlay();
    }

    /** Post status back to extension host */
    function postStatus(status, message, variable, type) {
        if (typeof vscode !== 'undefined' && vscode) {
            vscode.postMessage({
                command: 'inspectorStatus',
                status: status,
                message: message,
                variable: variable || _variable,
                type: type || ''
            });
        }
    }

    /** Pixel readback on hover — track mouse, read pixels after frame */
    let _mouseX = -1;
    let _mouseY = -1;
    let _mouseInCanvas = false;

    function setupHoverReadback() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        canvas.addEventListener('mousemove', function (e) {
            if (!_active || !_hoverEnabled) return;
            const rect = canvas.getBoundingClientRect();
            _mouseX = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
            _mouseY = canvas.height - Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
            _mouseInCanvas = true;
            if (typeof paused !== 'undefined' && paused) {
                requestPreviewFrame();
            }
        });

        canvas.addEventListener('mouseleave', function () {
            _mouseInCanvas = false;
        });
    }

    /** Called after each render frame completes (GL state is valid). */
    function afterFrame() {
        if (!_active) return;
        if (typeof gl === 'undefined') return;

        updateCompareOverlay();

        // Hover pixel readback (single pixel — negligible cost)
        if (_hoverEnabled && _mouseInCanvas && _mouseX >= 0 && _mouseY >= 0) {
            try {
                const pixel = new Uint8Array(4);
                gl.readPixels(_mouseX, _mouseY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                if (typeof vscode !== 'undefined' && vscode) {
                    vscode.postMessage({
                        command: 'inspectorPixel',
                        rgba: [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255, pixel[3] / 255],
                        position: { x: _mouseX, y: _mouseY }
                    });
                }
            } catch (err) { /* ignore */ }
        }

        // Histogram — snapshot framebuffer when dirty, then bin on idle
        if (_histogramEnabled && _histogramDirty) {
            _histogramDirty = false;
            snapshotForHistogram();
        }
    }

    /** One-shot full-framebuffer readPixels, then schedule CPU binning off the render path. */
    function snapshotForHistogram() {
        try {
            const canvas = document.getElementById('canvas');
            if (!canvas) return;
            const w = canvas.width, h = canvas.height;
            if (w <= 0 || h <= 0) return;

            if (_histogramProcessing) {
                _histogramStalled = true;
                return;
            }

            const totalPixels = w * h;
            const generation = ++_histogramGeneration;
            const snapshotStartedAtMs = getNowMs();
            const histogramMin = Number(_mapping.min);
            const histogramMax = Number(_mapping.max);
            const captureConfig = getHistogramCaptureDimensions(w, h, _histogramSampleStride);
            const captureWidth = captureConfig.width;
            const captureHeight = captureConfig.height;
            const capturePixels = captureWidth * captureHeight;
            const effectiveSampleStride = captureConfig.effectiveSampleStride;

            if (canUseRawHistogram() && _histogramMaterial) {
                const target = ensureHistogramTarget(captureWidth, captureHeight);
                if (target) {
                    const floatBuf = ensureHistogramFloatBuffer(capturePixels, false);
                    const previousMaterial = (typeof quad !== 'undefined' && quad) ? quad.material : null;

                    renderer.setRenderTarget(target);
                    if (typeof quad !== 'undefined' && quad) {
                        quad.material = _histogramMaterial;
                    }
                    renderer.render(scene, camera);
                    renderer.readRenderTargetPixels(target, 0, 0, captureWidth, captureHeight, floatBuf);
                    renderer.setRenderTarget(null);
                    if (typeof quad !== 'undefined' && quad) {
                        quad.material = previousMaterial;
                    }
                    const captureTimeMs = getNowMs() - snapshotStartedAtMs;

                    startHistogramProcessing(floatBuf, capturePixels, generation, captureTimeMs, 'float', effectiveSampleStride, histogramMin, histogramMax);
                    return;
                }
            }

            const needed = w * h * 4;
            const targetBuf = ensureHistogramByteBuffer(needed, false);

            // Fallback path — histogram from mapped screen output when raw float capture is unavailable.
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, targetBuf);
            const captureTimeMs = getNowMs() - snapshotStartedAtMs;

            startHistogramProcessing(targetBuf, totalPixels, generation, captureTimeMs, 'byte', normalizeHistogramSampleStride(_histogramSampleStride), 0, 1);
        } catch (err) { /* ignore */ }
    }

    /** Mark histogram as needing refresh (called after inspection changes, on a timer). */
    function requestHistogramUpdate() {
        _histogramDirty = true;
    }

    function requestHistogramUpdateNow() {
        if (!_histogramProcessing) {
            cancelHistogramWork();
        }
        _histogramDirty = true;
        requestPreviewFrame();
    }

    /** Start / stop the periodic histogram refresh timer. */
    function startHistogramTimer() {
        stopHistogramTimer();
        if (_histogramEnabled && _active) {
            // Initial snapshot after a short delay (let first frame render)
            _histogramDirty = true;
            _histogramTimer = setInterval(requestHistogramUpdate, _histogramIntervalMs);
        }
    }
    function stopHistogramTimer() {
        if (_histogramTimer) {
            clearInterval(_histogramTimer);
            _histogramTimer = null;
        }
    }

    // ── Message Handling ────────────────────────────────────────────

    function handleMessage(msg) {
        switch (msg.command) {
            case 'setInspectorVariable':
            {
                const nextVariable = msg.variable || '';
                const nextLine = msg.line || 0;
                const source = getShaderSource();
                const sourceLine = nextLine > 0 ? nextLine + getPreambleOffset(source) : nextLine;
                const inspectTarget = tryResolveInspectableVariable(source, nextVariable, sourceLine);
                if (!inspectTarget) {
                    break;
                }

                _variable = inspectTarget.variable;
                _line = nextLine;
                if (_active && _variable) {
                    updateInspection();
                    requestHistogramUpdate();
                }
                break;
            }

            case 'setInspectorMapping':
                if (msg.mapping) {
                    _mapping = { ...DEFAULT_MAPPING, ...msg.mapping };
                    _lastRewrittenSource = ''; // force recompile
                    if (_active && _variable) {
                        updateInspection();
                        requestHistogramUpdate();
                    }
                }
                break;

            case 'inspectorOn':
                if (!_active) {
                    _active = true;
                    if (_variable) updateInspection();
                    startHistogramTimer();
                }
                break;

            case 'inspectorOff':
                _active = false;
                stopHistogramTimer();
                cancelHistogramWork();
                restoreOriginal();
                postStatus('off', 'Inspector off');
                break;

            case 'setInspectorCompare':
                _compareMode = !!msg.enabled;
                updateCompareOverlay();
                if (_active && _variable) {
                    requestHistogramUpdate();
                    requestPreviewFrame();
                }
                break;

            case 'setInspectorCompareSplit':
                _compareSplit = normalizeCompareSplit(msg.split);
                updateCompareOverlay();
                if (_active && _compareMode) {
                    requestPreviewFrame();
                }
                break;

            case 'setInspectorHover':
                _hoverEnabled = !!msg.enabled;
                break;

            case 'setInspectorHistogram':
                _histogramEnabled = !!msg.enabled;
                if (_histogramEnabled) {
                    startHistogramTimer();
                } else {
                    stopHistogramTimer();
                    cancelHistogramWork();
                }
                break;

            case 'setInspectorHistogramInterval':
                _histogramIntervalMs = normalizeHistogramInterval(msg.intervalMs);
                if (_histogramEnabled && _active) {
                    startHistogramTimer();
                }
                break;

            case 'setInspectorHistogramSampleStride':
                _histogramSampleStride = normalizeHistogramSampleStride(msg.sampleStride);
                if (_histogramEnabled && _active) {
                    requestHistogramUpdateNow();
                }
                break;
        }
    }

    // ── Initialization ──────────────────────────────────────────────

    window.ShaderToy = window.ShaderToy || {};
    window.ShaderToy.inspector = {
        handleMessage: handleMessage,
        isActive: function () { return _active; },
        getVariable: function () { return _variable; },
        getMapping: function () { return { ..._mapping }; },
        getCompareSplit: function () { return _compareSplit; },
        isHoverEnabled: function () { return _hoverEnabled; },
        isHistogramEnabled: function () { return _histogramEnabled; },
        getHistogramIntervalMs: function () { return _histogramIntervalMs; },
        getHistogramSampleStride: function () { return _histogramSampleStride; },
        renderBuffer: renderBuffer,
        afterFrame: afterFrame,

        // Called on hot-reload to clear stale material references
        onHotReload: function () {
            _originalMaterials.clear();
            _originalFragmentShaders.clear();
            disposeHistogramResources();
            disposeCompareOriginalMaterial();
            _inspectorMaterial = null;
            _lastRewrittenSource = '';
            updateCompareOverlay();
            // Re-inspect with new materials if active
            if (_active && _variable) {
                updateInspection();
                requestHistogramUpdate();
            }
        },

        // Expose rewrite engine for testing
        rewrite: {
            inferType: inferType,
            coerceToVec4: coerceToVec4,
            rewriteForInspector: rewriteForInspector,
            rewriteForCompare: rewriteForCompare,
            findMainFunction: findMainFunction,
            generateInspMap: generateInspMap,
            parseRangeAnnotation: parseRangeAnnotation
        }
    };

    // Defer hover setup until DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupHoverReadback);
    } else {
        setupHoverReadback();
    }
    window.addEventListener('resize', updateCompareOverlay);
})();
