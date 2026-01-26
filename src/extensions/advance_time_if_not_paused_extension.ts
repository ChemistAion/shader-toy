'use strict';

import { WebviewExtension } from './webview_extension';

export class AdvanceTimeIfNotPausedExtension implements WebviewExtension {
    public generateContent(): string {
        return `\
if (paused == false) {
    let audioTime = null;
    if (window.ShaderToy && window.ShaderToy.audioOutput && window.ShaderToy.audioOutput.getAudioTime) {
        audioTime = window.ShaderToy.audioOutput.getAudioTime();
    }
    if (typeof audioTime === 'number' && isFinite(audioTime)) {
        deltaTime = Math.max(0.0, audioTime - time);
        time = audioTime;
    } else {
        deltaTime = clock.getDelta();
        time = startingTime + clock.getElapsedTime() - pausedTime;
    }
    if (vscode !== undefined) {
        vscode.postMessage({
            command: 'updateTime',
            time: time
        });
    }
} else {
    deltaTime = 0.0;
}`;
    }
}
