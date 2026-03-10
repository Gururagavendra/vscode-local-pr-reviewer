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
        const activeReviewLabel = this.storageService.getActiveReviewLabel();
        return files.map(f => new CommentFileItem(f.reviewLabel, f.filePath, f.reviewLabel === activeReviewLabel));
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
        public readonly filePath: string,
        isActive: boolean
    ) {
        super(reviewLabel, vscode.TreeItemCollapsibleState.None);

        this.description = isActive ? 'active' : 'comments.json';
        this.tooltip = isActive ? `${filePath} (active review)` : filePath;
        this.iconPath = new vscode.ThemeIcon(
            isActive ? 'comment-discussion' : 'comment',
            isActive ? undefined : new vscode.ThemeColor('descriptionForeground')
        );
        this.contextValue = 'commentFile';

        this.command = {
            command: 'vscode.open',
            title: 'Open Comments File',
            arguments: [vscode.Uri.file(filePath)],
        };
    }
}
