import * as assert from 'assert';

import { TexturesInitExtension } from '../src/extensions/textures/textures_init_extension';
import * as Types from '../src/typenames';
import { Context } from '../src/context';

suite('Texture Init Extension Tests', () => {
    test('Generates DDS loader path for .dds textures', async () => {
        const buffers: Types.BufferDefinition[] = [
            {
                Name: 'Image',
                File: 'X:/dummy.glsl',
                Code: 'void mainImage(out vec4 c, in vec2 p) { c = vec4(0.0); }',
                TextureInputs: [
                    {
                        Channel: 0,
                        File: 'X:/dummy.glsl',
                        LocalTexture: 'X:/lut.dds',
                        Mag: Types.TextureMagFilter.Nearest,
                        Min: Types.TextureMinFilter.Nearest,
                        Wrap: Types.TextureWrapMode.Clamp,
                    }
                ],
                AudioInputs: [],
                CustomUniforms: [],
                UsesSelf: false,
                SelfChannel: 0,
                Dependents: [],
                LineOffset: 0,
                Includes: [],
            }
        ];

        const textureInit = new TexturesInitExtension();

        const fakeContext = {
            showDiagnostics: () => { /* not needed for this test */ },
        } as unknown as Context;

        const makeAvailableResource = (localUri: string) => localUri;

        await textureInit.init(buffers, fakeContext, makeAvailableResource);

        const content = textureInit.generateContent();
        assert.ok(content.includes('_stoy_loadDdsRgbaFloat32Texture'), 'Expected DDS loader helper to be present');
        assert.ok(content.includes("_stoy_loadDdsRgbaFloat32Texture('X:/lut.dds'"), 'Expected .dds texture to use DDS loader');
    });

    test('Routes multiple DDS channels through DDS loader (RGB/RGBA)', async () => {
        const buffers: Types.BufferDefinition[] = [
            {
                Name: 'Image',
                File: 'X:/dummy.glsl',
                Code: 'void mainImage(out vec4 c, in vec2 p) { c = vec4(0.0); }',
                TextureInputs: [
                    {
                        Channel: 1,
                        File: 'X:/dummy.glsl',
                        LocalTexture: 'X:/ltc_lut1.dds',
                        Mag: Types.TextureMagFilter.Linear,
                        Min: Types.TextureMinFilter.Linear,
                        Wrap: Types.TextureWrapMode.Clamp,
                    },
                    {
                        Channel: 2,
                        File: 'X:/dummy.glsl',
                        LocalTexture: 'X:/ltc_lut2.dds',
                        Mag: Types.TextureMagFilter.Linear,
                        Min: Types.TextureMinFilter.Linear,
                        Wrap: Types.TextureWrapMode.Clamp,
                    }
                ],
                AudioInputs: [],
                CustomUniforms: [],
                UsesSelf: false,
                SelfChannel: 0,
                Dependents: [],
                LineOffset: 0,
                Includes: [],
            }
        ];

        const textureInit = new TexturesInitExtension();
        const fakeContext = { showDiagnostics: () => { /* noop */ } } as unknown as Context;
        const makeAvailableResource = (localUri: string) => localUri;

        await textureInit.init(buffers, fakeContext, makeAvailableResource);

        const content = textureInit.generateContent();
        assert.ok(content.includes("_stoy_loadDdsRgbaFloat32Texture('X:/ltc_lut1.dds'"));
        assert.ok(content.includes("_stoy_loadDdsRgbaFloat32Texture('X:/ltc_lut2.dds'"));
    });
});
