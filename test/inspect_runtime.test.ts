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

    const material = {
        fragmentShader: SIMPLE_SHADER,
        uniforms: {},
        glslVersion: 0,
        needsUpdate: false,
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
        window: {},
        document: {
            readyState: 'complete',
            addEventListener: () => undefined,
            getElementById: () => null,
            querySelectorAll: (selector: string) => selector === 'script[type="x-shader/x-fragment"]'
                ? [{ textContent: SIMPLE_SHADER }]
                : [],
        },
        THREE: {
            GLSL3: 'GLSL3',
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
        vscode: undefined,
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
                }
            };
            buffers: Array<{ Shader: typeof material }>;
            forceRenderOneFrame: boolean;
        },
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
});
