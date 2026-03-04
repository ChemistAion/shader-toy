'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import { Context } from './context';

/**
 * Manages a separate webview panel for the variable inspector.
 *
 * Architecture:
 *   Editor Selection  →  Extension Host  →(variable)→  Preview Webview (rewrite + render)
 *   Preview Webview   →(status/pixel)→  Extension Host  →  Inspect Panel (display)
 *   Inspect Panel     →(mapping/compare)→  Extension Host  →  Preview Webview
 *
 * Port of FragCoord v0.7.1 inspect feature.
 */
export class InspectPanel {
    private panel: vscode.WebviewPanel | undefined;
    private context: Context;
    private onMappingChanged: ((mapping: InspectorMapping) => void) | undefined;
    private onCompareChanged: ((enabled: boolean) => void) | undefined;

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

    /** Register callback for when compare mode toggles. */
    public setOnCompareChanged(cb: (enabled: boolean) => void): void {
        this.onCompareChanged = cb;
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

    /** Forward pixel readback data from the preview. */
    public postPixelValue(rgba: number[], position: { x: number; y: number }): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'pixelValue',
                rgba, position
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
