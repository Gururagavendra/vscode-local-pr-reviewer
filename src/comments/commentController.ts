import * as vscode from 'vscode';
import { StorageService } from '../storage/storageService';
import { ReviewThread, ReviewComment } from '../types';
import { GitService } from '../git/gitService';
import * as os from 'os';

interface ThreadData {
    threadId: string;
    filePath: string;
}

export class ReviewCommentController {
    private controller: vscode.CommentController;
    private threads = new Map<string, vscode.CommentThread>();
    private gitService: GitService | undefined;
    private reviewableFiles = new Set<string>();

    constructor(
        private storageService: StorageService,
        private gitRootUri: vscode.Uri
    ) {
        this.controller = vscode.comments.createCommentController(
            'localPrReview',
            'Local PR Review'
        );

        const self = this;
        this.controller.commentingRangeProvider = {
            provideCommentingRanges(document: vscode.TextDocument): vscode.Range[] {
                if (document.uri.scheme === 'git-local-review') {
                    // Use a large range to avoid race with async content loading
                    const lastLine = Math.max(document.lineCount - 1, 100000);
                    return [new vscode.Range(0, 0, lastLine, 0)];
                }
                // Allow comments on working-tree files that are part of the active review
                if (document.uri.scheme === 'file') {
                    const absolutePath = document.uri.fsPath;
                    
                    // Check if file is within git root
                    if (!absolutePath.startsWith(self.gitRootUri.fsPath)) {
                        return [];
                    }
                    
                    // Extract path relative to git root (not workspace root)
                    const relativePath = absolutePath
                        .slice(self.gitRootUri.fsPath.length)
                        .replace(/\\/g, '/')
                        .replace(/^\//, '');
                    
                    // Check both the explicit set and whether this file has existing threads
                    if (self.reviewableFiles.has(relativePath) || self.hasThreadsForFile(relativePath)) {
                        const lastLine = Math.max(document.lineCount - 1, 0);
                        return [new vscode.Range(0, 0, lastLine, 0)];
                    }
                }
                return [];
            },
        };
    }

    /**
     * Set the list of file paths (workspace-relative) that are part of the active review.
     * This enables commenting on working-tree files shown in diffs.
     */
    setReviewableFiles(filePaths: string[]): void {
        this.reviewableFiles.clear();
        for (const p of filePaths) {
            this.reviewableFiles.add(p);
        }
    }

    /**
     * Check if any loaded threads reference this file path.
     */
    private hasThreadsForFile(relativePath: string): boolean {
        for (const thread of this.threads.values()) {
            const data = (thread as any).__threadData as ThreadData | undefined;
            if (data && data.filePath === relativePath) {
                return true;
            }
        }
        return false;
    }

    /**
     * Load comment threads from storage for a given file in the diff view.
     * Creates additional threads on the diff URI so inline comments show in the diff editor.
     */
    loadThreadsForFile(fileUri: vscode.Uri, filePath: string): void {
        const comments = this.storageService.loadComments();
        if (!comments) { return; }

        const fileThreads = comments.threads.filter(t => t.filePath === filePath);
        for (const thread of fileThreads) {
            // Ensure a workspace file:// thread exists (for Comments panel)
            if (!this.threads.has(thread.id)) {
                this.createVscodeThread(vscode.Uri.joinPath(this.gitRootUri, filePath), thread, thread.id);
            }
            // Create a diff-view thread on the given URI if not already created
            if (fileUri.scheme !== 'file') {
                const dKey = `${thread.id}::${fileUri.toString()}`;
                if (!this.threads.has(dKey)) {
                    this.createVscodeThread(fileUri, thread, dKey);
                }
            }
        }
    }

    /**
     * Load all threads for the active review across all files
     */
    async loadAllThreads(gitService?: GitService, sourceBranch?: string, targetBranch?: string): Promise<void> {
        this.clearAllThreads();

        if (gitService) {
            this.gitService = gitService;
        }

        const comments = this.storageService.loadComments();
        if (!comments || comments.threads.length === 0) { return; }

        const gs = this.gitService;
        if (!gs || !sourceBranch || !targetBranch) {
            // Fallback: try to derive branches from stored comments
            const src = sourceBranch || comments.sourceBranch;
            const tgt = targetBranch || comments.targetBranch;
            if (!src || !tgt) { return; }
            await this.loadAllThreadsForBranches(comments.threads, src, tgt, gs);
            return;
        }

        await this.loadAllThreadsForBranches(comments.threads, sourceBranch, targetBranch, gs);
    }

    private async loadAllThreadsForBranches(
        threads: ReviewThread[],
        sourceBranch: string,
        targetBranch: string,
        gitService?: GitService
    ): Promise<void> {
        // Group threads by file
        const fileThreads = new Map<string, ReviewThread[]>();
        for (const thread of threads) {
            if (!fileThreads.has(thread.filePath)) {
                fileThreads.set(thread.filePath, []);
            }
            fileThreads.get(thread.filePath)!.push(thread);
        }

        // Always use git root file:// URIs so threads appear in the Comments panel
        for (const [filePath, fileSpecificThreads] of fileThreads) {
            const fileUri = vscode.Uri.joinPath(this.gitRootUri, filePath);

            for (const thread of fileSpecificThreads) {
                if (!this.threads.has(thread.id)) {
                    this.createVscodeThread(fileUri, thread, thread.id);
                }
            }
        }
    }

    createThread(
        uri: vscode.Uri,
        range: vscode.Range,
        text: string,
        filePath: string,
        existingThread?: vscode.CommentThread
    ): void {
        const author = os.userInfo().username;
        const savedThread = this.storageService.addThread(
            filePath,
            range.start.line,
            range.end.line,
            text,
            author
        );

        if (uri.scheme !== 'file') {
            // Repurpose the existing VS Code thread for the diff view (avoids race on dispose)
            if (existingThread) {
                this.populateThread(existingThread, savedThread, `${savedThread.id}::${uri.toString()}`);
            } else {
                this.createVscodeThread(uri, savedThread, `${savedThread.id}::${uri.toString()}`);
            }
            // Also create a file:// thread so it appears in the Comments panel
            const fileUri = vscode.Uri.joinPath(this.gitRootUri, filePath);
            this.createVscodeThread(fileUri, savedThread, savedThread.id);
        } else {
            // For file:// URIs, repurpose the existing thread directly
            if (existingThread) {
                this.populateThread(existingThread, savedThread, savedThread.id);
            } else {
                this.createVscodeThread(uri, savedThread, savedThread.id);
            }
        }
    }

    private populateThread(thread: vscode.CommentThread, savedThread: ReviewThread, key: string): void {
        thread.comments = savedThread.comments.map(c => this.toVscodeComment(c));
        thread.canReply = true;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        thread.state = savedThread.state === 'resolved'
            ? vscode.CommentThreadState.Resolved
            : vscode.CommentThreadState.Unresolved;
        thread.label = savedThread.state === 'resolved' ? 'Resolved' : undefined;
        thread.contextValue = savedThread.state === 'resolved' ? 'resolved' : 'unresolved';

        (thread as any).__threadData = {
            threadId: savedThread.id,
            filePath: savedThread.filePath,
        } satisfies ThreadData;

        this.threads.set(key, thread);
    }

    private createVscodeThread(uri: vscode.Uri, savedThread: ReviewThread, key?: string): void {
        const threadKey = key || savedThread.id;
        const range = new vscode.Range(savedThread.startLine, 0, savedThread.endLine, 0);
        const thread = this.controller.createCommentThread(uri, range, []);

        thread.comments = savedThread.comments.map(c => this.toVscodeComment(c));
        thread.canReply = true;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        thread.state = savedThread.state === 'resolved'
            ? vscode.CommentThreadState.Resolved
            : vscode.CommentThreadState.Unresolved;
        thread.label = savedThread.state === 'resolved' ? 'Resolved' : undefined;
        thread.contextValue = savedThread.state === 'resolved' ? 'resolved' : 'unresolved';

        // Store thread data for later retrieval  
        (thread as any).__threadData = {
            threadId: savedThread.id,
            filePath: savedThread.filePath,
        } satisfies ThreadData;

        this.threads.set(threadKey, thread);
    }

    private toVscodeComment(comment: ReviewComment): vscode.Comment {
        return {
            body: new vscode.MarkdownString(comment.body),
            author: { name: comment.author },
            mode: vscode.CommentMode.Preview,
            contextValue: 'canEdit',
            timestamp: new Date(comment.timestamp),
            label: undefined,
        };
    }

    resolveThread(thread: vscode.CommentThread): void {
        const data = (thread as any).__threadData as ThreadData | undefined;
        if (!data) { return; }

        this.storageService.resolveThread(data.threadId);
        thread.state = vscode.CommentThreadState.Resolved;
        thread.label = 'Resolved';
        thread.contextValue = 'resolved';
    }

    unresolveThread(thread: vscode.CommentThread): void {
        const data = (thread as any).__threadData as ThreadData | undefined;
        if (!data) { return; }

        this.storageService.unresolveThread(data.threadId);
        thread.state = vscode.CommentThreadState.Unresolved;
        thread.label = undefined;
        thread.contextValue = 'unresolved';
    }

    addReply(thread: vscode.CommentThread, text: string): void {
        const data = (thread as any).__threadData as ThreadData | undefined;
        if (!data) { return; }

        const author = os.userInfo().username;
        const comment = this.storageService.addReplyToThread(data.threadId, text, author);
        if (comment) {
            thread.comments = [...thread.comments, this.toVscodeComment(comment)];
        }
    }

    deleteComment(thread: vscode.CommentThread, comment: vscode.Comment): void {
        const data = (thread as any).__threadData as ThreadData | undefined;
        if (!data) { return; }

        const comments = this.storageService.loadComments();
        if (!comments) { return; }

        const storedThread = comments.threads.find(t => t.id === data.threadId);
        if (!storedThread) { return; }

        // Match by timestamp since object references may differ
        const commentTimestamp = comment.timestamp?.getTime();
        const storedComment = storedThread.comments.find(c => 
            new Date(c.timestamp).getTime() === commentTimestamp && c.author === comment.author.name
        );

        if (storedComment) {
            this.storageService.deleteComment(data.threadId, storedComment.id);

            if (storedThread.comments.length <= 1) {
                thread.dispose();
                this.threads.delete(data.threadId);
            } else {
                const idx = thread.comments.indexOf(comment);
                if (idx >= 0) {
                    const remaining = [...thread.comments];
                    remaining.splice(idx, 1);
                    thread.comments = remaining;
                }
            }
        }
    }

    findThreadForComment(comment: vscode.Comment): vscode.CommentThread | undefined {
        for (const thread of this.threads.values()) {
            if (thread.comments.includes(comment)) {
                return thread;
            }
        }
        return undefined;
    }

    private clearAllThreads(): void {
        for (const thread of this.threads.values()) {
            thread.dispose();
        }
        this.threads.clear();
    }

    dispose(): void {
        this.clearAllThreads();
        this.controller.dispose();
    }
}
