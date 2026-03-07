'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import { Context } from './context';

/**
 * Manages a separate webview panel for the variable inspector.
 *
 * Architecture:
 *   Editor Selection  →  Extension Host  →(variable)→  Preview Webview (rewrite + render)
 *   Preview Webview   →(status)→  Extension Host  →  Inspect Panel (display)
 *   Inspect Panel     →(mapping)→  Extension Host  →  Preview Webview
 *
 * Port of FragCoord v0.7.1 inspect feature.
 */
export class InspectPanel {
    private panel: vscode.WebviewPanel | undefined;
    private context: Context;
    private onMappingChanged: ((mapping: InspectorMapping) => void) | undefined;
    private onCompareChanged: ((enabled: boolean) => void) | undefined;
    private onCompareSplitChanged: ((split: number) => void) | undefined;
    private onHoverChanged: ((enabled: boolean) => void) | undefined;
    private onHistogramChanged: ((enabled: boolean) => void) | undefined;
    private onHistogramIntervalChanged: ((intervalMs: number) => void) | undefined;
    private onHistogramSampleStrideChanged: ((sampleStride: number) => void) | undefined;
    private onDidDisposeCallback: (() => void) | undefined;
    private onReadyCallback: (() => void) | undefined;

    constructor(context: Context) {
        this.context = context;
    }

    public show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        const extensionRoot = vscode.Uri.file(
            this.context.getVscodeExtensionContext().extensionPath
        );

        this.panel = vscode.window.createWebviewPanel(
            'shadertoy.inspect',
            'Variable Inspector',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [extensionRoot]
            }
        );

        this.panel.iconPath = this.context.getResourceUri('thumb.png');
        this.panel.webview.html = this.getHtmlContent();

        this.panel.onDidDispose(() => {
            this.panel = undefined;
            if (this.onDidDisposeCallback) {
                this.onDidDisposeCallback();
            }
        }, undefined, this.context.getVscodeExtensionContext().subscriptions);

        // Handle messages from the inspect panel
        this.panel.webview.onDidReceiveMessage(
            (message: { command: string; [key: string]: unknown }) => {
                switch (message.command) {
                case 'setMapping':
                    if (this.onMappingChanged && message.mapping) {
                        this.onMappingChanged(message.mapping as InspectorMapping);
                    }
                    break;
                case 'setCompare':
                    if (this.onCompareChanged) {
                        this.onCompareChanged(!!message.enabled);
                    }
                    break;
                case 'setCompareSplit':
                    if (this.onCompareSplitChanged) {
                        this.onCompareSplitChanged(Number(message.split));
                    }
                    break;
                case 'setHoverEnabled':
                    if (this.onHoverChanged) {
                        this.onHoverChanged(!!message.enabled);
                    }
                    break;
                case 'setHistogramEnabled':
                    if (this.onHistogramChanged) {
                        this.onHistogramChanged(!!message.enabled);
                    }
                    break;
                case 'setHistogramInterval':
                    if (this.onHistogramIntervalChanged) {
                        this.onHistogramIntervalChanged(Number(message.intervalMs));
                    }
                    break;
                case 'setHistogramSampleStride':
                    if (this.onHistogramSampleStrideChanged) {
                        this.onHistogramSampleStrideChanged(Number(message.sampleStride));
                    }
                    break;
                case 'panelReady':
                    if (this.onReadyCallback) {
                        this.onReadyCallback();
                    }
                    break;
                case 'navigateToLine':
                    if (message.line !== undefined) {
                        const file = (message.file as string) || this.getActiveFile();
                        if (file) {
                            this.context.revealLine(file, message.line as number);
                        }
                    }
                    break;
                }
            },
            undefined,
            this.context.getVscodeExtensionContext().subscriptions
        );
    }

    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }

    public get isVisible(): boolean {
        return this.panel !== undefined && this.panel.visible;
    }

    public get isActive(): boolean {
        return this.panel !== undefined;
    }

    /** Register callback for when the panel's mapping controls change. */
    public setOnMappingChanged(cb: (mapping: InspectorMapping) => void): void {
        this.onMappingChanged = cb;
    }

    /** Register callback for when the panel's compare mode changes. */
    public setOnCompareChanged(cb: (enabled: boolean) => void): void {
        this.onCompareChanged = cb;
    }

    /** Register callback for when the panel's compare split slider changes. */
    public setOnCompareSplitChanged(cb: (split: number) => void): void {
        this.onCompareSplitChanged = cb;
    }

    /** Register callback for when the panel's hover readback setting changes. */
    public setOnHoverChanged(cb: (enabled: boolean) => void): void {
        this.onHoverChanged = cb;
    }

    /** Register callback for when the panel's histogram setting changes. */
    public setOnHistogramChanged(cb: (enabled: boolean) => void): void {
        this.onHistogramChanged = cb;
    }

    /** Register callback for when the panel's histogram interval changes. */
    public setOnHistogramIntervalChanged(cb: (intervalMs: number) => void): void {
        this.onHistogramIntervalChanged = cb;
    }

    /** Register callback for when the panel's histogram sample stride changes. */
    public setOnHistogramSampleStrideChanged(cb: (sampleStride: number) => void): void {
        this.onHistogramSampleStrideChanged = cb;
    }

    /** Register callback for when the panel is disposed. */
    public setOnDidDispose(cb: () => void): void {
        this.onDidDisposeCallback = cb;
    }

    /** Register callback for when the webview is ready to receive initial state. */
    public setOnReady(cb: () => void): void {
        this.onReadyCallback = cb;
    }

    /** Sync persisted panel controls into a freshly created webview. */
    public postInspectorState(
        mapping: InspectorMapping,
        compareEnabled: boolean,
        compareSplit: number,
        hoverEnabled: boolean,
        histogramEnabled: boolean,
        histogramIntervalMs: number,
        histogramSampleStride: number
    ): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'syncState',
                mapping: { ...mapping },
                compareEnabled,
                compareSplit,
                hoverEnabled,
                histogramEnabled,
                histogramIntervalMs,
                histogramSampleStride
            });
        }
    }

    /** Forward variable info to the panel. */
    public postVariableUpdate(variable: string, line: number, type: string): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'updateVariable',
                variable, line, type
            });
        }
    }

    /** Forward inspector status from the preview. */
    public postStatus(status: string, message: string): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'inspectorStatus',
                status, message
            });
        }
    }

    /** Forward pixel hover readback from the preview. */
    public postPixel(rgba: number[], position: { x: number; y: number }): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'pixelValue',
                rgba,
                position
            });
        }
    }

    /** Forward histogram data from the preview. */
    public postHistogram(histogram: unknown): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'histogram',
                histogram
            });
        }
    }

    private getActiveFile(): string | undefined {
        return this.context.activeEditor?.document.fileName;
    }

    private getHtmlContent(): string {
        const htmlPath = this.context.getResourceUri('inspect_panel.html').fsPath;
        return fs.readFileSync(htmlPath, 'utf8');
    }
}

export interface InspectorMapping {
    mode: 'linear' | 'sigmoid' | 'log';
    min: number;
    max: number;
    highlightOutOfRange: boolean;
}
