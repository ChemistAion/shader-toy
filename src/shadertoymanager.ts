'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RenderStartingData, DiagnosticBatch } from './typenames';
import { WebviewContentProvider } from './webviewcontentprovider';
import { Context } from './context';
import { removeDuplicates } from './utility';
import { FramesPanel } from './framespanel';
import { InspectPanel, InspectorMapping } from './inspectpanel';
import { resolveInspectableSelection } from './inspectselection';

type Webview = {
    Panel: vscode.WebviewPanel,
    OnDidDispose: () => void
};
type StaticWebview = Webview & {
    Document: vscode.TextDocument
};

const DEFAULT_INSPECTOR_MAPPING: InspectorMapping = {
    mode: 'linear',
    min: 0,
    max: 1,
    highlightOutOfRange: false
};
const DEFAULT_INSPECTOR_HISTOGRAM_INTERVAL_MS = 200;
const DEFAULT_INSPECTOR_HISTOGRAM_SAMPLE_STRIDE = 8;

export class ShaderToyManager {
    context: Context;

    startingData = new RenderStartingData();

    webviewPanel: Webview | undefined;
    staticWebviews: StaticWebview[] = [];
    framesPanel: FramesPanel;
    private timingEnabled = false;
    private dynamicPreviewReady = false;
    inspectPanel: InspectPanel;
    private selectionListener: vscode.Disposable | undefined;
    private _lastInspectorVariable = '';
    private _lastInspectorLine = 0;
    private _lastInspectorType = '';
    private _lastInspectorMapping: InspectorMapping = { ...DEFAULT_INSPECTOR_MAPPING };
    private _lastInspectorCompareEnabled = false;
    private _lastInspectorCompareSplit = 0.5;
    private _lastInspectorCompareFlipEnabled = false;
    private _lastInspectorHoverEnabled = true;
    private _lastInspectorHistogramEnabled = true;
    private _lastInspectorHistogramIntervalMs = DEFAULT_INSPECTOR_HISTOGRAM_INTERVAL_MS;
    private _lastInspectorHistogramSampleStride = DEFAULT_INSPECTOR_HISTOGRAM_SAMPLE_STRIDE;

    constructor(context: Context) {
        this.context = context;
        this.framesPanel = new FramesPanel(context);
        this.framesPanel.onDidDispose(() => {
            this.postTimingCommand(false);
        });
        this.framesPanel.onDidChangeVisibility((visible) => {
            this.postTimingCommand(visible);
        });
        this.inspectPanel = new InspectPanel(context);
        this.configureInspectPanel();
    }

    public migrateToNewContext = async (context: Context) => {
        this.context = context;
        this.framesPanel.updateContext(context);
        if (this.webviewPanel && this.context.activeEditor) {
            await this.updateWebview(this.webviewPanel, this.context.activeEditor.document);
            this.resendInspectorState();
        }
        for (const staticWebview of this.staticWebviews) {
            await this.updateWebview(staticWebview, staticWebview.Document);
        }
    };

    public showDynamicPreview = async () => {
        if (this.context.getConfig<boolean>('reloadOnChangeEditor') !== true) {
            this.context.activeEditor = vscode.window.activeTextEditor;
        }

        if (this.webviewPanel) {
            this.dynamicPreviewReady = false;
            this.webviewPanel.Panel.dispose();
        }
        const newWebviewPanel = this.createWebview('GLSL Preview', undefined);
        this.webviewPanel = {
            Panel: newWebviewPanel,
            OnDidDispose: () => {
                this.dynamicPreviewReady = false;
                this.webviewPanel = undefined;
            }
        };
        newWebviewPanel.onDidDispose(this.webviewPanel.OnDidDispose);
        if (this.context.activeEditor !== undefined) {
            this.webviewPanel = await this.updateWebview(this.webviewPanel, this.context.activeEditor.document);
            this.resendInspectorState();
        }
        else {
            vscode.window.showErrorMessage('Select a TextEditor to show GLSL Preview.');
        }
    };

    public showStaticPreview = async () => {
        if (vscode.window.activeTextEditor !== undefined) {
            const document = vscode.window.activeTextEditor.document;
            if (this.staticWebviews.find((webview: StaticWebview) => { return webview.Document === document; }) === undefined) {
                const newWebviewPanel = this.createWebview('Static GLSL Preview', undefined);
                const onDidDispose = () => {
                    const staticWebview = this.staticWebviews.find((webview: StaticWebview) => { return webview.Panel === newWebviewPanel; });
                    if (staticWebview !== undefined) {
                        const index = this.staticWebviews.indexOf(staticWebview);
                        this.staticWebviews.splice(index, 1);
                    }
                };
                this.staticWebviews.push({
                    Panel: newWebviewPanel,
                    OnDidDispose: onDidDispose,
                    Document: document
                });
                const staticWebview = this.staticWebviews[this.staticWebviews.length - 1];
                this.staticWebviews[this.staticWebviews.length - 1] = await this.updateWebview(staticWebview, vscode.window.activeTextEditor.document);
                newWebviewPanel.onDidDispose(onDidDispose);
            }
        }
    };

    public createPortablePreview = async () => {
        if (vscode.window.activeTextEditor !== undefined) {
            const document = vscode.window.activeTextEditor.document;
            const webviewContentProvider = new WebviewContentProvider(this.context, document.getText(), document.fileName);
            await webviewContentProvider.parseShaderTree(false);
            const htmlContent = webviewContentProvider.generateWebviewContent(undefined, this.startingData);
            const originalFileExt = path.extname(document.fileName);
            const previewFilePath = document.fileName.replace(originalFileExt, '.html');
            fs.promises.writeFile(previewFilePath, await htmlContent)
                .catch((reason: { message: string }) => {
                    console.error(reason.message);
                });
        }
    };

    public onDocumentChanged = async (documentChange: vscode.TextDocumentChangeEvent) => {
        this.onDocumentEvent(documentChange.document);
    };

    public onDocumentSaved = async (document: vscode.TextDocument) => {
        this.onDocumentEvent(document);
    };

    public onDocumentEvent = async (document: vscode.TextDocument) => {
        if (this.context.getConfig<boolean>('reloadAutomatically')) {
            const staticWebview = this.staticWebviews.find((webview: StaticWebview) => { return webview.Document === document; });
            const isActiveDocument = this.context.activeEditor !== undefined && document === this.context.activeEditor.document;
            if (isActiveDocument || staticWebview !== undefined) {
                if (this.webviewPanel !== undefined && this.context.activeEditor !== undefined) {
                    this.webviewPanel = await this.updateWebview(this.webviewPanel, this.context.activeEditor.document);
                    this.resendInspectorState();
                }

                this.staticWebviews.map((staticWebview: StaticWebview) => this.updateWebview(staticWebview, staticWebview.Document));
            }
        }
    };

    public onEditorChanged = async (newEditor: vscode.TextEditor | undefined) => {
        if (newEditor !== undefined && newEditor.document.getText() !== '' && newEditor !== this.context.activeEditor) {
            this.context.activeEditor = newEditor;

            if (this.context.getConfig<boolean>('reloadAutomatically') && this.context.getConfig<boolean>('reloadOnChangeEditor')) {
                if (this.context.getConfig<boolean>('resetStateOnChangeEditor')) {
                    this.resetStartingData();
                }
                if (!this.context.getConfig<boolean>('pauseMaintainedOnReload')) {
                    this.resetPauseState();
                }
                if (this.webviewPanel !== undefined) {
                    this.webviewPanel = await this.updateWebview(this.webviewPanel, this.context.activeEditor.document);
                    this.resendInspectorState();
                }
            }
        }
    };

    public postCommand = (command : string) => {
        if (this.webviewPanel !== undefined) {
            this.webviewPanel.Panel.webview.postMessage({command: command});
        }
        this.staticWebviews.forEach((webview: StaticWebview) => webview.Panel.webview.postMessage({command: command}));
    };

    public showFrameTimePanel = () => {
        this.framesPanel.show();
        this.framesPanel.postPreviewPaused(!!this.startingData.Paused);
        this.postTimingCommand(true);
    };

    private postTimingCommand = (enable: boolean) => {
        this.timingEnabled = enable;
        const command = enable ? 'enableFrameTiming' : 'disableFrameTiming';
        if (this.webviewPanel !== undefined && (!enable || this.dynamicPreviewReady)) {
            this.webviewPanel.Panel.webview.postMessage({ command });
        }
        this.framesPanel.postSetEnabled(enable);
    };

    public showInspectPanel = () => {
        this.inspectPanel.show();
        this.resendInspectPanelState();
        this.resendInspectorState();
        // Start listening for text selection changes
        this.startSelectionListener();
    };

    private configureInspectPanel = () => {
        this.inspectPanel.setOnMappingChanged((mapping: InspectorMapping) => {
            this._lastInspectorMapping = { ...mapping };
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({
                    command: 'setInspectorMapping',
                    mapping: this._lastInspectorMapping
                });
            }
        });

        this.inspectPanel.setOnCompareChanged((enabled: boolean) => {
            this._lastInspectorCompareEnabled = enabled;
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({
                    command: 'setInspectorCompare',
                    enabled: this._lastInspectorCompareEnabled
                });
            }
        });

        this.inspectPanel.setOnCompareSplitChanged((split: number) => {
            const normalizedSplit = Number.isFinite(split) ? Math.max(0.1, Math.min(0.9, split)) : 0.5;
            this._lastInspectorCompareSplit = normalizedSplit;
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({
                    command: 'setInspectorCompareSplit',
                    split: this._lastInspectorCompareSplit
                });
            }
        });

        this.inspectPanel.setOnCompareFlipChanged((enabled: boolean) => {
            this._lastInspectorCompareFlipEnabled = enabled;
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({
                    command: 'setInspectorCompareFlip',
                    enabled: this._lastInspectorCompareFlipEnabled
                });
            }
        });

        this.inspectPanel.setOnHoverChanged((enabled: boolean) => {
            this._lastInspectorHoverEnabled = enabled;
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({
                    command: 'setInspectorHover',
                    enabled: this._lastInspectorHoverEnabled
                });
            }
        });

        this.inspectPanel.setOnHistogramChanged((enabled: boolean) => {
            this._lastInspectorHistogramEnabled = enabled;
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({
                    command: 'setInspectorHistogram',
                    enabled: this._lastInspectorHistogramEnabled
                });
            }
        });

        this.inspectPanel.setOnHistogramIntervalChanged((intervalMs: number) => {
            const normalizedInterval = intervalMs === 100 || intervalMs === 200 || intervalMs === 1000
                ? intervalMs
                : DEFAULT_INSPECTOR_HISTOGRAM_INTERVAL_MS;
            this._lastInspectorHistogramIntervalMs = normalizedInterval;
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({
                    command: 'setInspectorHistogramInterval',
                    intervalMs: this._lastInspectorHistogramIntervalMs
                });
            }
        });

        this.inspectPanel.setOnHistogramSampleStrideChanged((sampleStride: number) => {
            const normalizedStride = sampleStride === 1 || sampleStride === 8 || sampleStride === 64
                ? sampleStride
                : DEFAULT_INSPECTOR_HISTOGRAM_SAMPLE_STRIDE;
            this._lastInspectorHistogramSampleStride = normalizedStride;
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({
                    command: 'setInspectorHistogramSampleStride',
                    sampleStride: this._lastInspectorHistogramSampleStride
                });
            }
        });

        this.inspectPanel.setOnDidDispose(() => {
            this.stopSelectionListener();
            if (this.webviewPanel !== undefined) {
                this.webviewPanel.Panel.webview.postMessage({ command: 'inspectorOff' });
            }
        });

        this.inspectPanel.setOnReady(() => {
            this.resendInspectPanelState();
        });
    };

    private startSelectionListener = () => {
        if (this.selectionListener) return;

        this.selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
            if (!this.inspectPanel.isActive) return;
            const editor = event.textEditor;
            const doc = editor.document;

            // Only act on shader-like files
            const lang = doc.languageId;
            if (lang !== 'glsl' && lang !== 'hlsl' && !doc.fileName.match(/\.(glsl|frag|vert|comp|vs|fs|shader)$/i)) {
                return;
            }

            const selection = editor.selection;
            let selectedText: string;
            if (selection.isEmpty) {
                const wordRange = doc.getWordRangeAtPosition(selection.active, /[a-zA-Z_]\w*(\.[xyzwrgba]+)?/);
                selectedText = wordRange ? doc.getText(wordRange) : '';
            } else {
                selectedText = doc.getText(selection).trim();
            }

            const line = selection.start.line + 1; // 1-based for GLSL
            const source = doc.getText();
            const inspectableSelection = resolveInspectableSelection(source, selectedText, line);

            if (inspectableSelection) {
                this._lastInspectorVariable = inspectableSelection.variable;
                this._lastInspectorLine = line;
                this._lastInspectorType = inspectableSelection.type;
                // Send to preview webview
                if (this.webviewPanel !== undefined) {
                    this.webviewPanel.Panel.webview.postMessage({
                        command: 'setInspectorVariable',
                        variable: inspectableSelection.variable,
                        line: line
                    });
                }
                // Send to inspect panel
                this.inspectPanel.postVariableUpdate(inspectableSelection.variable, line, inspectableSelection.type);
            }
        }, undefined, this.context.getVscodeExtensionContext().subscriptions);
    };

    private stopSelectionListener = () => {
        if (this.selectionListener !== undefined) {
            this.selectionListener.dispose();
            this.selectionListener = undefined;
        }
    };

    private resendInspectPanelState = () => {
        if (!this.inspectPanel.isActive) return;
        this.inspectPanel.postInspectorState(
            this._lastInspectorMapping,
            this._lastInspectorCompareEnabled,
            this._lastInspectorCompareSplit,
            this._lastInspectorCompareFlipEnabled,
            this._lastInspectorHoverEnabled,
            this._lastInspectorHistogramEnabled,
            this._lastInspectorHistogramIntervalMs,
            this._lastInspectorHistogramSampleStride
        );
        if (this._lastInspectorVariable) {
            this.inspectPanel.postVariableUpdate(this._lastInspectorVariable, this._lastInspectorLine, this._lastInspectorType);
        }
    };

    /** Re-send inspector state to the preview webview after it is rebuilt. */
    private resendInspectorState = () => {
        if (!this.inspectPanel.isActive || !this.webviewPanel) return;
        this.webviewPanel.Panel.webview.postMessage({
            command: 'setInspectorMapping',
            mapping: this._lastInspectorMapping
        });
        this.webviewPanel.Panel.webview.postMessage({
            command: 'setInspectorCompare',
            enabled: this._lastInspectorCompareEnabled
        });
        this.webviewPanel.Panel.webview.postMessage({
            command: 'setInspectorCompareSplit',
            split: this._lastInspectorCompareSplit
        });
        this.webviewPanel.Panel.webview.postMessage({
            command: 'setInspectorCompareFlip',
            enabled: this._lastInspectorCompareFlipEnabled
        });
        this.webviewPanel.Panel.webview.postMessage({
            command: 'setInspectorHover',
            enabled: this._lastInspectorHoverEnabled
        });
        this.webviewPanel.Panel.webview.postMessage({
            command: 'setInspectorHistogram',
            enabled: this._lastInspectorHistogramEnabled
        });
        this.webviewPanel.Panel.webview.postMessage({
            command: 'setInspectorHistogramInterval',
            intervalMs: this._lastInspectorHistogramIntervalMs
        });
        this.webviewPanel.Panel.webview.postMessage({
            command: 'setInspectorHistogramSampleStride',
            sampleStride: this._lastInspectorHistogramSampleStride
        });
        if (this._lastInspectorVariable) {
            this.webviewPanel.Panel.webview.postMessage({
                command: 'setInspectorVariable',
                variable: this._lastInspectorVariable,
                line: this._lastInspectorLine
            });
        }
        this.webviewPanel.Panel.webview.postMessage({ command: 'inspectorOn' });
    };

    private resetStartingData = () => {
        const paused = this.startingData.Paused;
        this.startingData = new RenderStartingData();
        this.startingData.Paused = paused;
    };
    private resetPauseState = () => {
        this.startingData.Paused = false;
        this.framesPanel.postPreviewPaused(false);
    };

    private createWebview = (title: string, localResourceRoots: vscode.Uri[] | undefined) => {
        if (localResourceRoots !== undefined) {
            const extensionRoot = vscode.Uri.file(this.context.getVscodeExtensionContext().extensionPath);
            localResourceRoots.push(extensionRoot);
        }
        const options: vscode.WebviewOptions = {
            enableScripts: true,
            localResourceRoots: localResourceRoots
        };
        const newWebviewPanel = vscode.window.createWebviewPanel(
            'shadertoy',
            title,
            { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
            options
        );
        newWebviewPanel.iconPath = this.context.getResourceUri('thumb.png');
        newWebviewPanel.webview.onDidReceiveMessage(
            (message: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
                switch (message.command) {
                case 'frameData': {
                    const isValidNumber = (value: unknown): value is number =>
                        typeof value === 'number' && Number.isFinite(value);

                    const { cpuMs, gpuMs, frameNumber } = message;

                    if (!isValidNumber(cpuMs) || !isValidNumber(gpuMs) || !isValidNumber(frameNumber)) {
                        return;
                    }

                    const clamp = (value: number, min: number, max: number): number =>
                        Math.min(Math.max(value, min), max);

                    if (this.framesPanel.isActive) {
                        this.framesPanel.postFrameData({
                            cpuMs: clamp(cpuMs, 0, 60000),
                            gpuMs: clamp(gpuMs, 0, 60000),
                            frameNumber: Math.max(0, Math.floor(frameNumber))
                        });
                    }
                    return;
                }
                case 'inspectorStatus':
                {
                    const variable = typeof message.variable === 'string' && message.variable.length > 0
                        ? message.variable
                        : this._lastInspectorVariable;
                    const type = typeof message.type === 'string' ? message.type : this._lastInspectorType;
                    this._lastInspectorVariable = variable;
                    this._lastInspectorType = type;

                    if (this.inspectPanel.isActive) {
                        this.inspectPanel.postStatus(message.status, message.message);
                        if (variable) {
                            this.inspectPanel.postVariableUpdate(variable, this._lastInspectorLine, type);
                        }
                    }
                    return;
                }
                case 'inspectorPixel':
                    if (this.inspectPanel.isActive && Array.isArray(message.rgba) && message.position) {
                        this.inspectPanel.postPixel(message.rgba, message.position);
                    }
                    return;
                case 'inspectorHistogram':
                    if (this.inspectPanel.isActive) {
                        this.inspectPanel.postHistogram(message.histogram);
                    }
                    return;
                case 'readDDSFile':
                {
                    const requestId: number = message.requestId;
                    const file: string | undefined = message.file;

                    const reply = (ok: boolean, payload: { base64?: string, error?: string }) => {
                        newWebviewPanel.webview.postMessage({
                            command: 'readDDSFileResult',
                            requestId,
                            ok,
                            ...payload
                        });
                    };

                    if (typeof requestId !== 'number' || typeof file !== 'string' || file.length === 0) {
                        reply(false, { error: 'Invalid readDDSFile request' });
                        return;
                    }

                    if (path.extname(file).toLowerCase() !== '.dds') {
                        reply(false, { error: 'Only .dds files are supported by readDDSFile' });
                        return;
                    }

                    const fileUri = vscode.Uri.file(file);
                    const roots = newWebviewPanel.webview.options.localResourceRoots ?? [];

                    const allowed = roots.some((root) => {
                        if (root.scheme !== 'file') {
                            return false;
                        }

                        const rootPath = root.fsPath;
                        const filePath = fileUri.fsPath;

                        // Normalize for Windows case-insensitive comparisons.
                        const rel = path.relative(rootPath, filePath);
                        if (!rel || rel === '') {
                            return true;
                        }
                        if (rel.startsWith('..') || path.isAbsolute(rel)) {
                            return false;
                        }
                        return true;
                    });

                    if (!allowed) {
                        reply(false, { error: 'Access denied: file is outside allowed webview roots' });
                        return;
                    }

                    vscode.workspace.fs.readFile(fileUri)
                        .then(
                            (data) => {
                                const base64 = Buffer.from(data).toString('base64');
                                reply(true, { base64 });
                            },
                            (err: {message?: string}) => {
                                reply(false, { error: err?.message ? String(err.message) : 'Failed to read file' });
                            }
                        );
                    return;
                }
                case 'reloadWebview':
                    if (this.webviewPanel !== undefined && this.webviewPanel.Panel === newWebviewPanel && this.context.activeEditor !== undefined) {
                        this.updateWebview(this.webviewPanel, this.context.activeEditor.document).then(() => {
                            this.resendInspectorState();
                        });
                    }
                    else {
                        this.staticWebviews.forEach((staticWebview: StaticWebview) => {
                            if (staticWebview.Panel === newWebviewPanel) {
                                this.updateWebview(staticWebview, staticWebview.Document);
                            }
                        });
                    }
                    return;
                case 'previewReady':
                    if (this.webviewPanel !== undefined && this.webviewPanel.Panel === newWebviewPanel) {
                        this.dynamicPreviewReady = true;
                        this.framesPanel.postPreviewPaused(!!this.startingData.Paused);
                        if (this.inspectPanel.isActive) {
                            this.resendInspectorState();
                        }
                        if (this.timingEnabled) {
                            this.webviewPanel.Panel.webview.postMessage({ command: 'enableFrameTiming' });
                        }
                    }
                    return;
                case 'updateTime':
                    this.startingData.Time = message.time;
                    return;
                case 'setPause':
                    this.startingData.Paused = message.paused;
                    this.framesPanel.postPreviewPaused(!!message.paused);
                    return;
                case 'updateMouse':
                    this.startingData.Mouse = message.mouse;
                    this.startingData.NormalizedMouse = message.normalizedMouse;
                    return;
                case 'updateKeyboard':
                    this.startingData.Keys = message.keys;
                    return;
                case 'updateFlyControlTransform':
                    this.startingData.FlyControlPosition = message.position;
                    this.startingData.FlyControlRotation = message.rotation;
                    return;
                case 'updateUniformsGuiOpen':
                    this.startingData.UniformsGui.Open = message.value;
                    return;
                case 'updateUniformsGuiValue':
                    this.startingData.UniformsGui.Values.set(message.name, message.value);
                    return;
                case 'showGlslDiagnostic':
                {
                    const diagnosticBatch: DiagnosticBatch = message.diagnosticBatch;
                    let severity: vscode.DiagnosticSeverity;

                    switch (message.type) {
                    case 'error':
                        severity = vscode.DiagnosticSeverity.Error;
                        break;
                    case 'warning':
                        severity = vscode.DiagnosticSeverity.Warning;
                        break;
                    case 'hint':
                        severity = vscode.DiagnosticSeverity.Hint;
                        break;
                    case 'information':
                    default:
                        severity = vscode.DiagnosticSeverity.Information;
                        break;
                    }

                    this.context.showDiagnostics(diagnosticBatch, severity);
                    return;
                }
                case 'showGlslsError':
                {
                    const file: string = message.file;
                    const line: number = message.line;

                    this.context.revealLine(file, line);
                    return;
                }
                case 'errorMessage':
                    vscode.window.showErrorMessage(message.message);
                    return;
                }
            },
            undefined,
            this.context.getVscodeExtensionContext().subscriptions
        );
        return newWebviewPanel;
    };

    private updateWebview = async <T extends Webview | StaticWebview>(webviewPanel: T, document: vscode.TextDocument): Promise<T> => {
        this.context.clearDiagnostics();
        const webviewContentProvider = new WebviewContentProvider(this.context, document.getText(), document.fileName);
        const localResources = await webviewContentProvider.parseShaderTree(false);

        const isDynamicPreview = this.webviewPanel !== undefined && webviewPanel.Panel === this.webviewPanel.Panel;
        if (isDynamicPreview) {
            this.dynamicPreviewReady = false;
        }

        let localResourceRoots: string[] = [];
        for (const localResource of localResources) {
            const localResourceRoot = path.dirname(localResource);
            localResourceRoots.push(localResourceRoot);
        }
        localResourceRoots = removeDuplicates(localResourceRoots);

        // Recreate webview if allowed resource roots are not part of the current resource roots
        const previousLocalResourceRoots = webviewPanel.Panel.webview.options.localResourceRoots || [];
        const previousHadLocalResourceRoot = (localResourceRootAsUri: string) => {
            const foundElement = previousLocalResourceRoots.find(uri => uri.toString() === localResourceRootAsUri);
            return foundElement !== undefined;
        };
        const previousHadAllLocalResourceRoots = localResourceRoots.every(localResourceRoot => previousHadLocalResourceRoot(vscode.Uri.file(localResourceRoot).toString()));
        if (!previousHadAllLocalResourceRoots) {
            const localResourceRootsUri = localResourceRoots.map(localResourceRoot => vscode.Uri.file(localResourceRoot));
            const newWebviewPanel = this.createWebview(webviewPanel.Panel.title, localResourceRootsUri);
            webviewPanel.Panel.dispose();
            newWebviewPanel.onDidDispose(webviewPanel.OnDidDispose);
            webviewPanel.Panel = newWebviewPanel;
        }

        webviewPanel.Panel.webview.html = await webviewContentProvider.generateWebviewContent(webviewPanel.Panel.webview, this.startingData);

        if (isDynamicPreview) {
            this.framesPanel.postPreviewPaused(!!this.startingData.Paused);
        }

        return webviewPanel;
    };
}
