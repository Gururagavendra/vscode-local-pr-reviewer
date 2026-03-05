import * as vscode from 'vscode';

export interface LocalPr {
    id: string;
    sourceBranch: string;
    targetBranch: string;
    sourceCommit: string;
    targetCommit: string;
    createdAt: string;
    reviewedFiles?: string[];
}

export interface FileChange {
    status: FileChangeStatus;
    filePath: string;
    oldFilePath?: string; // for renames
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ReviewThread {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    state: 'resolved' | 'unresolved';
    comments: ReviewComment[];
}

export interface ReviewComment {
    id: string;
    body: string;
    author: string;
    timestamp: string;
}

export interface CommentsFile {
    version: number;
    sourceBranch: string;
    targetBranch: string;
    sourceCommit: string;
    targetCommit: string;
    threads: ReviewThread[];
}

export interface LocalPrRegistry {
    version: number;
    reviews: LocalPr[];
    activeReviewId?: string;
}

export interface GitApi {
    repositories: GitRepository[];
}

export interface GitRepository {
    rootUri: vscode.Uri;
    state: {
        HEAD?: {
            name?: string;
            commit?: string;
        };
    };
    getBranches(query: { remote?: boolean }): Promise<GitBranch[]>;
}

export interface GitBranch {
    name?: string;
    commit?: string;
    type?: number;
}

export interface CommitInfo {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
    relativeDate: string;
}
