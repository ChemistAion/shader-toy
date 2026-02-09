'use strict';

import { WebviewExtension } from '../webview_extension';

export class SoundButtonStyleExtension implements WebviewExtension {
    private soundOnPath: string;
    private soundOffPath: string;

    constructor(getWebviewResourcePath: (relativePath: string) => string) {
        this.soundOnPath = getWebviewResourcePath('sound_on.png');
        this.soundOffPath = getWebviewResourcePath('sound_off.png');
    }

    public generateContent(): string {
        return `\
#sound-button {
    background-size: 32px;
    background-repeat: no-repeat;
    background-position: center;
    background-color: rgba(128, 128, 128, 0.5);
}
#sound-button.sound-on {
    background-image: url('${this.soundOnPath}');
}
#sound-button.sound-off {
    background-image: url('${this.soundOffPath}');
}
#sound-button:hover {
    background-color: lightgray;
    transition-duration: 0.1s;
}`;
    }
}
