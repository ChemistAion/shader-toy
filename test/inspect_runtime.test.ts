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
    const renderCalls: Array<{ material: unknown }> = [];
    const scissorOps: Array<{ op: string; args: number[] | [boolean] }> = [];
    const canvas = {
        width: 320,
        height: 180,
        addEventListener: () => undefined,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 })
    };
    const quad = { material };

    const gl = {
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        readPixels: (_x: number, _y: number, _w: number, _h: number, _format: number, _type: number, buffer: Uint8Array) => {
            buffer.set([0, 0, 0, 255]);
        },
    };

    const renderer = {
        setRenderTarget: () => undefined,
        setScissorTest: (enabled: boolean) => scissorOps.push({ op: 'setScissorTest', args: [enabled] }),
        setViewport: (x: number, y: number, width: number, height: number) => scissorOps.push({ op: 'setViewport', args: [x, y, width, height] }),
        setScissor: (x: number, y: number, width: number, height: number) => scissorOps.push({ op: 'setScissor', args: [x, y, width, height] }),
        render: () => {
            renderCalls.push({ material: quad.material });
        },
        domElement: canvas,
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
        quad,
        scene: {},
        camera: {},
        document: {
            readyState: 'complete',
            addEventListener: () => undefined,
            body: { appendChild: () => undefined },
            createElement: () => ({
                style: {},
                appendChild: () => undefined,
                textContent: '',
            }),
            getElementById: (id: string) => id === 'canvas' ? canvas : null,
            querySelectorAll: (selector: string) => selector === 'script[type="x-shader/x-fragment"]'
                ? [{ textContent: SIMPLE_SHADER }]
                : [],
        },
        THREE: {
            GLSL3: 'GLSL3',
            ShaderMaterial: function(this: Record<string, unknown>, init: Record<string, unknown>) {
                Object.assign(this, init);
            }
        },
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
                    renderBuffer: (buffer: { Target: unknown }, bufferIndex: number, totalBuffers: number) => boolean;
                }
            };
            buffers: Array<{ Shader: typeof material; Target: unknown }>;
            forceRenderOneFrame: boolean;
        },
        messages,
        renderCalls,
        scissorOps,
        quad,
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

    test('renders compare split via scissor on the final buffer only', () => {
        const { sandbox, renderCalls, scissorOps, quad, material } = loadInspectorHarness();

        sandbox.ShaderToy.inspector.handleMessage({ command: 'inspectorOn' });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorVariable', variable: 'x', line: 2 });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorCompare', enabled: true });
        sandbox.ShaderToy.inspector.handleMessage({ command: 'setInspectorCompareSplit', split: 0.25 });

        const rendered = sandbox.ShaderToy.inspector.renderBuffer(sandbox.buffers[0], 0, 1);

        assert.strictEqual(rendered, true, 'Expected compare rendering to take over the final pass');
        assert.strictEqual(renderCalls.length, 2, 'Expected compare mode to render original and inspected views');
        assert.notStrictEqual(renderCalls[0].material, material, 'Expected the left half to use the preserved original material');
        assert.strictEqual(renderCalls[1].material, material, 'Expected the right half to use the live inspector material');
        assert.strictEqual(scissorOps.some(entry => entry.op === 'setScissorTest' && entry.args[0] === true), true);
        assert.strictEqual(scissorOps.some(entry => entry.op === 'setScissor' && entry.args[0] === 0 && entry.args[2] === 80), true);
        assert.strictEqual(scissorOps.some(entry => entry.op === 'setScissor' && entry.args[0] === 80 && entry.args[2] === 240), true);
        assert.strictEqual(quad.material, material, 'Expected the quad material to be restored after compare rendering');
    });
});
