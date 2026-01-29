'use strict';

import * as Types from '../../typenames';
import { WebviewExtension } from '../webview_extension';

export class BuffersInitExtension implements WebviewExtension {
    private content: string;

    constructor(buffers: Types.BufferDefinition[]) {
        this.content = '';
        this.processBuffers(buffers);
    }

    private processBuffers(buffers: Types.BufferDefinition[]) {
        let lastVisualIndex = -1;
        for (let i = buffers.length - 1; i >= 0; i--) {
            if (buffers[i].IsSound !== true) {
                lastVisualIndex = i;
                break;
            }
        }

        let bufferIndex = 0;
        for (const buffer of buffers) {
            const isSound = buffer.IsSound === true;
            // Create a RenderTarget for all but the final buffer
            let target = 'null';
            let pingPongTarget = 'null';
            if (!isSound && bufferIndex !== lastVisualIndex) {
                target = 'new THREE.WebGLRenderTarget(resolution.x, resolution.y, { type: framebufferType })';
            }
            if (!isSound && buffer.UsesSelf) {
                pingPongTarget = 'new THREE.WebGLRenderTarget(resolution.x, resolution.y, { type: framebufferType })';
            }

            const defaultVertexShader = `glslUseVersion3
        ? prepareVertexShader('void main() { gl_Position = vec4(position, 1.0); }')
        : 'void main() { gl_Position = vec4(position, 1.0); }'`;
            const glslVersionLine = `...(glslUseVersion3 && THREE.GLSL3 ? { glslVersion: THREE.GLSL3 } : {})`;

            this.content += `\
buffers.push({
    Name: ${JSON.stringify(buffer.Name)},
    File: ${JSON.stringify(buffer.File)},
    LineOffset: ${buffer.LineOffset},
    VertexFile: ${buffer.VertexFile !== undefined ? `'${buffer.VertexFile}'` : 'undefined'},
    VertexLineOffset: ${buffer.VertexLineOffset !== undefined ? `${buffer.VertexLineOffset}` : 'undefined'},
    VertexShaderElementId: ${buffer.VertexCode !== undefined ? `'${buffer.Name}_vertex'` : 'undefined'},
    IsSound: ${buffer.IsSound ? 'true' : 'false'},
    SoundIndices: ${buffer.SoundIndices ? JSON.stringify(buffer.SoundIndices) : 'undefined'},
    SoundPrecision: ${buffer.SoundPrecision !== undefined ? JSON.stringify(buffer.SoundPrecision) : 'undefined'},
    Target: ${target},
    ChannelResolution: Array(10).fill(new THREE.Vector3(0,0,0)),
    PingPongTarget: ${pingPongTarget},
    PingPongChannel: ${buffer.SelfChannel},
    Dependents: ${JSON.stringify(buffer.Dependents)},
    SampleBindings: ${JSON.stringify(buffer.SampleBindings || [])},
    Shader: ${isSound ? 'null' : `new THREE.ShaderMaterial({
        ${glslVersionLine},
        vertexShader: ${buffer.VertexCode !== undefined ? `prepareVertexShader(document.getElementById(${JSON.stringify(buffer.Name + '_vertex')}).textContent)` : defaultVertexShader},
        fragmentShader: prepareFragmentShader(document.getElementById(${JSON.stringify(buffer.Name)}).textContent),
        depthWrite: false,
        depthTest: false,
        uniforms: {
            iResolution: { type: 'v3', value: resolution },
            iTime: { type: 'f', value: 0.0 },
            iTimeDelta: { type: 'f', value: 0.0 },
            iFrame: { type: 'i', value: 0 },
            iMouse: { type: 'v4', value: mouse },
            iMouseButton: { type: 'v2', value: mouseButton },
            iViewMatrix: {type: 'm44', value: new THREE.Matrix4() },
            iChannelResolution: { type: 'v3v', value: Array(10).fill(new THREE.Vector3(0,0,0)) },

            iDate: { type: 'v4', value: date },
            iSampleRate: { type: 'f', value: audioContext.sampleRate },
            iAudioTime: { type: 'f', value: 0.0 },
            iSampleBlockSize: { type: 'i', value: 512 * 512 },
            iSampleRingDepth: { type: 'i', value: 0 },

            iChannel0: { type: 't' },
            iChannel1: { type: 't' },
            iChannel2: { type: 't' },
            iChannel3: { type: 't' },
            iChannel4: { type: 't' },
            iChannel5: { type: 't' },
            iChannel6: { type: 't' },
            iChannel7: { type: 't' },
            iChannel8: { type: 't' },
            iChannel9: { type: 't' },

            resolution: { type: 'v2', value: resolution },
            time: { type: 'f', value: 0.0 },
            mouse: { type: 'v2', value: normalizedMouse },
        }
    })`}

});`;
        }
    }

    public generateContent(): string {
        return this.content;
    }
}
