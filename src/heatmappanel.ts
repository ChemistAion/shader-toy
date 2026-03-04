'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import { Context } from './context';

/**
 * Manages a separate webview panel that displays heatmap controls
 * and per-pixel shader complexity statistics.
 *
 * Architecture:
 *   Preview Webview  →(heatmapData)→  Extension Host  →(heatmapData)→  Heatmap Panel
 *   Heatmap Panel    →(setOpacity)→   Extension Host  →(setOpacity)→   Preview Webview
 *
 * Port of FragCoord v0.7.1 performance heatmap.
 */
export class HeatmapPanel {
    private panel: vscode.WebviewPanel | undefined;
    private context: Context;

    private onOpacityChanged: ((opacity: number) => void) | undefined;
    private onColorSchemeChanged: ((scheme: string) => void) | undefined;

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
            'shadertoy.heatmap',
            'Shader Heatmap',
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

        // Listen for messages from the heatmap panel UI
        this.panel.webview.onDidReceiveMessage((msg: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            switch (msg.command) {
                case 'setHeatmapOpacity':
                    if (this.onOpacityChanged && typeof msg.opacity === 'number') {
                        this.onOpacityChanged(msg.opacity);
                    }
                    break;
                case 'setHeatmapColorScheme':
                    if (this.onColorSchemeChanged && typeof msg.scheme === 'string') {
                        this.onColorSchemeChanged(msg.scheme);
                    }
                    break;
            }
        }, undefined, this.context.getVscodeExtensionContext().subscriptions);
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

    public setOnOpacityChanged(callback: (opacity: number) => void): void {
        this.onOpacityChanged = callback;
    }

    public setOnColorSchemeChanged(callback: (scheme: string) => void): void {
        this.onColorSchemeChanged = callback;
    }

    /**
     * Forward heatmap data (min/max counts) from preview to the panel.
     */
    public postHeatmapData(minCount: number, maxCount: number): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'heatmapData',
                minCount: minCount,
                maxCount: maxCount
            });
        }
    }

    /**
     * Forward per-line instruction counts to the panel.
     */
    public postLineCounts(counts: Array<{ line: number; count: number }>): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'heatmapLineCounts',
                counts: counts
            });
        }
    }

    private getHtmlContent(): string {
        const htmlPath = this.context.getResourceUri('heatmap_panel.html').fsPath;
        return fs.readFileSync(htmlPath, 'utf8');
    }
}
