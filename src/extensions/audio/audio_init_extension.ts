'use strict';

import * as Types from '../../typenames';
import { Context } from '../../context';
import { WebviewExtension } from '../webview_extension';
import { TextureExtensionExtension } from '../textures/texture_extension_extension';

export class AudioInitExtension implements WebviewExtension, TextureExtensionExtension {
    private content: string;
    private textureContent: string;

    constructor(buffers: Types.BufferDefinition[], context: Context, makeAvailableResource: (localUri: string) => string) {
        this.content = '';
        this.textureContent = '';
        this.processBuffers(buffers, context, makeAvailableResource);
    }

    private processBuffers(buffers: Types.BufferDefinition[], context: Context, makeAvailableResource: (localUri: string) => string) {
        for (const i in buffers) {
            const buffer = buffers[i];
            const audios =  buffer.AudioInputs;
            for (const j in audios) {
                const audio = audios[j];

                const channel = audio.Channel;

                if (audio.FromSound) {
                    const fftSize = context.getConfig<number>('audioDomainSize');
                    const soundBindName = `bindSoundChannel_${i}_${j}`;
                    this.content += `
                    const ${soundBindName} = function() {
                        const bufferList = window.ShaderToy ? window.ShaderToy.buffers : undefined;
                        if (!bufferList || !bufferList[${i}] || !bufferList[${i}].Shader || !bufferList[${i}].Shader.uniforms) {
                            return false;
                        }
                        if (!window.ShaderToy || !window.ShaderToy.audioOutput || !window.ShaderToy.audioOutput.createSoundInput) {
                            return false;
                        }
                        const soundInput = window.ShaderToy.audioOutput.createSoundInput(${fftSize});
                        if (!soundInput) {
                            return false;
                        }

                        bufferList[${i}].Shader.uniforms.iChannel${channel} = { type: 't', value: soundInput.Texture };

                        audios.push({
                            Channel: ${channel},
                            Media: null,
                            Analyser: soundInput.Analyser,
                            AmplitudeSamples: soundInput.AmplitudeSamples,
                            FrequencySamples: soundInput.FrequencySamples,
                            Data: soundInput.Data,
                            Texture: soundInput.Texture
                        });

                        return true;
                    };

                    (function retrySoundChannel(attempt) {
                        if (${soundBindName}()) {
                            return;
                        }
                        if (attempt >= 40) {
                            if (vscode !== undefined) {
                                vscode.postMessage({
                                    command: 'errorMessage',
                                    message: 'Sound channel requested but no #iSound buffer is available.'
                                });
                            }
                            return;
                        }
                        setTimeout(function() { retrySoundChannel(attempt + 1); }, 250);
                    })(0);
                    `;
                    continue;
                }
                
                const localPath = audio.LocalPath;
                const remotePath = audio.RemotePath;

                let path: string | undefined;

                if (localPath !== undefined) {
                    path = makeAvailableResource(localPath);
                }
                else if (remotePath !== undefined) {
                    path = remotePath;
                }

                if (path !== undefined) {
                    this.content += `
                    fetch('${path}')
                        .then(function(response) {
                            return response.arrayBuffer();
                        })
                        .then(function(arrayBuffer) {
                            audioContext.decodeAudioData(arrayBuffer)
                                .then(function(audioBuffer) {
                                    let audio = audioContext.createBufferSource();
                                    audio.buffer = audioBuffer;
                                    audio.loop = true;

                                    let analyser = audioContext.createAnalyser();
                                    analyser.fftSize = ${context.getConfig<number>('audioDomainSize')};

                                    const dataSize = Math.max(analyser.fftSize, analyser.frequencyBinCount);
                                    const dataArray = new Uint8Array(dataSize * 2);

                                    let texture = new THREE.DataTexture(dataArray, dataSize, 2, THREE.LuminanceFormat, THREE.UnsignedByteType);
                                    texture.magFilter = THREE.LinearFilter;
                                    texture.needsUpdate = true;

                                    buffers[${i}].Shader.uniforms.iChannel${channel} = { type: 't', value: texture };

                                    audio.connect(analyser);
                                    analyser.connect(audioContext.destination);
                                    audio.start(0, startingTime % audioBuffer.duration);
        
                                    audios.push({
                                        Channel: ${channel},
                                        Media: audio,
                                        Analyser: analyser,
                                        AmplitudeSamples: analyser.fftSize,
                                        FrequencySamples: analyser.frequencyBinCount,
                                        Data: dataArray,
                                        Texture: texture
                                    })
                                })
                                .catch(function(){
                                    if (vscode !== undefined) {
                                        vscode.postMessage({
                                            command: 'errorMessage',
                                            message: 'Failed decoding audio file: ${audio.UserPath}'
                                        });
                                    }
                                });
                        }).
                        catch(function(){
                            if (vscode !== undefined) {
                                vscode.postMessage({
                                    command: 'errorMessage',
                                    message: 'Failed loading audio file: ${audio.UserPath}'
                                });
                            }
                        });
                    `;
                    this.textureContent += `buffers[${i}].Shader.uniforms.iChannel0 = { type: 't', value: null };\n`;
                }
            }
        }

        if (this.content !== '') {
            this.content = `
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContext();
            
            let audios = [];
            ` + this.content;
        }
        else {
            this.content = `
            const audioContext = {
                sampleRate: 0
            };
            `;
        }
    }

    public generateContent(): string {
        return this.content;
    }

    public generateTextureContent(): string {
        return this.textureContent;
    }
}
