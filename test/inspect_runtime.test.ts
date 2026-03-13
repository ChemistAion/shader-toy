import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const SIMPLE_SHADER = `void main() {
    float x = 0.5;
    int count = 2;
    vec2 uv = vec2(0.25, 0.75);
    vec4 color = vec4(x, uv, 1.0);
    bool enabled = true;
    gl_FragColor = color;
}
`;

function loadInspectorHarness(options?: { deferIdleCallbacks?: boolean }) {
    const repoRoot = path.resolve(__dirname, '../../');
    const inspectPath = path.join(repoRoot, 'resources', 'webview', 'shader_inspect.js');
    const source = fs.readFileSync(inspectPath, 'utf8');
    const deferIdleCallbacks = !!options?.deferIdleCallbacks;
    let lastSetIntervalMs = 0;
    let fullReadPixelsCalls = 0;
    let nowMs = 0;
    let renderTargetReadPixelsCalls = 0;
    let lastRenderTargetReadSize = { width: 0, height: 0 };
    let renderCalls = 0;
    const scissorCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
    const viewportCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
    const scissorTestStates: boolean[] = [];
    const canvasEventHandlers: Record<string, (event: { clientX: number; clientY: number }) => void> = {};
    const idleCallbacks: Array<() => void> = [];
    const messages: Array<{
        command: string;
        status?: string;
        message?: string;
        variable?: string;
        rgba?: number[];
        position?: { x: number; y: number };
        histogram?: {
            samples: number;
            autoMin: number;
            autoMax: number;
            timeMs: number;
            componentCount?: number;
            binsA?: number[];
            stalled?: boolean;
        };
    }> = [];

    const material = {
        fragmentShader: SIMPLE_SHADER,
        uniforms: {},
        glslVersion: 0,
        needsUpdate: false,
    };

    const canvas = {
        width: 2,
        height: 2,
        addEventListener: (type: string, handler: (event: { clientX: number; clientY: number }) => void) => {
            canvasEventHandlers[type] = handler;
        },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 2, height: 2 }),
    };

    const overlayBody = {
        appendChild: () => undefined,
    };

    function createElement() {
        return {
            style: {},
            textContent: '',
            appendChild: () => undefined,
            getContext: () => null,
        };
    }

    const gl = {
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        readPixels: (_x: number, _y: number, width: number, height: number, _format: number, _type: number, buffer: Uint8Array) => {
            if (width === 2 && height === 2) {
                fullReadPixelsCalls++;
                buffer.set([
                    0, 0, 0, 255,
                    255, 0, 0, 255,
                    0, 255, 0, 255,
                    0, 0, 255, 255,
                ]);
                return;
            }

            buffer.set([0, 0, 0, 255]);
        },
    };

    const renderer = {
        setRenderTarget: () => undefined,
        render: () => {
            renderCalls++;
        },
        domElement: canvas,
        setScissorTest: (enabled: boolean) => {
            scissorTestStates.push(enabled);
        },
        setScissor: (x: number, y: number, width: number, height: number) => {
            scissorCalls.push({ x, y, width, height });
        },
        setViewport: (x: number, y: number, width: number, height: number) => {
            viewportCalls.push({ x, y, width, height });
        },
        readRenderTargetPixels: (_target: unknown, _x: number, _y: number, width: number, height: number, buffer: Float32Array) => {
            lastRenderTargetReadSize = { width, height };
            renderTargetReadPixelsCalls++;
            if (width === 2 && height === 2) {
                buffer.set([
                    -1.0, 0.0, 0.5, 1.0,
                    -0.5, 0.25, 0.75, 1.0,
                    0.0, 0.5, 1.0, 1.0,
                    1.0, 0.75, 1.5, 1.0,
                ]);
                return;
            }

            for (let index = 0; index < width * height; index++) {
                const offset = index * 4;
                const base = index / Math.max(1, (width * height) - 1);
                buffer[offset] = -1.0 + base * 2.0;
                buffer[offset + 1] = base;
                buffer[offset + 2] = 0.5 + base;
                buffer[offset + 3] = 1.0;
            }
        },
    };

    function WebGLRenderTarget(this: Record<string, unknown>, width: number, height: number) {
        this.width = width;
        this.height = height;
        this.texture = {};
        this.dispose = () => undefined;
    }

    function ShaderMaterial(this: Record<string, unknown>, config: Record<string, unknown>) {
        Object.assign(this, config);
        this.dispose = () => undefined;
    }

    const sandbox: Record<string, unknown> = {
        console,
        addEventListener: () => undefined,
        setTimeout: (fn: () => void) => {
            fn();
            return 1;
        },
        clearTimeout: () => undefined,
        setInterval: (_fn: () => void, intervalMs?: number) => {
            lastSetIntervalMs = intervalMs ?? 0;
            return 1;
        },
        clearInterval: () => undefined,
        requestIdleCallback: (fn: (deadline?: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
            if (deferIdleCallbacks) {
                idleCallbacks.push(() => fn({ didTimeout: false, timeRemaining: () => 10 }));
                return idleCallbacks.length;
            }
            fn({ didTimeout: false, timeRemaining: () => 10 });
            return 1;
        },
        performance: {
            now: () => {
                nowMs += 1.25;
                return nowMs;
            },
        },
        window: {},
        gl,
        renderer,
        paused: false,
        supportsFloatFramebuffer: true,
        quad: { material: null },
        scene: {},
        camera: {},
        document: {
            readyState: 'complete',
            addEventListener: () => undefined,
            createElement: () => createElement(),
            body: overlayBody,
            getElementById: (id: string) => id === 'canvas' ? canvas : null,
            querySelectorAll: (selector: string) => selector === 'script[type="x-shader/x-fragment"]'
                ? [{ textContent: SIMPLE_SHADER }]
                : [],
        },
        THREE: {
            GLSL3: 'GLSL3',
            FloatType: 'FloatType',
            NearestFilter: 'NearestFilter',
            WebGLRenderTarget,
            ShaderMaterial,
        },
        vscode: {
            postMessage: (message: {
                command: string;
                histogram?: { samples: number; autoMin: number; autoMax: number; timeMs: number };
                rgba?: number[];
                position?: { x: number; y: number };
                variable?: string;
                status?: string;
                message?: string;
            }) => {
                messages.push(message);
            },
        },
        buffers: [{
            Name: 'image',
            File: 'image.glsl',
            LineOffset: 0,
            Shader: material,
            Target: null,
        }],
        forceRenderOneFrame: false,
        freezeSimulationOnNextForcedRender: false,
        currentShader: {},
    };

    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);

    return {
        material,
        sandbox: sandbox as {
            ShaderToy: {
                inspector: {
                    handleMessage: (message: { command: string; [key: string]: unknown }) => void;
                    getCompareSplit: () => number;
                    isHistogramEnabled: () => boolean;
                    getHistogramIntervalMs: () => number;
                    getHistogramSampleStride: () => number;
                    renderBuffer: (buffer: { Shader: typeof material; Target: unknown }, index: number, totalBuffers: number) => boolean;
                    afterFrame: () => void;
                };
            };
            buffers: Array<{ Shader: typeof material; Target: unknown }>;
            forceRenderOneFrame: boolean;
            freezeSimulationOnNextForcedRender: boolean;
        },
        messages,
        getFullReadPixelsCalls: () => fullReadPixelsCalls,
        getRenderTargetReadPixelsCalls: () => renderTargetReadPixelsCalls,
        getLastRenderTargetReadSize: () => ({ ...lastRenderTargetReadSize }),
        getLastSetIntervalMs: () => lastSetIntervalMs,
        getRenderCalls: () => renderCalls,
        getScissorCalls: () => scissorCalls.map(call => ({ ...call })),
        getViewportCalls: () => viewportCalls.map(call => ({ ...call })),
        getScissorTestStates: () => [...scissorTestStates],
        triggerCanvasEvent: (type: string, event: { clientX: number; clientY: number }) => {
            const handler = canvasEventHandlers[type];
            if (handler) {
                handler(event);
            }
        },
        flushIdleCallbacks: () => {
            while (idleCallbacks.length > 0) {
                const callback = idleCallbacks.shift();
                if (callback) {
                    callback();
                }
            }
        },
    };
}

suite('Inspect runtime', () => {
    test('rewrites the original material in place and requests a frame', () => {
        const { material, sandbox } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });

        assert.strictEqual(sandbox.buffers[0].Shader, material);
        assert.ok(material.fragmentShader.includes('_inspMap('), 'Expected the original material fragment shader to be rewritten');
        assert.strictEqual(material.needsUpdate, true, 'Expected rewritten material to request recompilation');
        assert.strictEqual(sandbox.forceRenderOneFrame, true, 'Expected inspection to force a redraw');
    });

    test('restores the original fragment shader when inspector turns off', () => {
        const { material, sandbox } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOff' });

        assert.strictEqual(material.fragmentShader, SIMPLE_SHADER);
        assert.strictEqual(sandbox.buffers[0].Shader, material);
    });

    test('ignores non-variable inspector targets and keeps the last valid inspection active', () => {
        const { material, sandbox, messages } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });
        const rewrittenShader = material.fragmentShader;
        const messageCount = messages.length;

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'for', line: 2 });

        assert.strictEqual(material.fragmentShader, rewrittenShader);
        assert.strictEqual(messages.length, messageCount);
        assert.strictEqual(messages.some(message => message.command === 'inspectorStatus' && message.status === 'error'), false);
    });

    test('accepts integer inspector targets', () => {
        const { material, sandbox, messages } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'count', line: 3 });

        assert.ok(material.fragmentShader.includes('_inspMap(vec4(count, count, count, 1.0))'));
        const statusMessage = messages.find(message => message.command === 'inspectorStatus' && message.status === 'ok');
        assert.strictEqual(statusMessage?.variable, 'count');
        assert.strictEqual(statusMessage?.message, 'Inspecting: count (int)');
    });

    test('rejects unsupported bool inspector targets', () => {
        const { material, sandbox, messages } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });
        const rewrittenShader = material.fragmentShader;
        const messageCount = messages.length;

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'enabled', line: 5 });

        assert.strictEqual(material.fragmentShader, rewrittenShader);
        assert.strictEqual(messages.length, messageCount);
    });

    test('normalizes vector component selections to the full vector inspection target', () => {
        const { material, sandbox, messages } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'uv.x', line: 4 });

        assert.ok(material.fragmentShader.includes('gl_FragColor = _inspMap(vec4(uv, 0.0, 1.0));'));
        const statusMessage = messages.find(message => message.command === 'inspectorStatus' && message.status === 'ok');
        assert.strictEqual(statusMessage?.variable, 'uv');
        assert.strictEqual(statusMessage?.message, 'Inspecting: uv (vec2)');
    });
});
