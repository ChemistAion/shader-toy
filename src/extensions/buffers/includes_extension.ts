'use strict';

import * as Types from '../../typenames';
import { WebviewExtension } from '../webview_extension';
import { ShaderPreambleExtension } from '../preamble_extension';

export class IncludesExtension implements WebviewExtension {
    private content: string;

    constructor(includes: Types.IncludeDefinition[], preambleExtension: ShaderPreambleExtension) {
        this.content = '';
        this.processBuffers(includes, preambleExtension);
    }

    private processBuffers(includes: Types.IncludeDefinition[], preambleExtension: ShaderPreambleExtension) {
        for (const include of includes) {
            this.content += `\
<textarea data-shadertoy='include' id='${include.Name}' spellcheck='false'>
${preambleExtension.getShaderPreamble()}
${include.Code}
</textarea>`;
        }
    }

    public generateContent(): string {
        return this.content;
    }
}
