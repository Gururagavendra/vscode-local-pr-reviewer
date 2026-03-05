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
                    JSON.stringify({ error: 'No local review found for the current branch. Create a review first using the Local PR Review sidebar.' })
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
                    JSON.stringify({
                        review: {
                            baseBranch: review.sourceBranch,
                            compareBranch: review.targetBranch,
                        },
                        message: 'No comments found for this review.',
                        threads: [],
                    })
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
