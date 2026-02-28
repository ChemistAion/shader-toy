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

    const TYPE_REGEX_STR = 'float|int|uint|bool|vec[234]|ivec[234]|uvec[234]|mat[234]';

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

    // ── Utility ─────────────────────────────────────────────────────

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function typeDimension(t) {
        switch (t) {
            case 'vec2': case 'ivec2': case 'uvec2': return 2;
            case 'vec3': case 'ivec3': case 'uvec3': return 3;
            case 'vec4': case 'ivec4': case 'uvec4': case 'mat2': case 'mat3': case 'mat4': return 4;
            default: return 1;
        }
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
        const m2 = t.match(new RegExp(`^(${TYPE_REGEX_STR})\\b`));
        return m2 ? m2[1] : 'float';
    }

    /** Resolve variable type from builtins, uniforms, or declarations (port of C0) */
    function resolveVariableType(source, name) {
        if (BUILTIN_VARIABLES[name] !== undefined) return BUILTIN_VARIABLES[name];
        if (UNIFORM_TYPES[name] !== undefined) return UNIFORM_TYPES[name];

        // Handle swizzle: e.g., color.rgb
        const dotIdx = name.indexOf('.');
        if (dotIdx > 0) {
            const base = name.slice(0, dotIdx);
            const swiz = name.slice(dotIdx);
            if (BUILTIN_VARIABLES[base] !== undefined) {
                return resolveSwizzle(swiz) || BUILTIN_VARIABLES[base];
            }
            if (UNIFORM_TYPES[base] !== undefined) {
                return resolveSwizzle(swiz) || UNIFORM_TYPES[base];
            }
        }

        // Check declaration in source
        const escaped = escapeRegex(name);
        const declRe = new RegExp(`\\b(${TYPE_REGEX_STR})\\s+${escaped}\\b`, 'g');
        const m = declRe.exec(source);
        return m ? m[1] : 'float';
    }

    /** Complex expression analysis (port of mb) */
    function inferExpressionType(expr, source) {
        let best = 'float';
        let bestDim = 1;
        const promote = (t) => { const d = typeDimension(t); if (d > bestDim) { best = t; bestDim = d; } };

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
    function inferType(source, variable) {
        // 1. User function?
        const sig = parseFunctionSignature(source, variable);
        if (sig) return sig.returnType;

        // 2. #define macro?
        const def = resolveDefine(variable, source);
        if (def) return inferLiteralType(def);

        // 3. Simple word → builtins / uniforms / declarations
        if (/^\w+$/.test(variable)) return resolveVariableType(source, variable);

        // 4. Complex expression → function call / heuristic
        return inferFunctionCallType(variable, source);
    }

    // ── Shader Rewriting (port of Bj/Oj pipeline) ──────────────────

    /** Coerce any GLSL type to vec4 for visualization (port of K1) */
    function coerceToVec4(expr, type) {
        switch (type) {
            case 'float': case 'int': case 'uint':
                return `vec4(${expr}, ${expr}, ${expr}, 1.0)`;
            case 'bool':
                return `vec4(vec3(${expr}), 1.0)`;
            case 'vec2': case 'ivec2': case 'uvec2':
                return `vec4(${expr}, 0.0, 1.0)`;
            case 'vec3': case 'ivec3': case 'uvec3':
                return `vec4(${expr}, 1.0)`;
            case 'vec4': case 'ivec4': case 'uvec4':
                return `vec4(${expr})`;
            case 'mat2':
                return `vec4(${expr}[0], ${expr}[1])`;
            case 'mat3':
                return `vec4(${expr}[0], 1.0)`;
            case 'mat4':
                return `vec4(${expr}[0])`;
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
            (/^\w+$/.test(variable) ? resolveVariableType(source, variable) : inferFunctionCallType(variable, source));

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
            (/^\w+$/.test(variable) ? resolveVariableType(source, variable) : inferFunctionCallType(variable, source));

        return buildCompareShader(source, variable, coerceToVec4(resolved, type), false, inspectorLine);
    }

    // ── Webview Integration ─────────────────────────────────────────

    let _active = false;
    let _variable = '';
    let _line = 0;
    let _mapping = { ...DEFAULT_MAPPING };
    let _compareMode = false;
    let _inspectorMaterial = null;
    let _originalMaterials = new Map();  // bufferIndex → original material
    let _lastRewrittenSource = '';
    let _debounceTimer = null;

    /** Get the shader source for the final (image) buffer */
    function getShaderSource() {
        const textareas = document.querySelectorAll('textarea[data-shadertoy="shader"]');
        if (textareas.length === 0) return '';
        // The last textarea is the final/image buffer
        return textareas[textareas.length - 1].value || '';
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

            const type = inferType(source, _variable);
            const rewritten = _compareMode ?
                rewriteForCompare(source, _variable, _line) :
                rewriteForInspector(source, _variable, _mapping, _line);

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

                // Use the ORIGINAL material for reference (uniforms, glslVersion, vertexShader)
                const origMat = _originalMaterials.get(finalIdx) || finalBuffer.Shader;
                if (!_originalMaterials.has(finalIdx)) {
                    _originalMaterials.set(finalIdx, finalBuffer.Shader);
                }

                // Prepare the fragment shader the same way the normal compile path does:
                // adds layout(location=0) out, #define gl_FragColor, #define texture2D, etc.
                let prepared = rewritten;
                if (window.ShaderToy && window.ShaderToy.shaderCompile &&
                    window.ShaderToy.shaderCompile.prepareFragmentShader) {
                    const isWebGL2 = origMat.glslVersion === THREE.GLSL3;
                    prepared = window.ShaderToy.shaderCompile.prepareFragmentShader(rewritten, isWebGL2);
                }

                // Copy uniforms by reference (they are shared objects updated by the render loop)
                const uniforms = {};
                for (const [key, val] of Object.entries(origMat.uniforms)) {
                    uniforms[key] = val;
                }

                _inspectorMaterial = new THREE.ShaderMaterial({
                    glslVersion: origMat.glslVersion,
                    fragmentShader: prepared,
                    vertexShader: origMat.vertexShader,
                    uniforms: uniforms,
                    depthWrite: false,
                    depthTest: false
                });

                // Swap material
                finalBuffer.Shader = _inspectorMaterial;

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
                    buffers[idx].Shader = mat;
                }
            }
        }
        _originalMaterials.clear();
        _inspectorMaterial = null;
        _lastRewrittenSource = '';
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

    /** Pixel readback on hover */
    function setupHoverReadback() {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        let lastTooltipUpdate = 0;
        canvas.addEventListener('mousemove', function (e) {
            if (!_active || !_variable) return;

            const now = performance.now();
            if (now - lastTooltipUpdate < 33) return; // ~30fps throttle
            lastTooltipUpdate = now;

            try {
                if (typeof renderer === 'undefined' || typeof gl === 'undefined') return;
                const rect = canvas.getBoundingClientRect();
                const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
                const y = canvas.height - Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

                const pixel = new Uint8Array(4);
                gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

                if (typeof vscode !== 'undefined' && vscode) {
                    vscode.postMessage({
                        command: 'inspectorPixel',
                        rgba: [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255, pixel[3] / 255],
                        position: { x: e.clientX - rect.left, y: e.clientY - rect.top }
                    });
                }
            } catch (err) {
                // Silently ignore readback errors
            }
        });
    }

    // ── Message Handling ────────────────────────────────────────────

    function handleMessage(msg) {
        switch (msg.command) {
            case 'setInspectorVariable':
                _variable = msg.variable || '';
                _line = msg.line || 0;
                if (_active && _variable) {
                    updateInspection();
                }
                break;

            case 'setInspectorMapping':
                if (msg.mapping) {
                    _mapping = { ...DEFAULT_MAPPING, ...msg.mapping };
                    _lastRewrittenSource = ''; // force recompile
                    if (_active && _variable) {
                        updateInspection();
                    }
                }
                break;

            case 'inspectorOn':
                if (!_active) {
                    _active = true;
                    if (_variable) updateInspection();
                }
                break;

            case 'inspectorOff':
                _active = false;
                restoreOriginal();
                postStatus('off', 'Inspector off');
                break;

            case 'setInspectorCompare':
                _compareMode = !!msg.enabled;
                _lastRewrittenSource = ''; // force recompile
                if (_active && _variable) {
                    updateInspection();
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

        // Called on hot-reload to clear stale material references
        onHotReload: function () {
            _originalMaterials.clear();
            _inspectorMaterial = null;
            _lastRewrittenSource = '';
            // Re-inspect with new materials if active
            if (_active && _variable) {
                updateInspection();
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
})();
