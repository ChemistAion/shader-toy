'use strict';

import { WebviewExtension } from '../../webview_extension';

export class IvertexErrorRewriteExtension implements WebviewExtension {
    public generateContent(): string {
        return `\
(() => {
    // Chain onto any existing rewriter so multiple features can coexist.
    const previous = (typeof window !== 'undefined' && window.shaderToyRewriteGlslError)
        ? window.shaderToyRewriteGlslError
        : undefined;

    window.shaderToyRewriteGlslError = function (info) {
        try {
            if (previous) {
                const prevResult = previous(info);
                if (prevResult && typeof prevResult === 'object') {
                    return prevResult;
                }
            }

            if (!info || typeof info.error !== 'string') {
                return undefined;
            }

            if (info.error.indexOf('ERROR_IVERTEX_SOURCE') >= 0) {
                return {
                    lineNumber: 1,
                    error: 'This is a vertex-shader source and cannot be previewed on its own; it must be referenced using #iVertex.'
                };
            }
        } catch (e) {
            // Ignore.
        }
        return undefined;
    };
})();`;
    }
}
