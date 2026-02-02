'use strict';

import * as vscode from 'vscode';
import mime from 'mime';
import * as path from 'path';
import * as fs from 'fs';
import * as Types from './typenames';
import { Context } from './context';
import { ShaderParser, ObjectType } from './shaderparser';
import { URL } from 'url';
import { SELF_SOURCE_ID } from './constants';

export { SELF_SOURCE_ID } from './constants';

type ChannelId = number;
type InputTexture = {
    Channel: ChannelId,
    Local: boolean,
    UserPath: string,
    Path: string,
    SoundIndex?: number,
    Line?: number
};
type InputTextureSettings = {
    Mag?: Types.TextureMagFilter,
    MagLine?: number,
    Min?: Types.TextureMinFilter,
    MinLine?: number,
    Wrap?: Types.TextureWrapMode
    WrapLine?: number,
    Type?: Types.TextureType
    TypeLine?: number,
};



export class BufferProvider {
    private context: Context;
    private visitedFiles: string[];
    private soundFileIndices: Map<string, number[]>;
    private soundIndexPrecisions: Map<number, string>;
    private selfSoundPrecisions: Map<string, string>;
    private webviewErrors: { file: string, line: number, message: string }[];
    constructor(context: Context) {
        this.context = context;
        this.visitedFiles = [];
        this.soundFileIndices = new Map<string, number[]>();
        this.soundIndexPrecisions = new Map<number, string>();
        this.selfSoundPrecisions = new Map<string, string>();
        this.webviewErrors = [];
    }

    public getWebviewErrors(): { file: string, line: number, message: string }[] {
        return this.webviewErrors.slice();
    }

    private registerSoundFile(index: number, file: string) {
        const existing = this.soundFileIndices.get(file);
        if (existing) {
            if (!existing.includes(index)) {
                existing.push(index);
            }
        }
        else {
            this.soundFileIndices.set(file, [index]);
        }
    }

    private looksLikeStandaloneVertexShader(code: string): boolean {
        const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, '');
        const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
        const stripped = withoutLineComments;

        const hasVertexBuiltins = /\bgl_Position\b|\bgl_VertexID\b|\bgl_InstanceID\b|\bgl_PointSize\b/.test(stripped);
        const hasFragmentSignals = /\bmainImage\b|\bgl_FragCoord\b|\bgl_FragColor\b|\bGLSL_FRAGCOLOR\b/.test(stripped);
        return hasVertexBuiltins && !hasFragmentSignals;
    }

    public async parseShaderCode(file: string, code: string, buffers: Types.BufferDefinition[], commonIncludes: Types.IncludeDefinition[], generateStandalone: boolean) {
        await this.parseShaderCodeInternal(file, file, code, buffers, commonIncludes, generateStandalone);

        // Ensure any #iSound targets are parsed as standalone buffers.
        for (const soundFile of this.soundFileIndices.keys()) {
            if (this.visitedFiles.includes(soundFile)) {
                continue;
            }
            const soundFileRead = await this.readShaderFile(soundFile);
            if (soundFileRead.success === false) {
                this.showErrorAtLine(file, `Could not open sound shader file: ${soundFile}`, 1);
                continue;
            }
            await this.parseShaderCodeInternal(file, soundFile, soundFileRead.bufferCode, buffers, commonIncludes, generateStandalone);
        }

        const findByName = (path: string) => {
            const name = this.makeName(path);
            return (value: { Name: string }) => {
                if (value.Name === name) {
                    return true;
                }
                return false;
            };
        };

        // Translate buffer names to indices including self reads
        for (let i = 0; i < buffers.length; i++) {
            const buffer = buffers[i];
            let usesSelf = false;
            let selfChannel = 0;
            for (let j = 0; j < buffer.TextureInputs.length; j++) {
                const texture = buffer.TextureInputs[j];
                if (texture.Buffer) {
                    texture.BufferIndex = buffers.findIndex(findByName(texture.Buffer));
                }
                else if (texture.Self) {
                    texture.Buffer = buffer.Name;
                    texture.BufferIndex = i;
                    usesSelf = true;
                    selfChannel = j;
                }
            }

            buffer.UsesSelf = usesSelf;
            buffer.SelfChannel = selfChannel;
        }

        // Resolve dependencies between passes
        for (let i = 0; i < buffers.length; i++) {
            const buffer = buffers[i];
            for (const texture of buffer.TextureInputs) {
                if (!texture.Self && texture.Buffer !== undefined && texture.BufferIndex !== undefined) {
                    const dependencyBuffer = buffers[texture.BufferIndex];
                    if (dependencyBuffer.UsesSelf) {
                        dependencyBuffer.Dependents.push({
                            Index: i,
                            Channel: texture.Channel
                        });
                    }
                }
            }
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async readShaderFile(file: string): Promise<{ success: boolean, error: any, bufferCode: string }> {
        for (const editor of vscode.window.visibleTextEditors) {
            let editorFile = editor.document.fileName;
            editorFile = editorFile.replace(/\\/g, '/');
            if (editorFile === file) {
                return { success: true, error: null, bufferCode: editor.document.getText() };
            }
        }

        // Read the whole file of the shader
        let success = false;
        let bufferCode = '';
        let error = null;
        try {
            bufferCode = Buffer.from(await fs.promises.readFile(file, 'utf-8')).toString();
            success = true;
        }
        catch (e) {
            error = e;
        }

        return { success, error, bufferCode };
    }

    private makeName(path: string): string {
        const name = JSON.stringify(path);
        const trim = (name: string) => {
            return name.replace(/^["]+|["]+$/g, '');
        };
        return trim(name);
    }

    private async parseShaderCodeInternal(rootFile: string, file: string, code: string, buffers: Types.BufferDefinition[], commonIncludes: Types.IncludeDefinition[], generateStandalone: boolean) {
        const found = this.visitedFiles.find((visitedFile: string) => visitedFile === file);
        if (found) {
            return;
        }
        this.visitedFiles.push(file);

        if (rootFile === file && this.looksLikeStandaloneVertexShader(code)) {
            this.showErrorAtLine(
                file,
                'This file looks like a vertex shader. Preview assumes a fragment shader; reference this file from a fragment pass using #iVertex.',
                1
            );

            // Replace with a minimal fragment stub that fails reliably with a descriptive marker.
            // NOTE: GLSL ES does not support `#error`.
            code = [
                'void mainImage(out vec4 fragColor, in vec2 fragCoord) {',
                '    ERROR_IVERTEX_SOURCE;',
                '    fragColor = vec4(0.0);',
                '}'
            ].join('\n');
        }

        const boxedLineOffset: Types.BoxedValue<number> = { Value: 0 };
        const boxedVertexShaderFile: Types.BoxedValue<string | undefined> = { Value: undefined };
        const boxedVertexShaderLine: Types.BoxedValue<number | undefined> = { Value: undefined };
        const boxedSoundShaderFiles = new Map<number, Types.BoxedValue<string | undefined>>();
        const boxedSoundShaderLines = new Map<number, Types.BoxedValue<number | undefined>>();
        const pendingTextures: InputTexture[] = [];
        const pendingTextureSettings = new Map<ChannelId, InputTextureSettings>();
        const pendingUniforms: Types.UniformDefinition[] = [];
        const includes: Types.IncludeDefinition[] = [];
        const boxedUsesKeyboard: Types.BoxedValue<boolean> = { Value: false };
        const boxedFirstPersonControls: Types.BoxedValue<boolean> = { Value: false };
        const strictComp: Types.BoxedValue<boolean> = { Value: false };

        code = await this.transformCode(
            rootFile,
            file,
            code,
            boxedLineOffset,
            boxedVertexShaderFile,
            boxedVertexShaderLine,
            boxedSoundShaderFiles,
            boxedSoundShaderLines,
            pendingTextures,
            pendingTextureSettings,
            pendingUniforms,
            includes,
            commonIncludes,
            boxedUsesKeyboard,
            boxedFirstPersonControls,
            strictComp,
            generateStandalone
        );

        // Normalize any "self" source-id sentinel to 0 for top-level compilation units.
        // (Includes are compiled separately; those are normalized in the webview compile helper.)
        code = code.replace(new RegExp(`#line\\s+(\\d+)\\s+${SELF_SOURCE_ID}`, 'g'), '#line $1 0');

        const lineOffset = boxedLineOffset.Value;
        let vertexFile: string | undefined = undefined;
        let vertexCode: string | undefined = undefined;
        let vertexLineOffset: number | undefined = undefined;

        if (boxedVertexShaderFile.Value !== undefined) {
            vertexFile = boxedVertexShaderFile.Value;
            vertexLineOffset = lineOffset;

            const vertexFileRead = await this.readShaderFile(vertexFile);
            if (vertexFileRead.success === false) {
                this.showErrorAtLine(file, `Could not open vertex shader file: ${vertexFile}`, boxedVertexShaderLine.Value ?? 0);
                vertexFile = undefined;
                vertexLineOffset = undefined;
            }
            else {
                vertexCode = Buffer.from(vertexFileRead.bufferCode).toString();

                const versionPos = vertexCode.search(/^#version/g);
                if (versionPos === 0) {
                    const newLinePos = vertexCode.search('\n');
                    const versionDirective = vertexCode.substring(versionPos, newLinePos - 1);
                    vertexCode = vertexCode.replace(versionDirective, '');
                    this.showInformationAtLine(vertexFile, `Version directive '${versionDirective}' ignored by shader-toy extension`, 0);
                }

                const vertexLineOffsetBox: Types.BoxedValue<number> = { Value: 0 };
                const vertexVertexShaderFile: Types.BoxedValue<string | undefined> = { Value: undefined };
                const vertexVertexShaderLine: Types.BoxedValue<number | undefined> = { Value: undefined };
                const vertexPendingTextures: InputTexture[] = [];
                const vertexPendingTextureSettings = new Map<ChannelId, InputTextureSettings>();
                const vertexPendingUniforms: Types.UniformDefinition[] = [];
                const vertexIncludes: Types.IncludeDefinition[] = [];
                const vertexUsesKeyboard: Types.BoxedValue<boolean> = { Value: false };
                const vertexUsesFirstPersonControls: Types.BoxedValue<boolean> = { Value: false };
                const vertexStrictComp: Types.BoxedValue<boolean> = { Value: false };

                vertexCode = await this.transformCode(
                    rootFile,
                    vertexFile,
                    vertexCode,
                    vertexLineOffsetBox,
                    vertexVertexShaderFile,
                    vertexVertexShaderLine,
                    boxedSoundShaderFiles,
                    boxedSoundShaderLines,
                    vertexPendingTextures,
                    vertexPendingTextureSettings,
                    vertexPendingUniforms,
                    vertexIncludes,
                    commonIncludes,
                    vertexUsesKeyboard,
                    vertexUsesFirstPersonControls,
                    vertexStrictComp,
                    generateStandalone
                );

                if (!vertexCode.startsWith('#line')) {
                    vertexCode = `#line 1 0\n${vertexCode}`;
                }
            }
        }
        const textures: Types.TextureDefinition[] = [];
        const audios: Types.AudioDefinition[] = [];
        const uniforms: Types.UniformDefinition[] = [];
        const usesKeyboard = boxedUsesKeyboard.Value;
        const usesFirstPersonControls = boxedFirstPersonControls.Value;

        // Resolve textures
        for (const pendingTexture of pendingTextures) {
            const depFile = pendingTexture.Path;
            const userPath = pendingTexture.UserPath;
            const channel = pendingTexture.Channel;
            const local = pendingTexture.Local;

            const normalizedPath = depFile.trim().toLowerCase();
            const soundMatch = normalizedPath.match(/^sound(?:\/\/)?(\d+)$/);
            if (soundMatch) {
                this.showErrorAtLineAndMessage(file, '#iChannel sound source must be "sound" (no index).', pendingTexture.Line ?? 1);
                continue;
            }
            if (normalizedPath === 'sound') {
                audios.push({
                    Channel: channel,
                    UserPath: userPath || 'sound',
                    FromSound: true,
                    SoundIndex: undefined
                });
                continue;
            }
            if (normalizedPath.startsWith('sound://')) {
                this.showErrorAtLineAndMessage(file, '#iChannel sound source must be "sound" (no index).', pendingTexture.Line ?? 1);
                continue;
            }

            const fullMime = mime.getType(path.extname(depFile) || 'txt') || 'text/plain';
            const mimeType = fullMime.split('/')[0] || 'text';
            switch (mimeType) {
            case 'text': {
                if (depFile === 'self' || depFile === file) {
                    // Push self as feedback-buffer
                    textures.push({
                        Channel: channel,
                        File: file,
                        Self: true
                    });
                }
                else {
                    // Read the whole file of the shader
                    const shaderFile = await this.readShaderFile(depFile);
                    if (shaderFile.success === false) {
                        vscode.window.showErrorMessage(`Could not open file: ${userPath}`);
                        return;
                    }

                    // Parse the shader
                    await this.parseShaderCodeInternal(rootFile, depFile, shaderFile.bufferCode, buffers, commonIncludes, generateStandalone);

                    // Push buffers as textures
                    textures.push({
                        Channel: channel,
                        File: file,
                        Buffer: this.makeName(depFile),
                    });
                }
                break;
            }
            case 'image': {
                if (local) {
                    textures.push({
                        Channel: channel,
                        File: file,
                        LocalTexture: depFile,
                        Mag: Types.TextureMagFilter.Linear,
                        Min: Types.TextureMinFilter.Linear,
                        Wrap: Types.TextureWrapMode.Repeat
                    });
                }
                else {
                    textures.push({
                        Channel: channel,
                        File: file,
                        RemoteTexture: depFile,
                        Mag: Types.TextureMagFilter.Linear,
                        Min: Types.TextureMinFilter.Linear,
                        Wrap: Types.TextureWrapMode.Repeat
                    });
                }
                break;
            }
            case 'audio': {
                if (this.context.getConfig<boolean>('enabledAudioInput')) {
                    if (local) {
                        audios.push({
                            Channel: channel,
                            LocalPath: depFile,
                            UserPath: userPath
                        });
                    }
                    else {
                        audios.push({
                            Channel: channel,
                            RemotePath: depFile,
                            UserPath: userPath
                        });
                    }
                }
                else {
                    vscode.window.showWarningMessage('You are trying to use an audio file, which is currently disabled in the settings.');
                }
                break;
            }
            default: {
                vscode.window.showWarningMessage(`You are trying to use an unsupported file ${depFile}`);
            }
            }
        }

        // Assign pending texture settings
        for (const texture of textures) {
            const pendingSettings = pendingTextureSettings.get(texture.Channel);
            if (pendingSettings !== undefined) {
                texture.Mag = pendingSettings.Mag || Types.TextureMagFilter.Linear;
                texture.MagLine = pendingSettings.MagLine;
                texture.Min = pendingSettings.Min || Types.TextureMinFilter.Linear;
                texture.MinLine = pendingSettings.MinLine;
                texture.Wrap = pendingSettings.Wrap || Types.TextureWrapMode.Repeat;
                texture.WrapLine = pendingSettings.WrapLine;
                texture.Type = pendingSettings.Type || Types.TextureType.Texture2D;
                texture.TypeLine = pendingSettings.TypeLine;
            }
        }

        // Transfer uniforms
        for (const pendingUniform of pendingUniforms) {
            const uniform = Object.create(pendingUniform);
            uniforms.push(uniform);
        }

        {
            const versionPos = code.search(/^#version/g);
            if (versionPos === 0) {
                const newLinePos = code.search('\n');
                const versionDirective = code.substring(versionPos, newLinePos - 1);
                code = code.replace(versionDirective, '');

                this.showInformationAtLine(file, `Version directive '${versionDirective}' ignored by shader-toy extension`, 0);
            }
        }

        // IMPORTANT: avoid matching commented-out code when scanning for entry points or channels.
        const codeForSearch = code
            // block comments (preserve newlines for line numbers)
            .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
            // line comments (preserve line length)
            .replace(/\/\/.*$/gm, (match) => ' '.repeat(match.length));

        let usesMainSound = false;
        {
            const insertMainImageCode = () => {
                code += `
void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    mainImage(GLSL_FRAGCOLOR, fragCoord);
}`;
            };

            // If there is no void main() in the shader we assume it is a shader-toy style shader
            // IMPORTANT: avoid matching commented-out code like `// void main() {}`.
            // This check only determines whether we should inject a wrapper `main()`.
            const mainPos = codeForSearch.search(/void\s+main\s*\(\s*\)\s*\{/g);
            const mainImagePos = codeForSearch.search(/void\s+mainImage\s*\(\s*out\s+vec4\s+\w+,\s*(in\s)?\s*vec2\s+\w+\s*\)\s*\{/g);
            const mainSoundAnyPos = codeForSearch.search(/\bmainSound\s*\(/g);
            const mainSoundIntPos = codeForSearch.search(/vec2\s+mainSound\s*\(\s*int\s+\w+\s*,\s*float\s+\w+\s*\)/g);
            const mainSoundFloatPos = codeForSearch.search(/vec2\s+mainSound\s*\(\s*float\s+\w+\s*\)/g);

            usesMainSound = mainSoundAnyPos >= 0;
            const hasMainSoundInt = mainSoundIntPos >= 0;
            const hasMainSoundFloat = mainSoundFloatPos >= 0;

            if (usesMainSound) {
                const webglVersion = this.context.getConfig<string>('webglVersion');
                if (webglVersion !== 'WebGL2') {
                    const line = mainSoundAnyPos >= 0
                        ? codeForSearch.slice(0, mainSoundAnyPos).split(/\r\n|\n/).length
                        : 1;
                    this.showErrorAtLine(file, 'mainSound requires shader-toy.webglVersion set to "WebGL2".', line);
                }
            }

            if (usesMainSound && hasMainSoundInt && !hasMainSoundFloat) {
                code += `
vec2 mainSound(float sampleTime) {
    return mainSound(0, sampleTime);
}`;
            }
            if (usesMainSound && hasMainSoundFloat && !hasMainSoundInt) {
                code += `
vec2 mainSound(int sampleIndex, float sampleTime) {
    return mainSound(sampleTime);
}`;
            }

            const needsMainWrapper = (mainPos === -1);
            const hasMainImage = (mainImagePos >= 0);

            if (!usesMainSound) {
                if (this.context.getConfig<boolean>('shaderToyStrictCompatibility') || strictComp.Value) {
                    insertMainImageCode();
                }
                else {
                    if (needsMainWrapper && hasMainImage) {
                        insertMainImageCode();
                    }
                }
            }
        }

        {
            // Check if defined textures are used in shader
            const definedTextures = new Set<number>;
            for (const texture of textures) {
                definedTextures.add(texture.Channel);
            }
            for (const audio of audios) {
                definedTextures.add(audio.Channel);
            }
            if (this.context.getConfig<boolean>('warnOnUndefinedTextures')) {
                for (let i = 0; i < 9; i++) {
                    if (codeForSearch.search('iChannel' + i) > 0) {
                        if (!definedTextures.has(i)) {
                            vscode.window.showWarningMessage(`iChannel${i} in use but there is no definition #iChannel${i} in shader`, 'Details')
                                .then(() => {
                                    vscode.window.showInformationMessage(`To use this channel add to your shader a line '#iChannel${i}' followed by a space and the path to your texture. Use 'file://' for local textures, 'https://' for remote textures or 'buf://' for other shaders.`);
                                });
                        }
                    }
                }
            }
        }

        if (this.context.getConfig<boolean>('enableGlslifySupport')) {
            let baseDir = path.dirname(rootFile);
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
            {
                baseDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
            }

            this.showInformationAtLine(file, `Using root path '${baseDir}' for glslify`, 0);

            // glslify the code
            const glsl = require('glslify'); // eslint-disable-line @typescript-eslint/no-require-imports
            try {
                code = glsl.compile(code, {basedir: baseDir});
            }
            catch (e) {
                const rawMessage = (e as Error).message || String(e);
                // Make the most common failure mode actionable: missing dependency modules.
                // Example: "Cannot find module 'glsl-noise/simplex/2d'".
                const missingModuleMatch = rawMessage.match(/Cannot find module ['"]([^'"]+)['"]/i);
                if (missingModuleMatch) {
                    const requested = missingModuleMatch[1];
                    // Suggest installing the top-level package name (best-effort heuristic).
                    const packageName = requested.startsWith('@')
                        ? requested.split('/').slice(0, 2).join('/')
                        : requested.split('/')[0];
                    vscode.window.showErrorMessage(
                        `glslify could not resolve '${requested}'. ` +
                        `Install the dependency in your workspace (e.g. 'npm i ${packageName}') ` +
                        `or adjust the require() path. (basedir: ${baseDir})`
                    );
                }
                else {
                    vscode.window.showErrorMessage(`glslify failed: ${rawMessage}`);
                }
            }
        }

        // Push yourself after all your dependencies
        const soundIndices = this.soundFileIndices.get(file) || [];
        const isSoundFile = soundIndices.length > 0;
        let soundPrecision: string | undefined;
        if (isSoundFile) {
            for (const index of soundIndices) {
                const precision = this.soundIndexPrecisions.get(index);
                if (!precision) {
                    continue;
                }
                if (soundPrecision && soundPrecision !== precision) {
                    this.showWarningAtLine(file, `Conflicting #iSound::Format values for sound indices; using "${soundPrecision}".`, lineOffset);
                    break;
                }
                soundPrecision = precision;
            }
            if (!soundPrecision) {
                soundPrecision = this.selfSoundPrecisions.get(file);
            }
        } else if (usesMainSound) {
            soundPrecision = this.selfSoundPrecisions.get(file);
        }
        buffers.push({
            Name: this.makeName(file),
            File: file,
            Code: code,
            VertexFile: vertexFile,
            VertexCode: vertexCode,
            VertexLineOffset: vertexLineOffset,
            Includes: includes,
            TextureInputs: textures,
            AudioInputs: audios,
            CustomUniforms: uniforms,
            UsesSelf: false,
            SelfChannel: -1,
            Dependents: [],
            IsSound: usesMainSound || isSoundFile,
            SoundIndices: soundIndices.length > 0 ? soundIndices : undefined,
            SoundPrecision: soundPrecision,
            UsesKeyboard: usesKeyboard,
            UsesFirstPersonControls: usesFirstPersonControls,
            LineOffset: lineOffset
        });
    }

    private async transformCode(
        rootFile: string,
        file: string,
        code: string,
        lineOffset: Types.BoxedValue<number>,
        vertexShaderFile: Types.BoxedValue<string | undefined>,
        vertexShaderLine: Types.BoxedValue<number | undefined>,
        soundShaderFiles: Map<number, Types.BoxedValue<string | undefined>>,
        soundShaderLines: Map<number, Types.BoxedValue<number | undefined>>,
        textures: InputTexture[],
        textureSettings: Map<ChannelId, InputTextureSettings>,
        uniforms: Types.UniformDefinition[],
        includes: Types.IncludeDefinition[],
        sharedIncludes: Types.IncludeDefinition[],
        usesKeyboard: Types.BoxedValue<boolean>,
        usesFirstPersonControls: Types.BoxedValue<boolean>,
        strictComp: Types.BoxedValue<boolean>,
        generateStandalone: boolean
    ): Promise<string> {

        const addTextureSettingIfNew = (channel: number) => {
            if (textureSettings.get(channel) === undefined) {
                textureSettings.set(channel, {});
            }
        };

        const parser = new ShaderParser(code);

        const replaceLastObject = (source: string) => {
            const lastRange = parser.getLastObjectRange();
            if (lastRange !== undefined) {
                code = parser.mutate(lastRange, source);
                parser.reset(lastRange.Begin + source.length);
            }
        };
        const removeLastObject = () => {
            replaceLastObject('');
        };

        let thisTextureSettings: InputTextureSettings | undefined;
        while (!parser.eof()) {
            const nextObject = parser.next();
            if (nextObject === undefined) {
                break;
            }

            switch (nextObject.Type) {
            case ObjectType.Error:
                if (nextObject.Message && nextObject.Message.indexOf('iSound') >= 0) {
                    this.showErrorAtLineAndMessage(file, nextObject.Message, parser.line());
                }
                else {
                    this.showErrorAtLine(file, nextObject.Message, parser.line());
                }
                break;
            case ObjectType.Texture: {
                const line = parser.line();
                let userPath = nextObject.Path;
                let textureFile: string;
                let local = false;

                const normalizedPath = userPath.trim().toLowerCase();
                const soundMatch = normalizedPath.match(/^sound(?:\/\/)?(\d+)$/);
                if (soundMatch) {
                    this.showErrorAtLineAndMessage(file, '#iChannel sound source must be "sound" (no index).', line);
                    removeLastObject();
                    break;
                }
                if (normalizedPath === 'sound') {
                    const texture: InputTexture = {
                        Channel: nextObject.Index,
                        Local: true,
                        UserPath: userPath,
                        Path: 'sound',
                        Line: line
                    };
                    textures.push(texture);
                    removeLastObject();
                    break;
                }
                if (normalizedPath.startsWith('sound://')) {
                    this.showErrorAtLineAndMessage(file, '#iChannel sound source must be "sound" (no index).', line);
                    removeLastObject();
                    break;
                }

                // Note: This is sorta cursed
                try {
                    const textureUrl = new URL(userPath);
                    if (textureUrl.protocol === 'file:') {
                        local = true;
                    }
                }
                catch {
                    local = true;
                }

                if (local) {
                    userPath = userPath.replace('file://', '');
                    if (userPath === 'self') {
                        textureFile = userPath;
                    }
                    else {
                        ({ file: textureFile, userPath: userPath } = await this.context.mapUserPath(userPath, file));
                        if (generateStandalone) {
                            textureFile = path.relative(path.dirname(rootFile), textureFile);
                        }
                    }
                }
                else {
                    textureFile = nextObject.Path;
                }

                const texture: InputTexture = {
                    Channel: nextObject.Index,
                    Local: local,
                    UserPath: userPath,
                    Path: textureFile,
                    Line: line
                };
                textures.push(texture);
                removeLastObject();
                break;
            }
            case ObjectType.TextureMagFilter:
                addTextureSettingIfNew(nextObject.Index);
                thisTextureSettings = textureSettings.get(nextObject.Index);
                if (thisTextureSettings !== undefined) {
                    thisTextureSettings.Mag = nextObject.Value;
                    thisTextureSettings.MagLine = parser.line();
                }
                removeLastObject();
                break;
            case ObjectType.TextureMinFilter:
                addTextureSettingIfNew(nextObject.Index);
                thisTextureSettings = textureSettings.get(nextObject.Index);
                if (thisTextureSettings !== undefined) {
                    thisTextureSettings.Min = nextObject.Value;
                    thisTextureSettings.MinLine = parser.line();
                }
                removeLastObject();
                break;
            case ObjectType.TextureWrapMode:
                addTextureSettingIfNew(nextObject.Index);
                thisTextureSettings = textureSettings.get(nextObject.Index);
                if (thisTextureSettings !== undefined) {
                    thisTextureSettings.Wrap = nextObject.Value;
                    thisTextureSettings.WrapLine = parser.line();
                }
                removeLastObject();
                break;
            case ObjectType.TextureType:
                addTextureSettingIfNew(nextObject.Index);
                thisTextureSettings = textureSettings.get(nextObject.Index);
                if (thisTextureSettings !== undefined) {
                    thisTextureSettings.Type = nextObject.Value;
                    thisTextureSettings.TypeLine = parser.line();
                }
                removeLastObject();
                break;
            case ObjectType.Include: {
                const includeFile = (await this.context.mapUserPath(nextObject.Path, file)).file;

                // Capture the include directive line number in the original (pre-mutation) file.
                // ShaderStream.originalLine() is 1-based.
                const includeDirectiveLine = parser.line();

                let sharedIncludeIndex = sharedIncludes.findIndex((value: Types.IncludeDefinition) => {
                    if (value.File === includeFile) {
                        return true;
                    }
                    return false;
                });

                if (sharedIncludeIndex < 0) {
                    const includeCode = await this.readShaderFile(includeFile);
                    if (includeCode.success) {
                        const include_line_offset: Types.BoxedValue<number> = { Value: 0 };
                        const include_vertex_file: Types.BoxedValue<string | undefined> = { Value: undefined };
                        const include_vertex_line: Types.BoxedValue<number | undefined> = { Value: undefined };
                        const transformedIncludeCode = await this.transformCode(
                            rootFile,
                            includeFile,
                            includeCode.bufferCode,
                            include_line_offset,
                            include_vertex_file,
                            include_vertex_line,
                            soundShaderFiles,
                            soundShaderLines,
                            textures,
                            textureSettings,
                            uniforms,
                            includes,
                            sharedIncludes,
                            usesKeyboard,
                            usesFirstPersonControls,
                            strictComp,
                            generateStandalone
                        );
                        const newInclude: Types.IncludeDefinition = {
                            Name: this.makeName(includeFile),
                            File: includeFile,
                            Code: transformedIncludeCode,
                            LineCount: transformedIncludeCode.split(/\r\n|\n/).length
                        };
                        sharedIncludes.push(newInclude);
                        sharedIncludeIndex = sharedIncludes.length - 1;
                    }
                    else {
                        this.showErrorAtLine(file, `Failed opening include file "${includeFile}"`, parser.line());
                    }
                }

                if (sharedIncludeIndex >= 0) {
                    const include = sharedIncludes[sharedIncludeIndex];
                    includes.push(include);

                    // Assign a "source string number" so WebGL error logs can be mapped back to
                    // the correct include file.
                    // - Source 0 is the current (top-level) buffer file.
                    // - Includes are 1..N following sharedIncludes order.
                    const includeSourceId = sharedIncludeIndex + 1;

                    // Re-map any "self" markers inside the included file to this include's source id.
                    // This is required for nested includes, so that errors in intermediate includes
                    // are not attributed to the outermost shader.
                    const includeCodeForInline = include.Code.replace(
                        new RegExp(`#line\\s+(\\d+)\\s+${SELF_SOURCE_ID}`, 'g'),
                        `#line $1 ${includeSourceId}`
                    );

                    // Expand includes while keeping compile error line numbers meaningful:
                    // - Inside the included file content: start at line 1 for that file.
                    // - After the include: resume numbering at the line after the include directive
                    //   in the current file (using the self sentinel).
                    // Note: do NOT end with an extra newline; the original '\n' after the include
                    // directive remains in the source.
                    const injected = `#line 1 ${includeSourceId}\n${includeCodeForInline}\n#line ${includeDirectiveLine + 1} ${SELF_SOURCE_ID}`;
                    replaceLastObject(injected);
                }

                break;
            }
            case ObjectType.Vertex: {
                const line = parser.line();
                const glslVersionConfig = this.context.getConfig<string>('webglVersion');
                const isGlslVersion3Mode = (glslVersionConfig === 'WebGL2');
                if (!isGlslVersion3Mode) {
                    this.showErrorAtLine(file, 'Custom vertex shaders (#iVertex) require shader-toy.webglVersion set to "WebGL2".', line);
                    removeLastObject();
                    break;
                }

                let userPath = nextObject.Path;
                const normalized = userPath.replace('file://', '');
                if (normalized === 'self') {
                    this.showErrorAtLine(file, '\'#iVertex "self"\' is not supported. Use \'#iVertex "default"\' or point to a .glsl file.', line);
                    removeLastObject();
                    break;
                }
                if (normalized === 'default') {
                    vertexShaderFile.Value = undefined;
                    vertexShaderLine.Value = undefined;
                    removeLastObject();
                    break;
                }

                let local = false;
                try {
                    const vertexUrl = new URL(userPath);
                    if (vertexUrl.protocol === 'file:') {
                        local = true;
                    }
                }
                catch {
                    local = true;
                }
                if (!local) {
                    this.showErrorAtLine(file, '#iVertex only supports local files (file://...) for now.', line);
                    removeLastObject();
                    break;
                }

                userPath = userPath.replace('file://', '');
                const mapped = await this.context.mapUserPath(userPath, file);
                const mappedVertexFile = mapped.file;

                if (path.extname(mappedVertexFile).toLowerCase() !== '.glsl') {
                    this.showErrorAtLine(file, `#iVertex expects a .glsl file, got "${userPath}"`, line);
                    removeLastObject();
                    break;
                }

                if (vertexShaderFile.Value !== undefined) {
                    this.showWarningAtLine(file, '#iVertex was specified multiple times; the last one wins.', line);
                }

                vertexShaderFile.Value = mappedVertexFile;
                vertexShaderLine.Value = line;
                removeLastObject();
                break;
            }
            case ObjectType.Sound: {
                const line = parser.line();
                const glslVersionConfig = this.context.getConfig<string>('webglVersion');
                const isGlslVersion3Mode = (glslVersionConfig === 'WebGL2');
                if (!isGlslVersion3Mode) {
                    this.showErrorAtLine(file, 'mainSound requires shader-toy.webglVersion set to "WebGL2".', line);
                    removeLastObject();
                    break;
                }

                const soundIndex = nextObject.Index;
                if (!Number.isFinite(soundIndex)) {
                    this.showErrorAtLineAndMessage(file, '#iSound requires an explicit index in [0..9].', line);
                    removeLastObject();
                    break;
                }
                if (soundIndex < 0 || soundIndex > 9 || Math.floor(soundIndex) !== soundIndex) {
                    this.showErrorAtLineAndMessage(file, `#iSound index must be an integer in [0..9], got "${nextObject.Index}".`, line);
                    removeLastObject();
                    break;
                }

                const soundShaderFile = soundShaderFiles.get(soundIndex) ?? { Value: undefined };
                const soundShaderLine = soundShaderLines.get(soundIndex) ?? { Value: undefined };
                soundShaderFiles.set(soundIndex, soundShaderFile);
                soundShaderLines.set(soundIndex, soundShaderLine);

                if (soundShaderLine.Value !== undefined) {
                    this.showErrorAtLineAndMessage(file, `#iSound${soundIndex} was specified multiple times.`, line);
                    removeLastObject();
                    break;
                }

                let userPath = nextObject.Path;
                const normalized = userPath.replace('file://', '');
                if (normalized === 'default') {
                    soundShaderFile.Value = undefined;
                    soundShaderLine.Value = line;
                    removeLastObject();
                    break;
                }
                if (normalized === 'self') {
                    soundShaderFile.Value = file;
                    soundShaderLine.Value = line;
                    this.registerSoundFile(soundIndex, file);
                    removeLastObject();
                    break;
                }

                let local = false;
                try {
                    const soundUrl = new URL(userPath);
                    if (soundUrl.protocol === 'file:') {
                        local = true;
                    }
                }
                catch {
                    local = true;
                }
                if (!local) {
                    this.showErrorAtLine(file, '#iSound only supports local files (file://...) for now.', line);
                    removeLastObject();
                    break;
                }

                userPath = userPath.replace('file://', '');
                const mapped = await this.context.mapUserPath(userPath, file);
                const mappedSoundFile = mapped.file;

                if (path.extname(mappedSoundFile).toLowerCase() !== '.glsl') {
                    this.showErrorAtLine(file, `#iSound expects a .glsl file, got "${userPath}"`, line);
                    removeLastObject();
                    break;
                }

                soundShaderFile.Value = mappedSoundFile;
                soundShaderLine.Value = line;
                this.registerSoundFile(soundIndex, mappedSoundFile);
                removeLastObject();
                break;
            }
            case ObjectType.SoundFormat: {
                const line = parser.line();
                const soundIndex = nextObject.Index;
                const value = String(nextObject.Value);
                const allowed = value === '32bFLOAT' || value === '16bFLOAT' || value === '16bPACK';
                if (!allowed) {
                    this.showErrorAtLineAndMessage(file, `#iSound::Format must be "32bFLOAT", "16bFLOAT", or "16bPACK" (got "${value}").`, line);
                    removeLastObject();
                    break;
                }

                if (soundIndex === -1) {
                    this.selfSoundPrecisions.set(file, value);
                    removeLastObject();
                    break;
                }

                if (soundIndex < 0 || soundIndex > 9 || Math.floor(soundIndex) !== soundIndex) {
                    this.showErrorAtLineAndMessage(file, `#iSound::Format index must be in [0..9] (got "${nextObject.Index}").`, line);
                    removeLastObject();
                    break;
                }

                this.soundIndexPrecisions.set(soundIndex, value);
                removeLastObject();
                break;
            }
            case ObjectType.Uniform:
                if (nextObject.Default !== undefined && nextObject.Min !== undefined && nextObject.Max !== undefined) {
                    const range = [nextObject.Min, nextObject.Max];
                    for (const i of [0, 1]) {
                        const value = range[i];
                        if (value.length !== nextObject.Default.length) {
                            if (value.length !== 1) {
                                const mismatchType = value.length < nextObject.Default.length ?
                                    'missing values will be replaced with first value given' :
                                    'redundant values will be removed';
                                const valueType = i === 0 ? 'minimum' : 'maximum';
                                this.showDiagnosticAtLine(file, `Type mismatch in ${valueType} value, ${mismatchType}.`, parser.line(), vscode.DiagnosticSeverity.Information);
                            }

                            for (const j of [0, 1, 2, 3]) {
                                if (range[i][j] === undefined) {
                                    range[i][j] = range[i][0];
                                }
                            }
                        }
                    }
                }

                if (nextObject.Default === undefined && nextObject.Min !== undefined) {
                    nextObject.Default = nextObject.Min;
                    this.showDiagnosticAtLine(file, 'Custom uniform specifies no default value, the minimum of its range will be used.', parser.line(), vscode.DiagnosticSeverity.Information);
                }

                if (nextObject.Default === undefined) {
                    this.showErrorAtLine(file, 'Can not deduce default value for custom uniform, either define a default value or range', parser.line());
                }
                else {
                    const uniform: Types.UniformDefinition = {
                        Name: nextObject.Name,
                        Typename: nextObject.Typename,
                        Default: nextObject.Default,
                        Min: nextObject.Min,
                        Max: nextObject.Max,
                        Step: nextObject.Step
                    };
                    uniforms.push(uniform);
                }
                removeLastObject();
                break;
            case ObjectType.Keyboard:
                usesKeyboard.Value = true;
                removeLastObject();
                break;
            case ObjectType.FirstPersonControls:
                usesFirstPersonControls.Value = true;
                removeLastObject();
                break;
            case ObjectType.StrictCompatibility:
                strictComp.Value = true;
                removeLastObject();
                break;
            default:
                break;
            }
        }

        return code;
    }

    private showDiagnosticAtLine(file: string, message: string, line: number, severity: vscode.DiagnosticSeverity) {
        const diagnosticBatch: Types.DiagnosticBatch = {
            filename: file,
            diagnostics: [{
                line: line,
                message: message
            }]
        };
        this.context.showDiagnostics(diagnosticBatch, severity);
    }
    private showErrorAtLine(file: string, message: string, line: number) {
        this.showDiagnosticAtLine(file, message, line, vscode.DiagnosticSeverity.Error);
    }
    private showErrorAtLineAndMessage(file: string, message: string, line: number) {
        this.showErrorAtLine(file, message, line);
        this.context.showErrorMessage(`${message} (${file}:${line})`);
        this.webviewErrors.push({ file, line, message });
    }
    private showWarningAtLine(file: string, message: string, line: number) {
        this.showDiagnosticAtLine(file, message, line, vscode.DiagnosticSeverity.Warning);
    }
    private showInformationAtLine(file: string, message: string, line: number) {
        this.showDiagnosticAtLine(file, message, line, vscode.DiagnosticSeverity.Information);
    }
}
