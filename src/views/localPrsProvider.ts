import * as vscode from 'vscode';
import { LocalPr } from '../types';
import { LocalPrManager } from '../services/localPrManager';

export class LocalPrsProvider implements vscode.TreeDataProvider<LocalPrItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<LocalPrItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private localPrManager: LocalPrManager) {
        this.localPrManager.onDidChange(() => this.refresh());
    }

    getTreeItem(element: LocalPrItem): vscode.TreeItem {
        return element;
    }

    getChildren(): LocalPrItem[] {
        const reviews = this.localPrManager.listReviews();
        const activeId = this.localPrManager.getActiveReview()?.id;
        return reviews.map(r => new LocalPrItem(r, r.id === activeId));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

export class LocalPrItem extends vscode.TreeItem {
    constructor(
        public readonly review: LocalPr,
        isActive: boolean
    ) {
        const label = review.type === 'standalone' && review.name
            ? review.name
            : `${review.targetBranch} -> ${review.sourceBranch}`;
        super(label, vscode.TreeItemCollapsibleState.None);

        this.tooltip = `Created: ${new Date(review.createdAt).toLocaleString()}`;
        this.contextValue = 'localPr';

        if (isActive) {
            this.description = 'active';
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else if (review.type === 'standalone') {
            this.iconPath = new vscode.ThemeIcon('notebook');
        } else {
            this.iconPath = new vscode.ThemeIcon('git-pull-request');
        }

        // Click to activate
        this.command = {
            command: 'localPrReview.activateReview',
            title: 'Activate Review',
            arguments: [this],
        };
    }
}
