'use strict';

import * as Types from '../../typenames';
import { WebviewExtension } from '../webview_extension';
import { ShaderPreambleExtension } from '../preamble_extension';
import { KeyboardShaderExtension } from '../keyboard/keyboard_shader_extension';

export class ShadersExtension implements WebviewExtension {
    private content: string;

    constructor(buffers: Types.BufferDefinition[], preambleExtension: ShaderPreambleExtension, keyboardShaderExtension: KeyboardShaderExtension | undefined) {
        this.content = '';
        this.processBuffers(buffers, preambleExtension, keyboardShaderExtension);
    }

    private processBuffers(buffers: Types.BufferDefinition[],  preambleExtension: ShaderPreambleExtension, keyboardShaderExtension: KeyboardShaderExtension | undefined) {
        for (const buffer of buffers) {
            let preamble = preambleExtension.getShaderPreamble();
            for (const texture of buffer.TextureInputs) {
                if (texture.Type === Types.TextureType.CubeMap) {
                    preamble = preamble.replace(`sampler2D   iChannel${texture.Channel}`, `samplerCube iChannel${texture.Channel}`);
                }
            }
            this.content += `\
<textarea data-shadertoy='shader' id='${buffer.Name}' spellcheck='false'>
${preamble}
${keyboardShaderExtension !== undefined ? keyboardShaderExtension.getShaderPreamble() : ''}
#line 1 0
${buffer.Code}
</textarea>`;

            if (buffer.VertexCode !== undefined) {
                this.content += `\
<textarea data-shadertoy='shader' id='${buffer.Name}_vertex' data-shadertoy-vertex='true' spellcheck='false'>
${preamble}
${keyboardShaderExtension !== undefined ? keyboardShaderExtension.getShaderPreamble() : ''}
${buffer.VertexCode}
</textarea>`;
            }
        }
    }

    public generateContent(): string {
        return this.content;
    }
}
