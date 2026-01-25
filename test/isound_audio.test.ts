import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

import { BufferProvider } from '../src/bufferprovider';
import { Context } from '../src/context';
import * as Types from '../src/typenames';

type CapturedDiagnostic = {
    filename: string;
    message: string;
    line: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    severity: any;
};

function makeFakeContext(config: Record<string, unknown>, capturedDiagnostics: CapturedDiagnostic[]): Context {
    const fake: Partial<Context> = {
        getConfig: <T>(section: string): T | undefined => config[section] as T | undefined,
        mapUserPath: async (userPath: string) => {
            const withoutLeadingSlashes = userPath.replace(/^\/+([A-Za-z]:\/+)/, '$1');
            const decoded = decodeURIComponent(withoutLeadingSlashes);
            return {
                file: path.normalize(decoded),
                userPath,
            };
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        showDiagnostics: (batch: Types.DiagnosticBatch, severity: any) => {
            for (const diagnostic of batch.diagnostics) {
                capturedDiagnostics.push({
                    filename: batch.filename,
                    message: diagnostic.message,
                    line: diagnostic.line,
                    severity,
                });
            }
        },
    };

    return fake as Context;
}

suite('#iSound and sound-channel audio inputs', () => {
    test('WebGL2 mode: #iSound loads sound buffer and wraps mainSound(int,float)', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-toy-isound-'));
        const soundFile = path.join(tmpDir, 'sound.glsl');

        fs.writeFileSync(
            soundFile,
            [
                'vec2 mainSound(int samp, float time) {',
                '    return vec2(0.0);',
                '}',
            ].join('\n'),
            'utf8'
        );

        const soundUrl = pathToFileURL(soundFile).toString();
        const code = `#iSound "${soundUrl}"
#iChannel0 "sound"
void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.0); }
`;

        const diags: CapturedDiagnostic[] = [];
        const provider = new BufferProvider(makeFakeContext({
            webglVersion: 'WebGL2',
            shaderToyStrictCompatibility: false,
            warnOnUndefinedTextures: false,
            enableGlslifySupport: false,
            enabledAudioInput: false,
            testCompileIncludedFiles: false,
        }, diags));

        const buffers: Types.BufferDefinition[] = [];
        const includes: Types.IncludeDefinition[] = [];
        await provider.parseShaderCode(path.join(tmpDir, 'main.glsl'), code, buffers, includes, false);

        const soundBuffer = buffers.find((b) => b.IsSound);
        assert.ok(soundBuffer, 'Expected a sound buffer from #iSound');
        assert.ok(soundBuffer?.Code.includes('vec2 mainSound(float time)'), 'Expected float wrapper for mainSound');

        const mainBuffer = buffers.find((b) => !b.IsSound);
        assert.ok(mainBuffer, 'Expected a main buffer for the visual shader');
        assert.ok(mainBuffer?.AudioInputs.some((audio) => audio.FromSound && audio.Channel === 0), 'Expected sound audio input on channel 0');

        assert.ok(
            diags.every((d) => !d.message.includes('mainSound requires shader-toy.webglVersion')),
            'Expected no WebGL2 gating diagnostics for #iSound in WebGL2 mode'
        );
    });

    test('WebGL2 mode: mainSound(float) does not add extra wrapper', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-toy-isound-'));
        const soundFile = path.join(tmpDir, 'sound.glsl');

        fs.writeFileSync(
            soundFile,
            [
                'vec2 mainSound(float time) {',
                '    return vec2(0.0);',
                '}',
            ].join('\n'),
            'utf8'
        );

        const soundUrl = pathToFileURL(soundFile).toString();
        const code = `#iSound "${soundUrl}"
void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.0); }
`;

        const diags: CapturedDiagnostic[] = [];
        const provider = new BufferProvider(makeFakeContext({
            webglVersion: 'WebGL2',
            shaderToyStrictCompatibility: false,
            warnOnUndefinedTextures: false,
            enableGlslifySupport: false,
            enabledAudioInput: false,
            testCompileIncludedFiles: false,
        }, diags));

        const buffers: Types.BufferDefinition[] = [];
        const includes: Types.IncludeDefinition[] = [];
        await provider.parseShaderCode(path.join(tmpDir, 'main.glsl'), code, buffers, includes, false);

        const soundBuffer = buffers.find((b) => b.IsSound);
        assert.ok(soundBuffer, 'Expected a sound buffer from #iSound');
        assert.ok(!(soundBuffer?.Code || '').includes('vec2 mainSound(float time) {\n    return mainSound(0, time);\n}'));
    });

    test('Default mode: #iSound is rejected and no sound buffer is added', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-toy-isound-'));
        const soundFile = path.join(tmpDir, 'sound.glsl');

        fs.writeFileSync(soundFile, 'vec2 mainSound(float time) { return vec2(0.0); }\n', 'utf8');

        const soundUrl = pathToFileURL(soundFile).toString();
        const code = `#iSound "${soundUrl}"
void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.0); }
`;

        const diags: CapturedDiagnostic[] = [];
        const provider = new BufferProvider(makeFakeContext({
            webglVersion: 'Default',
            shaderToyStrictCompatibility: false,
            warnOnUndefinedTextures: false,
            enableGlslifySupport: false,
            enabledAudioInput: false,
            testCompileIncludedFiles: false,
        }, diags));

        const buffers: Types.BufferDefinition[] = [];
        const includes: Types.IncludeDefinition[] = [];
        await provider.parseShaderCode(path.join(tmpDir, 'main.glsl'), code, buffers, includes, false);

        assert.strictEqual(buffers.filter((b) => b.IsSound).length, 0, 'Expected no sound buffer in Default mode');
        assert.ok(
            diags.some((d) => d.message.includes('mainSound requires shader-toy.webglVersion')),
            'Expected WebGL2-only diagnostic for #iSound'
        );
    });

    test('WebGL2 mode: #iChannel "sound" without #iSound does not create sound buffer', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-toy-isound-'));
        const code = `#iChannel0 "sound"
void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(0.0); }
`;

        const diags: CapturedDiagnostic[] = [];
        const provider = new BufferProvider(makeFakeContext({
            webglVersion: 'WebGL2',
            shaderToyStrictCompatibility: false,
            warnOnUndefinedTextures: false,
            enableGlslifySupport: false,
            enabledAudioInput: false,
            testCompileIncludedFiles: false,
        }, diags));

        const buffers: Types.BufferDefinition[] = [];
        const includes: Types.IncludeDefinition[] = [];
        await provider.parseShaderCode(path.join(tmpDir, 'main.glsl'), code, buffers, includes, false);

        assert.strictEqual(buffers.filter((b) => b.IsSound).length, 0, 'Expected no sound buffer without #iSound');
        const mainBuffer = buffers.find((b) => !b.IsSound);
        assert.ok(mainBuffer, 'Expected a main buffer');
        assert.ok(mainBuffer?.AudioInputs.some((audio) => audio.FromSound && audio.Channel === 0), 'Expected sound input to be registered');
    });
});
