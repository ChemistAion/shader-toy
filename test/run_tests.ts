import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../');
        const extensionTestsPath = path.resolve(__dirname, './index');
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            extensionTestsEnv: {
                // Keep test output readable: VS Code's bundled extensions may emit these warnings.
                VSCODE_NODE_OPTIONS: '--disable-warning=DEP0040 --disable-warning=ExperimentalWarning'
            }
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
