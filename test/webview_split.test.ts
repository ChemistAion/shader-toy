import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import Module = require('module');

import { WebviewContent } from '../src/webviewcontent';
import { WebviewModuleScriptExtension } from '../src/extensions/webview_module_script_extension';

suite('Webview Split', () => {
    test('Template uses whole-line webview module placeholders', () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const templatePath = path.join(repoRoot, 'resources', 'webview_base.html');

        const template = fs.readFileSync(templatePath, 'utf8');

        assert.ok(template.includes('<!-- Webview runtime_env.js -->'));
        assert.ok(!template.includes('<script src="<!-- Webview runtime_env.js -->"></script>'));
    });

    test('Portable preview inlines split runtime module JS', () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const relativePath = 'webview/runtime_env.js';
        const runtimeEnvPath = path.join(repoRoot, 'resources', relativePath);

        const ext = new WebviewModuleScriptExtension(
            () => 'unused-in-standalone',
            true,
            relativePath,
            () => fs.readFileSync(runtimeEnvPath, 'utf8'),
        );

        const content = ext.generateContent();

        assert.ok(content.includes('<script'));
        assert.ok(content.includes('getVscodeApi'));
        assert.ok(!content.includes('data:text/javascript'));

        // Extra safety: placeholder replacement should be possible.
        const templatePath = path.join(repoRoot, 'resources', 'webview_base.html');
        const webviewContent = new WebviewContent(templatePath);
        const placeholderLineNumber = webviewContent
            .getLines()
            .findIndex((l) => l.trim() === '<!-- Webview runtime_env.js -->') + 1;
        assert.ok(placeholderLineNumber > 0);

        webviewContent.replaceWithinLine('<!-- Webview runtime_env.js -->', content, placeholderLineNumber);
        const updatedLine = webviewContent.getLine(placeholderLineNumber);
        assert.ok(updatedLine.includes('getVscodeApi'));
    });

    test('Portable preview omits inspector runtime and hooks', async () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const moduleWithLoad = Module as typeof Module & {
            _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
        };
        const originalLoad = moduleWithLoad._load;
        moduleWithLoad._load = function(request: string, parent: NodeModule | null, isMain: boolean) {
            if (request === 'vscode') {
                return {};
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const fakeContext = {
            getResourceUri: (relativePath: string) => ({ fsPath: path.join(repoRoot, 'resources', relativePath) }),
            getConfig: () => undefined,
            makeWebviewResource: () => ({ toString: () => 'unused' }),
            getWebviewResourcePath: (_webview: unknown, relativePath: string) => relativePath,
            makeUri: (file: string) => ({ fsPath: file }),
            showErrorMessage: () => undefined,
            mapUserPath: async (userPath: string) => ({ file: userPath, userPath })
        };

        const shader = `void main() {
    gl_FragColor = vec4(1.0);
}`;

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { WebviewContentProvider } = require('../src/webviewcontentprovider');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { RenderStartingData } = require('../src/typenames');

            const provider = new WebviewContentProvider(fakeContext as any, shader, path.join(repoRoot, 'demos', 'portable_test.glsl'));
            await provider.parseShaderTree(false);
            const html = await provider.generateWebviewContent(undefined, new RenderStartingData());

            assert.ok(!html.includes('shader_inspect.js'), 'Expected standalone preview to omit the inspector runtime module');
            assert.ok(!html.includes('window.ShaderToy.inspector ='), 'Expected standalone preview to omit inspector runtime state');
            assert.ok(!html.includes('setInspectorVariable'), 'Expected standalone preview to omit inspector message routing');
            assert.ok(!html.includes('inspector.renderBuffer'), 'Expected standalone preview to omit inspector render hooks');
            assert.ok(!html.includes('inspector.afterFrame'), 'Expected standalone preview to omit inspector post-frame hooks');
        } finally {
            moduleWithLoad._load = originalLoad;
        }
    });

    test('pauseWholeRender still emits paused-aware time advancement', async () => {
        const repoRoot = path.resolve(__dirname, '..', '..');
        const moduleWithLoad = Module as typeof Module & {
            _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
        };
        const originalLoad = moduleWithLoad._load;
        moduleWithLoad._load = function(request: string, parent: NodeModule | null, isMain: boolean) {
            if (request === 'vscode') {
                return {};
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const fakeContext = {
            getResourceUri: (relativePath: string) => ({ fsPath: path.join(repoRoot, 'resources', relativePath) }),
            getConfig: (key: string) => key === 'pauseWholeRender' ? true : undefined,
            makeWebviewResource: () => ({ toString: () => 'unused' }),
            getWebviewResourcePath: (_webview: unknown, relativePath: string) => relativePath,
            makeUri: (file: string) => ({ fsPath: file }),
            showErrorMessage: () => undefined,
            mapUserPath: async (userPath: string) => ({ file: userPath, userPath })
        };

        const shader = `void main() {
    gl_FragColor = vec4(1.0);
}`;

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { WebviewContentProvider } = require('../src/webviewcontentprovider');
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { RenderStartingData } = require('../src/typenames');

            const provider = new WebviewContentProvider(fakeContext as any, shader, path.join(repoRoot, 'demos', 'portable_test.glsl'));
            await provider.parseShaderTree(false);
            const html = await provider.generateWebviewContent({} as any, new RenderStartingData());

            assert.ok(html.includes('let freezeSimulationOnNextForcedRender = false;'));
            assert.ok(html.includes('const renderFrozenFrameOnly = paused && forceRenderOneFrame && freezeSimulationOnNextForcedRender;'));
            assert.ok(html.includes('if (paused == false) {'));
            assert.ok(html.includes('deltaTime = 0.0;'));
        } finally {
            moduleWithLoad._load = originalLoad;
        }
    });
});
