import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

suite('Frame Timing Runtime', () => {
    test('measures explicit render spans and subtracts excluded work', () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const runtimePath = path.join(repoRoot, 'resources', 'webview', 'frame_timing.js');
        const source = fs.readFileSync(runtimePath, 'utf8');

        const nowValues = [100, 130, 132, 140, 200, 216];
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
                    beginFrame: (vscodeApi: { postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => void }, frameNumber: number) => void;
                    endFrame: (vscodeApi: { postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => void }, frameNumber: number) => void;
                    beginExcludedSection: () => void;
                    endExcludedSection: () => void;
                };
            };
        }).ShaderToy.frameTiming;

        const vscodeApi = {
            postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => {
                messages.push(message);
            }
        };

        frameTiming.setEnabled(true);

        frameTiming.beginFrame(vscodeApi, 7);
        frameTiming.beginExcludedSection();
        frameTiming.endExcludedSection();
        frameTiming.endFrame(vscodeApi, 7);

        frameTiming.beginFrame(vscodeApi, 8);
        frameTiming.endFrame(vscodeApi, 8);

        assert.deepStrictEqual(messages.map((message) => ({ ...message })), [
            { command: 'frameData', cpuMs: 38, gpuMs: 0, frameNumber: 7 },
            { command: 'frameData', cpuMs: 16, gpuMs: 0, frameNumber: 8 },
        ]);
    });

    test('resets the sample window across pause transitions', () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const runtimePath = path.join(repoRoot, 'resources', 'webview', 'frame_timing.js');
        const source = fs.readFileSync(runtimePath, 'utf8');

        const nowValues = [100, 120, 136];
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
                    beginFrame: (vscodeApi: { postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => void }, frameNumber: number) => void;
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
        frameTiming.beginFrame(vscodeApi, 7);
        frameTiming.setPaused(true);
        frameTiming.beginFrame(vscodeApi, 8);
        frameTiming.endFrame(vscodeApi, 8);

        assert.deepStrictEqual(messages.map((message) => ({ ...message })), [
            { command: 'frameData', cpuMs: 16, gpuMs: 0, frameNumber: 8 },
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
                    beginFrame: (vscodeApi: { postMessage: (message: unknown) => void }, frameNumber: number) => void;
                    endFrame: (vscodeApi: { postMessage: (message: unknown) => void }, frameNumber: number) => void;
                };
            };
        }).ShaderToy.frameTiming;

        const messages: unknown[] = [];
        frameTiming.beginFrame({ postMessage: (message: unknown) => messages.push(message) }, 1);
        frameTiming.endFrame({ postMessage: (message: unknown) => messages.push(message) }, 1);

        assert.deepStrictEqual(messages, []);
    });

    test('skips the next sample when an inspector-driven redraw is requested', () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const runtimePath = path.join(repoRoot, 'resources', 'webview', 'frame_timing.js');
        const source = fs.readFileSync(runtimePath, 'utf8');

        const nowValues = [100, 110, 200, 216];
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
                    beginFrame: (vscodeApi: { postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => void }, frameNumber: number) => void;
                    endFrame: (vscodeApi: { postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => void }, frameNumber: number) => void;
                    skipNextFrameSample: () => void;
                };
            };
        }).ShaderToy.frameTiming;

        const vscodeApi = {
            postMessage: (message: { command: string; cpuMs: number; gpuMs: number; frameNumber: number }) => {
                messages.push(message);
            }
        };

        frameTiming.setEnabled(true);
        frameTiming.skipNextFrameSample();
        frameTiming.beginFrame(vscodeApi, 7);
        frameTiming.endFrame(vscodeApi, 7);

        frameTiming.beginFrame(vscodeApi, 8);
        frameTiming.endFrame(vscodeApi, 8);

        assert.deepStrictEqual(messages.map((message) => ({ ...message })), [
            { command: 'frameData', cpuMs: 16, gpuMs: 0, frameNumber: 8 },
        ]);
    });
});
