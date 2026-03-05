import * as vscode from 'vscode';
import { StorageService } from '../storage/storageService';

export class LocalCommentsProvider implements vscode.TreeDataProvider<CommentFileItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CommentFileItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private storageService: StorageService) {}

    getTreeItem(element: CommentFileItem): vscode.TreeItem {
        return element;
    }

    getChildren(): CommentFileItem[] {
        const files = this.storageService.getAllCommentFiles();
        return files.map(f => new CommentFileItem(f.reviewLabel, f.filePath));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

export class CommentFileItem extends vscode.TreeItem {
    constructor(
        reviewLabel: string,
        public readonly filePath: string
    ) {
        super(reviewLabel, vscode.TreeItemCollapsibleState.None);

        this.description = 'comments.json';
        this.tooltip = filePath;
        this.iconPath = new vscode.ThemeIcon('comment-discussion');
        this.contextValue = 'commentFile';

        this.command = {
            command: 'vscode.open',
            title: 'Open Comments File',
            arguments: [vscode.Uri.file(filePath)],
        };
    }
}
