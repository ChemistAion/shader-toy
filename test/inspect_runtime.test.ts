import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

const SIMPLE_SHADER = `void main() {
    float x = 0.5;
    gl_FragColor = vec4(x, 0.0, 0.0, 1.0);
}
`;

function loadInspectorHarness() {
    const repoRoot = path.resolve(__dirname, '../../');
    const inspectPath = path.join(repoRoot, 'resources', 'webview', 'shader_inspect.js');
    const source = fs.readFileSync(inspectPath, 'utf8');
    let lastSetIntervalMs = 0;
    const messages: Array<{ command: string; histogram?: { samples: number; autoMin: number; autoMax: number; timeMs: number } }> = [];
    let fullReadPixelsCalls = 0;
    let nowMs = 0;

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

    const sandbox: Record<string, unknown> = {
        console,
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
        document: {
            readyState: 'complete',
            addEventListener: () => undefined,
            getElementById: (id: string) => id === 'canvas' ? canvas : null,
            querySelectorAll: (selector: string) => selector === 'script[type="x-shader/x-fragment"]'
                ? [{ textContent: SIMPLE_SHADER }]
                : [],
        },
        THREE: {
            GLSL3: 'GLSL3',
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
                    isHistogramEnabled: () => boolean;
                    getHistogramIntervalMs: () => number;
                    afterFrame: () => void;
                }
            };
            buffers: Array<{ Shader: typeof material }>;
            forceRenderOneFrame: boolean;
        },
        messages,
        getFullReadPixelsCalls: () => fullReadPixelsCalls,
        getLastSetIntervalMs: () => lastSetIntervalMs,
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

    test('defaults histogram refresh to 1Hz and switches to preset intervals', () => {
        const { sandbox, getLastSetIntervalMs } = loadInspectorHarness();

        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramIntervalMs(), 1000);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        assert.strictEqual(getLastSetIntervalMs(), 1000);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogramInterval', intervalMs: 200 });
        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramIntervalMs(), 200);
        assert.strictEqual(getLastSetIntervalMs(), 200);

        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorHistogramInterval', intervalMs: 100 });
        assert.strictEqual(sandbox.ShaderToy.inspector.getHistogramIntervalMs(), 100);
        assert.strictEqual(getLastSetIntervalMs(), 100);
    });

    test('histogram bins the full framebuffer and reports all analyzed pixels', () => {
        const { sandbox, messages, getFullReadPixelsCalls } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.afterFrame();

        const histogramMessage = messages.find(message => message.command === 'inspectorHistogram');
        assert.ok(histogramMessage, 'Expected histogram payload to be posted');
        assert.strictEqual(getFullReadPixelsCalls(), 1, 'Expected a single full-frame readPixels call');
        assert.strictEqual(histogramMessage?.histogram?.samples, 4, 'Expected all framebuffer pixels to be analyzed');
        assert.strictEqual(histogramMessage?.histogram?.autoMin, 0);
        assert.strictEqual(histogramMessage?.histogram?.autoMax, 1);
        assert.strictEqual(histogramMessage?.histogram?.timeMs, 1.25);
    });
});
