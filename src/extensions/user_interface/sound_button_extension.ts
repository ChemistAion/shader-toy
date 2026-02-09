'use strict';

import { WebviewExtension } from '../webview_extension';

export class SoundButtonExtension implements WebviewExtension {
    public generateContent(): string {
        return '<span id=\'sound-button\' class=\'rec_base sound-on\'></span>';
    }
}
