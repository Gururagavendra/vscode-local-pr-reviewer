import * as vscode from 'vscode';
import { GitService } from '../git/gitService';

/**
 * Provides file content from a specific git ref via a custom URI scheme.
 * URI format: git-local-review://authority/{filePath}?ref={branch}
 */
export class GitFileContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    constructor(private gitService: GitService) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const filePath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
        const params = new URLSearchParams(uri.query);
        const ref = params.get('ref');

        if (!ref) {
            return '';
        }

        return this.gitService.getFileContent(ref, filePath);
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
