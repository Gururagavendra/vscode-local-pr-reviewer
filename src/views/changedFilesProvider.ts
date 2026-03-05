import * as vscode from 'vscode';
import { FileChange, CommitInfo } from '../types';
import { GitService } from '../git/gitService';
import { StorageService } from '../storage/storageService';
import { LocalPrManager } from '../services/localPrManager';

export type ChangedFileTreeItem = SectionItem | FolderItem | FileChangeItem | CommitItem;

export class ChangedFilesProvider implements vscode.TreeDataProvider<ChangedFileTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ChangedFileTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private files: FileChange[] = [];
    private commits: CommitInfo[] = [];
    private sourceBranch: string = '';
    private targetBranch: string = '';
    private reviewedFiles: Set<string> = new Set();
    private filesSection: SectionItem | undefined;
    private commitsSection: SectionItem | undefined;

    constructor(
        private gitService: GitService,
        private storageService: StorageService,
        private localPrManager: LocalPrManager
    ) {
        this.reviewedFiles = new Set(localPrManager.getReviewedFiles());
    }

    getTreeItem(element: ChangedFileTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ChangedFileTreeItem): ChangedFileTreeItem[] {
        if (!element) {
            return this.buildRootSections();
        }
        if (element instanceof SectionItem) {
            return element.getChildren();
        }
        if (element instanceof FolderItem) {
            return element.children;
        }
        return [];
    }

    getParent(element: ChangedFileTreeItem): ChangedFileTreeItem | undefined {
        if (element instanceof FileChangeItem || element instanceof FolderItem) {
            return this.filesSection;
        }
        if (element instanceof CommitItem) {
            return this.commitsSection;
        }
        return undefined;
    }

    private buildRootSections(): ChangedFileTreeItem[] {
        if (this.files.length === 0 && this.commits.length === 0) {
            return [];
        }

        const fileChildren = this.buildFileTree();
        this.filesSection = new SectionItem('Files', 'files', fileChildren, this.files.length);
        this.commitsSection = new SectionItem('Commits', 'commits', this.buildCommitList(), this.commits.length);

        return [this.filesSection, this.commitsSection];
    }

    private buildFileTree(): ChangedFileTreeItem[] {
        const commentCounts = this.getCommentCounts();

        const groups = new Map<string, FileChange[]>();
        const rootFiles: FileChange[] = [];

        for (const file of this.files) {
            const slashIdx = file.filePath.lastIndexOf('/');
            if (slashIdx === -1) {
                rootFiles.push(file);
            } else {
                const dir = file.filePath.substring(0, slashIdx);
                if (!groups.has(dir)) {
                    groups.set(dir, []);
                }
                groups.get(dir)!.push(file);
            }
        }

        const items: ChangedFileTreeItem[] = [];

        const sortedDirs = Array.from(groups.keys()).sort();
        for (const dir of sortedDirs) {
            const dirFiles = groups.get(dir)!;
            const children = dirFiles.map(f => this.createFileItem(f, commentCounts, true));
            items.push(new FolderItem(dir, children));
        }

        for (const file of rootFiles.sort((a, b) => a.filePath.localeCompare(b.filePath))) {
            items.push(this.createFileItem(file, commentCounts, false));
        }

        return items;
    }

    private buildCommitList(): CommitItem[] {
        return this.commits.map(c => new CommitItem(c));
    }

    private createFileItem(file: FileChange, commentCounts: Map<string, number>, useBasename: boolean): FileChangeItem {
        const item = new FileChangeItem(
            file, this.sourceBranch, this.targetBranch,
            commentCounts.get(file.filePath) || 0,
            useBasename
        );
        item.checkboxState = this.reviewedFiles.has(file.filePath)
            ? vscode.TreeItemCheckboxState.Checked
            : vscode.TreeItemCheckboxState.Unchecked;
        return item;
    }

    private getCommentCounts(): Map<string, number> {
        const counts = new Map<string, number>();
        const comments = this.storageService.loadComments();
        if (comments) {
            for (const thread of comments.threads) {
                counts.set(thread.filePath, (counts.get(thread.filePath) || 0) + 1);
            }
        }
        return counts;
    }

    setFileReviewed(filePath: string, checked: boolean): void {
        if (checked) {
            this.reviewedFiles.add(filePath);
        } else {
            this.reviewedFiles.delete(filePath);
        }
        this.localPrManager.setReviewedFiles(Array.from(this.reviewedFiles));
    }

    async refresh(sourceBranch: string, targetBranch: string): Promise<void> {
        this.sourceBranch = sourceBranch;
        this.targetBranch = targetBranch;
        this.reviewedFiles = new Set(this.localPrManager.getReviewedFiles());

        if (!sourceBranch || !targetBranch) {
            this.files = [];
            this.commits = [];
            this._onDidChangeTreeData.fire(undefined);
            return;
        }

        try {
            const [files, commits] = await Promise.all([
                this.gitService.getChangedFiles(sourceBranch, targetBranch),
                this.gitService.getCommitsBetween(sourceBranch, targetBranch),
            ]);
            this.files = files;
            this.commits = commits;
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to get changed files: ${e.message}`);
            this.files = [];
            this.commits = [];
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    getAllExpandableItems(): ChangedFileTreeItem[] {
        const items: ChangedFileTreeItem[] = [];
        if (this.filesSection) {
            items.push(this.filesSection);
            for (const child of this.filesSection.getChildren()) {
                if (child instanceof FolderItem) {
                    items.push(child);
                }
            }
        }
        if (this.commitsSection) {
            items.push(this.commitsSection);
        }
        return items;
    }

    clear(): void {
        this.files = [];
        this.commits = [];
        this.reviewedFiles.clear();
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}

export class SectionItem extends vscode.TreeItem {
    private children: ChangedFileTreeItem[];

    constructor(
        label: string,
        public readonly sectionType: 'files' | 'commits',
        children: ChangedFileTreeItem[],
        count: number
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.children = children;
        this.description = `${count}`;
        this.contextValue = 'section';

        this.iconPath = sectionType === 'files'
            ? new vscode.ThemeIcon('files')
            : new vscode.ThemeIcon('git-commit');
    }

    getChildren(): ChangedFileTreeItem[] {
        return this.children;
    }
}

export class FolderItem extends vscode.TreeItem {
    constructor(
        public readonly folderPath: string,
        public readonly children: FileChangeItem[]
    ) {
        super(folderPath, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = vscode.ThemeIcon.Folder;
        this.contextValue = 'folder';
        this.description = `${children.length}`;

        // Set resourceUri so FileDecorationProvider can propagate decorations to folders
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (workspaceRoot) {
            this.resourceUri = vscode.Uri.joinPath(workspaceRoot, folderPath);
        }
    }
}

export class FileChangeItem extends vscode.TreeItem {
    constructor(
        public readonly fileChange: FileChange,
        public readonly sourceBranch: string,
        public readonly targetBranch: string,
        public readonly commentCount: number = 0,
        useBasename: boolean = false
    ) {
        const displayName = useBasename
            ? fileChange.filePath.substring(fileChange.filePath.lastIndexOf('/') + 1)
            : fileChange.filePath;
        super(displayName, vscode.TreeItemCollapsibleState.None);

        // Set resourceUri so FileDecorationProvider can show comment badges
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (workspaceRoot) {
            this.resourceUri = vscode.Uri.joinPath(workspaceRoot, fileChange.filePath);
        }

        const statusLabel = fileChange.status.charAt(0).toUpperCase();
        this.tooltip = `${fileChange.status}: ${fileChange.filePath}${commentCount > 0 ? ` (${commentCount} comment${commentCount > 1 ? 's' : ''})` : ''}`;
        this.description = commentCount > 0 ? `${statusLabel}  $(comment) ${commentCount}` : statusLabel;
        this.contextValue = 'fileChange';

        switch (fileChange.status) {
            case 'added':
                this.iconPath = new vscode.ThemeIcon('diff-added', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
                break;
            case 'deleted':
                this.iconPath = new vscode.ThemeIcon('diff-removed', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
                break;
            case 'renamed':
                this.iconPath = new vscode.ThemeIcon('diff-renamed', new vscode.ThemeColor('gitDecoration.renamedResourceForeground'));
                break;
            default:
                this.iconPath = new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
                break;
        }

        this.command = {
            command: 'localPrReview.openDiff',
            title: 'Open Diff',
            arguments: [this],
        };
    }
}

export class CommitItem extends vscode.TreeItem {
    constructor(public readonly commit: CommitInfo) {
        super(commit.message, vscode.TreeItemCollapsibleState.None);
        this.description = commit.relativeDate;
        this.tooltip = `${commit.shortHash} by ${commit.author}\n${commit.message}\n${commit.relativeDate}`;
        this.iconPath = new vscode.ThemeIcon('git-commit');
        this.contextValue = 'commit';
    }
}
