import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

suite('Frame Timing Runtime', () => {
    test('measures explicit render spans and resets discontinuities', () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const runtimePath = path.join(repoRoot, 'resources', 'webview', 'frame_timing.js');
        const source = fs.readFileSync(runtimePath, 'utf8');

        const nowValues = [100, 110, 130, 136, 200, 205];
        const messages: Array<{ command: string; cpuMs: number; gpuMs: number; frameNumber: number }> = [];

        const sandbox: Record<string, unknown> = {
            ShaderToy: {},
            performance: {
                now: () => {
                    const next = nowValues.shift();
                    if (next === undefined) {
                        throw new Error('No more performance.now() values');
                    }
                    return next;
                }
            },
            globalThis: undefined,
            window: undefined,
        };
        sandbox.globalThis = sandbox;
        sandbox.window = sandbox;

        vm.createContext(sandbox);
        vm.runInContext(source, sandbox);

        const frameTiming = (sandbox as {
            ShaderToy: {
                frameTiming: {
                    setEnabled: (value: boolean) => void;
                    beginFrame: () => void;
                    endFrame: (vscodeApi: { postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => void }, frameNumber: number) => void;
                    setPaused: (value: boolean) => void;
                };
            };
        }).ShaderToy.frameTiming;

        const vscodeApi = {
            postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => {
                messages.push(message);
            }
        };

        frameTiming.setEnabled(true);

        frameTiming.beginFrame();
        frameTiming.endFrame(vscodeApi, 7);

        frameTiming.beginFrame();
        frameTiming.endFrame(vscodeApi, 8);

        frameTiming.setPaused(true);
        frameTiming.beginFrame();
        frameTiming.endFrame(vscodeApi, 9);

        assert.deepStrictEqual(messages.map((message) => ({ ...message })), [
            { command: 'frameData', cpuMs: 10, gpuMs: 0, frameNumber: 7 },
            { command: 'frameData', cpuMs: 6, gpuMs: 0, frameNumber: 8 },
            { command: 'frameData', cpuMs: 5, gpuMs: 0, frameNumber: 9 },
        ]);
    });

    test('does not post when disabled', () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const runtimePath = path.join(repoRoot, 'resources', 'webview', 'frame_timing.js');
        const source = fs.readFileSync(runtimePath, 'utf8');

        const sandbox: Record<string, unknown> = {
            ShaderToy: {},
            performance: { now: () => 100 },
            globalThis: undefined,
            window: undefined,
        };
        sandbox.globalThis = sandbox;
        sandbox.window = sandbox;

        vm.createContext(sandbox);
        vm.runInContext(source, sandbox);

        const frameTiming = (sandbox as {
            ShaderToy: {
                frameTiming: {
                    beginFrame: () => void;
                    endFrame: (vscodeApi: { postMessage: (message: unknown) => void }, frameNumber: number) => void;
                };
            };
        }).ShaderToy.frameTiming;

        const messages: unknown[] = [];
        frameTiming.beginFrame();
        frameTiming.endFrame({ postMessage: (message: unknown) => messages.push(message) }, 1);

        assert.deepStrictEqual(messages, []);
    });
});
