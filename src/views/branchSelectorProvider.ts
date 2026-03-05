import * as vscode from 'vscode';
import { LocalPrManager } from '../services/localPrManager';
import { GitService } from '../git/gitService';

export class BranchSelectorProvider implements vscode.TreeDataProvider<BranchSelectorItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<BranchSelectorItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private sourceBranch: string = 'origin/devel';
    private targetBranch: string = '';

    constructor(
        private gitService: GitService,
        private localPrManager: LocalPrManager
    ) {
        // Sync with active review
        const active = this.localPrManager.getActiveReview();
        if (active) {
            this.sourceBranch = active.sourceBranch;
            this.targetBranch = active.targetBranch;
        }
    }

    getTreeItem(element: BranchSelectorItem): vscode.TreeItem {
        return element;
    }

    getChildren(): BranchSelectorItem[] {
        return [
            new BranchSelectorItem(
                'Base',
                this.sourceBranch || '(select base branch)',
                'localPrReview.selectSource'
            ),
            new BranchSelectorItem(
                'Compare',
                this.targetBranch || '(select compare branch)',
                'localPrReview.selectDestination'
            ),
        ];
    }

    getSourceBranch(): string {
        return this.sourceBranch;
    }

    getTargetBranch(): string {
        return this.targetBranch;
    }

    setSourceBranch(branch: string): void {
        this.sourceBranch = branch;
        this._onDidChangeTreeData.fire(undefined);
    }

    setTargetBranch(branch: string): void {
        this.targetBranch = branch;
        this._onDidChangeTreeData.fire(undefined);
    }

    refresh(): void {
        const active = this.localPrManager.getActiveReview();
        if (active) {
            this.sourceBranch = active.sourceBranch;
            this.targetBranch = active.targetBranch;
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

class BranchSelectorItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly branchName: string,
        commandId: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = branchName;
        this.tooltip = `Click to change ${label.toLowerCase()} branch`;
        this.command = {
            command: commandId,
            title: `Select ${label} Branch`,
        };
        this.iconPath = new vscode.ThemeIcon('git-branch');
    }
}
