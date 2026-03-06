import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { LocalPrManager } from '../services/localPrManager';
import { StorageService } from '../storage/storageService';

interface ToolInput {
    filePath?: string;
    state?: 'resolved' | 'unresolved';
}

export class LocalReviewTool implements vscode.LanguageModelTool<ToolInput> {
    constructor(
        private gitService: GitService,
        private localPrManager: LocalPrManager,
        private storageService: StorageService,
    ) {}

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ToolInput>,
        _token: vscode.CancellationToken,
    ) {
        const confirmationMessages = {
            title: 'Get Local Review Comments',
            message: new vscode.MarkdownString(
                `Retrieve local review comments${
                    options.input.filePath ? ` for **${options.input.filePath}**` : ''
                }${options.input.state ? ` (${options.input.state} only)` : ''}?`
            ),
        };
        return { invocationMessage: 'Checking local review comments...', confirmationMessages };
    }

    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<ToolInput>,
        _token: vscode.CancellationToken,
    ): Promise<vscode.LanguageModelToolResult> {
        const { filePath, state } = options.input;

        // Auto-detect review from current git branch
        const review = await this.resolveReview();
        if (!review) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    'No local review exists for the current git branch. '
                    + 'Tell the user: "No local review found. Open the **Local PR Review** sidebar (activity bar icon), '
                    + 'select a base and compare branch, then click Create Review. '
                    + 'After that, you can add comments in diff views and ask me to check them." '
                    + 'Do NOT search the filesystem or run any commands — local review data is only accessible through this tool.'
                ),
            ]);
        }

        // Temporarily set as active to read comments
        const previousActive = this.localPrManager.getActiveReview();
        this.localPrManager.setActiveReview(review.id);

        const comments = this.storageService.loadComments();

        // Restore previous active if different
        if (previousActive && previousActive.id !== review.id) {
            this.localPrManager.setActiveReview(previousActive.id);
        }

        if (!comments || comments.threads.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Review found: ${review.targetBranch} -> ${review.sourceBranch}. `
                    + 'However, there are no comments yet. '
                    + 'Tell the user: "Your review has no comments yet. Open a file from the Changed Files list '
                    + 'in the Local PR Review sidebar, then click the + icon in the diff gutter to add a comment." '
                    + 'Do NOT search the filesystem or run any commands.'
                ),
            ]);
        }

        let threads = comments.threads;

        // Filter by file path if specified
        if (filePath) {
            threads = threads.filter(t => t.filePath.includes(filePath));
        }

        // Filter by state if specified
        if (state) {
            threads = threads.filter(t => t.state === state);
        }

        const result = {
            review: {
                baseBranch: review.sourceBranch,
                compareBranch: review.targetBranch,
            },
            totalThreads: comments.threads.length,
            unresolvedCount: comments.threads.filter(t => t.state === 'unresolved').length,
            resolvedCount: comments.threads.filter(t => t.state === 'resolved').length,
            threads: threads.map(t => ({
                id: t.id,
                filePath: t.filePath,
                startLine: t.startLine,
                endLine: t.endLine,
                state: t.state,
                comments: t.comments.map(c => ({
                    author: c.author,
                    body: c.body,
                    timestamp: c.timestamp,
                })),
            })),
        };

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
        ]);
    }

    private async resolveReview() {
        // Try auto-detect from current git branch
        const currentBranch = await this.gitService.getCurrentBranch();
        if (currentBranch) {
            const review = this.localPrManager.findReviewByBranch(currentBranch);
            if (review) { return review; }
        }

        // Fall back to active review
        return this.localPrManager.getActiveReview();
    }
}
