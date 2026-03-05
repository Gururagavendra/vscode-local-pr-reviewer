import * as vscode from 'vscode';
import { StorageService } from '../storage/storageService';

export class ReviewFileDecorationProvider implements vscode.FileDecorationProvider {
    private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

    constructor(private storageService: StorageService) {}

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        // Only decorate workspace files (file:// scheme)
        if (uri.scheme !== 'file') {
            return undefined;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            return undefined;
        }

        // Get relative path from workspace root
        const absolutePath = uri.fsPath;
        if (!absolutePath.startsWith(workspaceRoot)) {
            return undefined;
        }

        const relativePath = absolutePath
            .slice(workspaceRoot.length)
            .replace(/\\/g, '/')
            .replace(/^\//, '');

        const count = this.getUnresolvedCount(relativePath);
        if (count === 0) {
            return undefined;
        }

        return {
            badge: `${count}`,
            tooltip: `${count} unresolved review comment${count > 1 ? 's' : ''}`,
            color: new vscode.ThemeColor('localPrReview.unresolvedCommentForeground'),
            propagate: true,
        };
    }

    private getUnresolvedCount(filePath: string): number {
        const comments = this.storageService.loadComments();
        if (!comments) {
            return 0;
        }

        return comments.threads.filter(
            t => t.filePath === filePath && t.state === 'unresolved'
        ).length;
    }

    refresh(): void {
        this._onDidChangeFileDecorations.fire(undefined);
    }

    dispose(): void {
        this._onDidChangeFileDecorations.dispose();
    }
}
