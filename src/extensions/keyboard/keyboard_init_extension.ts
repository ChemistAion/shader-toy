'use strict';

import { WebviewExtension } from '../webview_extension';

export class KeyboardInitExtension implements WebviewExtension {
    private startingKeys: number[];

    public constructor(startingKeys: number[]) {
        this.startingKeys = startingKeys;
    }

    public generateContent(): string {
        return `\
var numKeys = 256;
var numStates = 4;
var keyBoardData = new Uint8Array(numKeys * numStates);
var keyBoardTexture = new THREE.DataTexture(keyBoardData, numKeys, numStates, THREE.LuminanceFormat, THREE.UnsignedByteType);
keyBoardTexture.magFilter = THREE.NearestFilter;
keyBoardTexture.needsUpdate = true;
var pressedKeys = [];
var releasedKeys = [];
var toggledKeys = [${this.startingKeys}];
for (let key of toggledKeys) {
    keyBoardData[key + 512] = 255; // Toggled
}
`;
    }
}
