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
    const messages: Array<{
        command: string;
        status?: string;
        message?: string;
        variable?: string;
    }> = [];

    const material = {
        fragmentShader: SIMPLE_SHADER,
        uniforms: {},
        glslVersion: 0,
        needsUpdate: false,
    };

    const gl = {
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        readPixels: (_x: number, _y: number, _w: number, _h: number, _format: number, _type: number, buffer: Uint8Array) => {
            buffer.set([0, 0, 0, 255]);
        },
    };

    const renderer = {
        setRenderTarget: () => undefined,
        render: () => undefined,
    };

    const sandbox: Record<string, unknown> = {
        console,
        addEventListener: () => undefined,
        setTimeout: (fn: () => void) => {
            fn();
            return 1;
        },
        clearTimeout: () => undefined,
        setInterval: () => 1,
        clearInterval: () => undefined,
        requestIdleCallback: (fn: (deadline?: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
            fn({ didTimeout: false, timeRemaining: () => 10 });
            return 1;
        },
        performance: { now: () => 1 },
        window: {},
        gl,
        renderer,
        document: {
            readyState: 'complete',
            addEventListener: () => undefined,
            getElementById: () => null,
            querySelectorAll: (selector: string) => selector === 'script[type="x-shader/x-fragment"]'
                ? [{ textContent: SIMPLE_SHADER }]
                : [],
        },
        THREE: { GLSL3: 'GLSL3' },
        vscode: {
            postMessage: (message: { command: string }) => {
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
                }
            };
            buffers: Array<{ Shader: typeof material; Target: unknown }>;
            forceRenderOneFrame: boolean;
        },
        messages,
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
});
