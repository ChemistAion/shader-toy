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

function loadInspectorHarness() {
    const repoRoot = path.resolve(__dirname, '../../');
    const inspectPath = path.join(repoRoot, 'resources', 'webview', 'shader_inspect.js');
    const source = fs.readFileSync(inspectPath, 'utf8');
    let lastSetIntervalMs = 0;
    const messages: Array<{
        command: string;
        status?: string;
        message?: string;
        variable?: string;
        histogram?: { samples: number; autoMin: number; autoMax: number; timeMs: number; componentCount?: number; binsA?: number[] };
    }> = [];
    let fullReadPixelsCalls = 0;
    let nowMs = 0;
    let renderTargetReadPixelsCalls = 0;
    let lastRenderTargetReadSize = { width: 0, height: 0 };
    let renderCalls = 0;
    const scissorCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
    const viewportCalls: Array<{ x: number; y: number; width: number; height: number }> = [];
    const scissorTestStates: boolean[] = [];

    const material = {
        fragmentShader: SIMPLE_SHADER,
        uniforms: {},
        glslVersion: 0,
        needsUpdate: false,
    };

    const canvas = {
        width: 2,
        height: 2,
        addEventListener: () => undefined,
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
        };
    }

    const gl = {
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        readPixels: (x: number, y: number, w: number, h: number, _format: number, _type: number, buffer: Uint8Array) => {
            if (w === 2 && h === 2) {
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
        readRenderTargetPixels: (_target: unknown, _x: number, _y: number, w: number, h: number, buffer: Float32Array) => {
            lastRenderTargetReadSize = { width: w, height: h };
            if (w === 2 && h === 2) {
                renderTargetReadPixelsCalls++;
                buffer.set([
                    -1.0, 0.0, 0.5, 1.0,
                    -0.5, 0.25, 0.75, 1.0,
                    0.0, 0.5, 1.0, 1.0,
                    1.0, 0.75, 1.5, 1.0,
                ]);
                return;
            }

            renderTargetReadPixelsCalls++;
            for (let index = 0; index < w * h; index++) {
                const offset = index * 4;
                const base = index / Math.max(1, (w * h) - 1);
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
        requestIdleCallback: (fn: () => void) => {
            fn();
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
            postMessage: (message: { command: string; histogram?: { samples: number; autoMin: number; autoMax: number; timeMs: number } }) => {
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
                }
            };
            buffers: Array<{ Shader: typeof material; Target: unknown }>;
            forceRenderOneFrame: boolean;
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

    test('toggles histogram capture through inspector messages', () => {
        const { sandbox } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogram', enabled: false });
        assert.strictEqual(sandbox.ShaderToy.inspector.isHistogramEnabled(), false);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogram', enabled: true });
        assert.strictEqual(sandbox.ShaderToy.inspector.isHistogramEnabled(), true);
    });

    test('defaults histogram refresh to 5Hz and switches to preset intervals', () => {
        const { sandbox, getLastSetIntervalMs } = loadInspectorHarness();

        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramIntervalMs(), 200);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        assert.strictEqual(getLastSetIntervalMs(), 200);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogramInterval', intervalMs: 200 });
        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramIntervalMs(), 200);
        assert.strictEqual(getLastSetIntervalMs(), 200);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogramInterval', intervalMs: 100 });
        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramIntervalMs(), 100);
        assert.strictEqual(getLastSetIntervalMs(), 100);
    });

    test('defaults histogram sample stride to 1:8 and switches to preset strides', () => {
        const { sandbox } = loadInspectorHarness();

        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramSampleStride(), 8);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogramSampleStride', sampleStride: 64 });
        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramSampleStride(), 64);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogramSampleStride', sampleStride: 256 });
        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramSampleStride(), 8);
    });

    test('histogram reports the observed raw domain with active histogram timing', () => {
        const { sandbox, messages, getFullReadPixelsCalls, getRenderTargetReadPixelsCalls } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({
            command: 'setInspectorMapping',
            mapping: { mode: 'linear', min: -1, max: 1, highlightOutOfRange: false }
        });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogramSampleStride', sampleStride: 1 });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });
        sandbox.ShaderToy.inspector.afterFrame();

        const histogramMessage = messages.find(message => message.command === 'inspectorHistogram');
        assert.ok(histogramMessage, 'Expected histogram payload to be posted');
        assert.strictEqual(getFullReadPixelsCalls(), 0, 'Expected raw histogram capture to avoid screen readPixels fallback');
        assert.strictEqual(getRenderTargetReadPixelsCalls(), 1, 'Expected one raw render-target readback');
        assert.strictEqual(histogramMessage?.histogram?.samples, 4, 'Expected all framebuffer pixels to be analyzed');
        assert.strictEqual(histogramMessage?.histogram?.autoMin, -1);
        assert.strictEqual(histogramMessage?.histogram?.autoMax, 1);
        assert.strictEqual(histogramMessage?.histogram?.componentCount, 1);
        assert.strictEqual(histogramMessage?.histogram?.timeMs, 3.75);
    });

    test('histogram sample stride reduces the analyzed sample count', () => {
        const { sandbox, messages, getLastRenderTargetReadSize } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogramSampleStride', sampleStride: 8 });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });
        sandbox.ShaderToy.inspector.afterFrame();

        const histogramMessage = messages.find(message => message.command === 'inspectorHistogram');
        assert.ok(histogramMessage, 'Expected histogram payload to be posted');
        assert.deepStrictEqual(getLastRenderTargetReadSize(), { width: 1, height: 1 }, 'Expected raw histogram capture to downsample the render target');
        assert.strictEqual(histogramMessage?.histogram?.samples, 1, 'Expected stride sampling to reduce the analyzed pixel count');
    });

    test('ignores non-variable inspector targets and keeps the last valid inspection active', () => {
        const { material, sandbox, messages } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });
        const rewrittenShader = material.fragmentShader;
        const messageCount = messages.length;

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'for', line: 2 });

        assert.strictEqual(material.fragmentShader, rewrittenShader, 'Expected invalid selections to leave the last valid inspection in place');
        assert.strictEqual(messages.length, messageCount, 'Expected invalid selections to be ignored without posting a new status');
        assert.strictEqual(messages.some(message => message.command === 'inspectorStatus' && message.status === 'error'), false, 'Expected invalid selections to avoid error status updates');
    });

    test('accepts integer inspector targets', () => {
        const { material, sandbox, messages } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'count', line: 3 });

        assert.ok(material.fragmentShader.includes('_inspMap(vec4(count, count, count, 1.0))'), 'Expected integer variables to be coerced into the inspect map');
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

        assert.strictEqual(material.fragmentShader, rewrittenShader, 'Expected unsupported bool selections to be ignored');
        assert.strictEqual(messages.length, messageCount, 'Expected unsupported bool selections to avoid new status messages');
    });

    test('normalizes vector component selections to the full vector inspection target', () => {
        const { material, sandbox, messages } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'uv.x', line: 4 });

        assert.ok(material.fragmentShader.includes('gl_FragColor = _inspMap(vec4(uv, 0.0, 1.0));'), 'Expected vector component selection to inspect the full vector');
        const statusMessage = messages.find(message => message.command === 'inspectorStatus' && message.status === 'ok');
        assert.strictEqual(statusMessage?.variable, 'uv');
        assert.strictEqual(statusMessage?.message, 'Inspecting: uv (vec2)');
    });

    test('renders compare mode as a split between original and inspected output', () => {
        const {
            material,
            sandbox,
            getRenderCalls,
            getScissorCalls,
            getViewportCalls,
            getScissorTestStates,
        } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorCompare', enabled: true });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorCompareSplit', split: 0.5 });

        assert.ok(material.fragmentShader.includes('_inspMap('), 'Expected compare mode to keep the mapped inspector shader active');
        assert.strictEqual(sandbox.ShaderToy.inspector.getCompareSplit(), 0.5);

        const rendered = sandbox.ShaderToy.inspector.renderBuffer(sandbox.buffers[0], 0, 1);

        assert.strictEqual(rendered, true, 'Expected compare mode to intercept the final render pass');
        assert.strictEqual(getRenderCalls(), 2, 'Expected original and inspected halves to render separately');
        assert.deepStrictEqual(getScissorTestStates(), [true, false]);
        assert.deepStrictEqual(getScissorCalls(), [
            { x: 0, y: 0, width: 1, height: 2 },
            { x: 1, y: 0, width: 1, height: 2 },
            { x: 0, y: 0, width: 2, height: 2 }
        ]);
        assert.deepStrictEqual(getViewportCalls(), [
            { x: 0, y: 0, width: 1, height: 2 },
            { x: 1, y: 0, width: 1, height: 2 },
            { x: 0, y: 0, width: 2, height: 2 }
        ]);
    });
});
