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

    constructor(private storageService: StorageService) {
        this.controller = vscode.comments.createCommentController(
            'localPrReview',
            'Local PR Review'
        );

        const self = this;
        this.controller.commentingRangeProvider = {
            provideCommentingRanges(document: vscode.TextDocument): vscode.Range[] {
                if (document.uri.scheme === 'git-local-review') {
                    return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
                }
                // Allow comments on working-tree files that are part of the active review
                if (document.uri.scheme === 'file') {
                    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
                    if (self.reviewableFiles.has(relativePath)) {
                        return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
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
     * Load comment threads from storage for a given file in the diff view
     */
    loadThreadsForFile(fileUri: vscode.Uri, filePath: string): void {
        const comments = this.storageService.loadComments();
        if (!comments) { return; }

        const fileThreads = comments.threads.filter(t => t.filePath === filePath);
        for (const thread of fileThreads) {
            if (!this.threads.has(thread.id)) {
                this.createVscodeThread(fileUri, thread);
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

        const isWorkingTree = gitService ? await gitService.isCurrentBranch(targetBranch) : false;
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;

        for (const [filePath, fileSpecificThreads] of fileThreads) {
            const rightUri = isWorkingTree && workspaceUri
                ? vscode.Uri.joinPath(workspaceUri, filePath)
                : vscode.Uri.parse(
                    `git-local-review://authority/${filePath}?ref=${encodeURIComponent(targetBranch)}`
                );

            for (const thread of fileSpecificThreads) {
                if (!this.threads.has(thread.id)) {
                    this.createVscodeThread(rightUri, thread);
                }
            }
        }
    }

    createThread(
        uri: vscode.Uri,
        range: vscode.Range,
        text: string,
        filePath: string
    ): void {
        const author = os.userInfo().username;
        const savedThread = this.storageService.addThread(
            filePath,
            range.start.line,
            range.end.line,
            text,
            author
        );

        this.createVscodeThread(uri, savedThread);
    }

    private createVscodeThread(uri: vscode.Uri, savedThread: ReviewThread): void {
        const range = new vscode.Range(savedThread.startLine, 0, savedThread.endLine, 0);
        const thread = this.controller.createCommentThread(uri, range, []);

        thread.comments = savedThread.comments.map(c => this.toVscodeComment(c));
        thread.canReply = true;
        thread.state = savedThread.state === 'resolved'
            ? vscode.CommentThreadState.Resolved
            : vscode.CommentThreadState.Unresolved;
        thread.label = savedThread.state === 'resolved' ? 'Resolved' : undefined;
        thread.contextValue = 'localPrReviewThread';

        // Store thread data for later retrieval  
        (thread as any).__threadData = {
            threadId: savedThread.id,
            filePath: savedThread.filePath,
        } satisfies ThreadData;

        this.threads.set(savedThread.id, thread);
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
    }

    unresolveThread(thread: vscode.CommentThread): void {
        const data = (thread as any).__threadData as ThreadData | undefined;
        if (!data) { return; }

        this.storageService.unresolveThread(data.threadId);
        thread.state = vscode.CommentThreadState.Unresolved;
        thread.label = undefined;
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
