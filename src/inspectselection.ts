'use strict';

const TYPE_REGEX_STR = 'float|int|uint|vec[234]|ivec[234]|uvec[234]';
const SIMPLE_SYMBOL_RE = /^[a-zA-Z_]\w*(?:\.[xyzwrgba]{1,4})?$/;

const BUILTIN_VARIABLE_TYPES: Record<string, string> = {
    gl_FragCoord: 'vec4',
    gl_FragColor: 'vec4',
    gl_FragDepth: 'float',
    gl_PointCoord: 'vec2',
    gl_Position: 'vec4',
    gl_PointSize: 'float',
    gl_VertexID: 'int',
    gl_InstanceID: 'int',
    gl_FrontFacing: 'bool',
    fragColor: 'vec4'
};

const UNIFORM_TYPES: Record<string, string> = {
    u_resolution: 'vec2',
    u_time: 'float',
    u_time_delta: 'float',
    u_frame: 'int',
    u_mouse: 'vec4',
    u_drag: 'vec2',
    u_scroll: 'float',
    u_date: 'vec4',
    u_refresh_rate: 'float',
    iResolution: 'vec3',
    iTime: 'float',
    iTimeDelta: 'float',
    iFrame: 'int',
    iMouse: 'vec4',
    iDate: 'vec4',
    iChannelResolution: 'vec3',
    iChannelTime: 'float'
};

const GLSL_KEYWORDS = new Set([
    'true', 'false', 'if', 'else', 'for', 'while', 'switch', 'case',
    'break', 'continue', 'discard', 'return', 'const', 'in', 'out',
    'inout', 'uniform', 'varying', 'attribute', 'flat', 'smooth',
    'float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4',
    'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
    'mat2', 'mat3', 'mat4', 'sampler2D', 'samplerCube', 'void', 'struct',
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'pow', 'exp', 'log',
    'sqrt', 'abs', 'sign', 'floor', 'ceil', 'round', 'trunc', 'fract',
    'mod', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep',
    'length', 'distance', 'dot', 'cross', 'normalize', 'reflect', 'refract',
    'dFdx', 'dFdy', 'fwidth', 'texture', 'texture2D', 'textureCube',
    'texelFetch', 'any', 'all', 'not'
]);

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function typeDimension(type: string): number {
    switch (type) {
    case 'vec2':
    case 'ivec2':
    case 'uvec2':
        return 2;
    case 'vec3':
    case 'ivec3':
    case 'uvec3':
        return 3;
    case 'vec4':
    case 'ivec4':
    case 'uvec4':
    case 'mat2':
    case 'mat3':
    case 'mat4':
        return 4;
    default:
        return 1;
    }
}

function lineAtOffset(source: string, offset: number): number {
    return (source.slice(0, offset).match(/\n/g) || []).length + 1;
}

function inferLiteralType(expr: string): string | null {
    const trimmed = expr.trim();
    if (/^-?\d+\.?\d*([eE][+-]?\d+)?[fF]?$/.test(trimmed)) return 'float';
    if (/^-?\d+$/.test(trimmed)) return 'int';
    const ctorMatch = trimmed.match(new RegExp(`^(${TYPE_REGEX_STR})\\s*\\(`));
    return ctorMatch ? ctorMatch[1] : null;
}

function resolveSwizzleType(suffix: string): string | null {
    if (!/^\.[xyzwrgba]{1,4}$/.test(suffix)) return null;
    const length = suffix.length - 1;
    return length === 1 ? 'float' : length === 2 ? 'vec2' : length === 3 ? 'vec3' : 'vec4';
}

function resolveDefineType(source: string, name: string): string | null {
    const escapedName = escapeRegex(name);
    const defineRegex = new RegExp(`^\\s*#\\s*define\\s+${escapedName}(?!\\s*\\()\\s+(.+)$`, 'gm');
    const match = defineRegex.exec(source);
    if (!match) return null;

    let value = match[1].trim();
    const commentIndex = value.indexOf('//');
    if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trimEnd();
    }

    return inferLiteralType(value);
}

function resolveDeclaredType(source: string, name: string, targetLine: number): string | null {
    const escapedName = escapeRegex(name);
    const qualifiers = '(?:(?:const|uniform|varying|attribute|in|out|inout|flat|smooth|centroid|readonly|writeonly|buffer|shared|coherent|volatile|restrict|highp|mediump|lowp)\\s+)*';
    const declRegex = new RegExp(`\\b${qualifiers}(${TYPE_REGEX_STR})\\s+${escapedName}\\b`, 'g');

    let bestType: string | null = null;
    let bestLine = -1;
    let match: RegExpExecArray | null;
    while ((match = declRegex.exec(source)) !== null) {
        const matchLine = lineAtOffset(source, match.index);
        if (matchLine <= targetLine && matchLine >= bestLine) {
            bestType = match[1];
            bestLine = matchLine;
        }
    }

    if (bestType) return bestType;

    declRegex.lastIndex = 0;
    match = declRegex.exec(source);
    return match ? match[1] : null;
}

function isSupportedInspectableType(type: string | null): boolean {
    return type !== null && /^(float|int|uint|vec[234]|ivec[234]|uvec[234])$/.test(type);
}

function isVectorType(type: string): boolean {
    return /^(vec[234]|ivec[234]|uvec[234])$/.test(type);
}

export type InspectableSelection = {
    variable: string,
    type: string
};

export function resolveInspectableSelection(source: string, selectionText: string, targetLine: number): InspectableSelection | null {
    const candidate = selectionText.trim();
    if (!candidate || candidate.length >= 200 || !SIMPLE_SYMBOL_RE.test(candidate)) {
        return null;
    }

    const dotIndex = candidate.indexOf('.');
    const base = dotIndex >= 0 ? candidate.slice(0, dotIndex) : candidate;
    const swizzle = dotIndex >= 0 ? candidate.slice(dotIndex) : '';

    if (GLSL_KEYWORDS.has(base)) {
        return null;
    }

    const resolvedType = BUILTIN_VARIABLE_TYPES[base] ?? UNIFORM_TYPES[base] ?? resolveDeclaredType(source, base, targetLine) ?? resolveDefineType(source, base);
    if (!isSupportedInspectableType(resolvedType)) {
        return null;
    }

    if (!swizzle) {
        return { variable: candidate, type: resolvedType };
    }

    const swizzleType = resolveSwizzleType(swizzle);
    if (swizzleType === null || typeDimension(resolvedType) < 2) {
        return null;
    }

    // Selecting a vector component should still inspect the owning vector.
    if (isVectorType(resolvedType)) {
        return { variable: base, type: resolvedType };
    }

    return { variable: candidate, type: swizzleType };
}

export function isInspectableSelection(source: string, selectionText: string, targetLine: number): boolean {
    return resolveInspectableSelection(source, selectionText, targetLine) !== null;
}