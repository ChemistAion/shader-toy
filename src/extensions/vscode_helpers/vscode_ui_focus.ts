'use strict';

import * as vscode from 'vscode';

const waitForTicks = async (ticks: number): Promise<void> => {
    for (let i = 0; i < ticks; i += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
};

const getFocusCommandForViewColumn = (viewColumn: vscode.ViewColumn | undefined): string | undefined => {
    switch (viewColumn) {
    case vscode.ViewColumn.One:
        return 'workbench.action.focusFirstEditorGroup';
    case vscode.ViewColumn.Two:
        return 'workbench.action.focusSecondEditorGroup';
    case vscode.ViewColumn.Three:
        return 'workbench.action.focusThirdEditorGroup';
    default:
        return undefined;
    }
};

const tryFocusActiveEditorGroup = async (): Promise<void> => {
    try {
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }
    catch {
        // Best-effort only.
    }
};

export const tryFocusGlslPreviewPanel = async (panel: vscode.WebviewPanel): Promise<void> => {
    try {
        panel.reveal(panel.viewColumn, false);
    }
    catch {
        // Best-effort only.
    }

    await waitForTicks(2);

    const focusCommand = getFocusCommandForViewColumn(panel.viewColumn);
    if (focusCommand !== undefined) {
        try {
            await vscode.commands.executeCommand(focusCommand);
        }
        catch {
            // Best-effort only.
        }
        await waitForTicks(2);
    }
    else {
        await tryFocusActiveEditorGroup();
        await waitForTicks(2);
    }

    try {
        panel.reveal(panel.viewColumn, false);
    }
    catch {
        // Best-effort only.
    }
};
