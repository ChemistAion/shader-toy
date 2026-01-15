'use strict';

import * as vscode from 'vscode';

const runBestEffortEditorCommand = async (command: string, args?: unknown): Promise<boolean> => {
    try {
        await vscode.commands.executeCommand(command, args);
        return true;
    }
    catch {
        return false;
    }
};

const waitForUiTick = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const tryFocusOrCreateBelowGroup = async (): Promise<void> => {
    // If there is only one editor group, always create a below group.
    if (vscode.window.tabGroups.all.length <= 1) {
        await runBestEffortEditorCommand('workbench.action.newGroupBelow');
        await runBestEffortEditorCommand('workbench.action.focusBelowGroup');
        await runBestEffortEditorCommand('workbench.action.focusDownGroup');
        return;
    }

    // Otherwise, try to focus an existing below group first; only create a new one if focus didn't change.
    const before = vscode.window.tabGroups.activeTabGroup;

    await runBestEffortEditorCommand('workbench.action.focusBelowGroup');
    for (let i = 0; i < 3; i++) {
        await waitForUiTick(50);
        if (vscode.window.tabGroups.activeTabGroup !== before) {
            return;
        }
    }

    // Otherwise create a new below group and focus it.
    await runBestEffortEditorCommand('workbench.action.newGroupBelow');
    await runBestEffortEditorCommand('workbench.action.focusBelowGroup');
};

export const tryMovePanelBelowGroup = (panelToMove: vscode.WebviewPanel): void => {
    setTimeout(() => {
        const run = async () => {
            try {
                panelToMove.reveal(panelToMove.viewColumn, false);
            }
            catch {
                // ignore
            }

            if (await runBestEffortEditorCommand('workbench.action.moveEditorToBelowGroup')) {
                return;
            }

            await runBestEffortEditorCommand('workbench.action.newGroupBelow');
            await runBestEffortEditorCommand('workbench.action.focusBelowGroup');
            await runBestEffortEditorCommand('workbench.action.moveEditorToBelowGroup');
        };

        void run();
    }, 150);
};
