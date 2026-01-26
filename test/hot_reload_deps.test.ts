import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

import { WebviewContentProvider } from '../src/webviewcontentprovider';
import { Context } from '../src/context';

function makeFakeContext(config: Record<string, unknown>): Context {
    const fake: Partial<Context> = {
        getConfig: <T>(section: string): T | undefined => config[section] as T | undefined,
        mapUserPath: async (userPath: string, sourcePath?: string) => {
            let decoded = decodeURIComponent(userPath);
            if (decoded.startsWith('file://')) {
                try {
                    decoded = fileURLToPath(decoded);
                } catch {
                    decoded = decoded.replace(/^file:\/\//, '');
                }
            }

            if (path.isAbsolute(decoded)) {
                return { file: path.normalize(decoded), userPath };
            }

            if (sourcePath) {
                const baseDir = path.dirname(sourcePath);
                return { file: path.normalize(path.join(baseDir, decoded)), userPath };
            }

            return { file: path.normalize(decoded), userPath };
        },
        showDiagnostics: () => undefined,
        showErrorMessage: () => undefined,
    };

    return fake as Context;
}

const normalize = (value: string) => path.normalize(value).replace(/\\/g, '/').toLowerCase();

suite('Hot reload dependency awareness', () => {
    test('parseShaderTree includes #iSound and #include files', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-toy-deps-'));
        const includeFile = path.join(tmpDir, 'common.glsl');
        const soundFile = path.join(tmpDir, 'sound.glsl');
        const rootFile = path.join(tmpDir, 'main.glsl');

        fs.writeFileSync(includeFile, 'float foo() { return 0.5; }\n', 'utf8');
        fs.writeFileSync(soundFile, 'vec2 mainSound(float time) { return vec2(0.0); }\n', 'utf8');

        const soundUrl = pathToFileURL(soundFile).toString();
        const rootSource = `#include "common.glsl"\n#iSound "${soundUrl}"\n#iChannel0 "sound"\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(foo(), 0.0, 0.0, 1.0);\n}\n`;

        const context = makeFakeContext({
            webglVersion: 'WebGL2',
            shaderToyStrictCompatibility: false,
            warnOnUndefinedTextures: false,
            enableGlslifySupport: false,
            enabledAudioInput: false,
            testCompileIncludedFiles: false,
        });

        const provider = new WebviewContentProvider(context, rootSource, rootFile);
        const resources = await provider.parseShaderTree(false);
        const normalized = new Set(resources.map(normalize));

        assert.ok(normalized.has(normalize(rootFile)), 'Expected root shader file to be tracked');
        assert.ok(normalized.has(normalize(includeFile)), 'Expected #include file to be tracked');
        assert.ok(normalized.has(normalize(soundFile)), 'Expected #iSound file to be tracked');
    });
});
