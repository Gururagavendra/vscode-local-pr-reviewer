import * as vscode from 'vscode';
import { GitService } from './git/gitService';
import { GitFileContentProvider } from './git/gitFileContentProvider';
import { LocalPrManager } from './services/localPrManager';
import { StorageService } from './storage/storageService';
import { BranchSelectorWebviewProvider } from './views/branchSelectorWebviewProvider';
import { ChangedFilesProvider, FileChangeItem } from './views/changedFilesProvider';
import { LocalPrsProvider, LocalPrItem } from './views/localPrsProvider';
import { LocalCommentsProvider, CommentFileItem } from './views/localCommentsProvider';
import { ReviewCommentController } from './comments/commentController';
import { LocalReviewTool } from './tools/localReviewTool';

export async function activate(context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showInformationMessage('Local PR Review: Open a Git repository folder to use this extension.');
        return;
    }

    // Initialize git service
    const gitService = new GitService(context);

    // Initialize services (will work once git is ready)
    const localPrManager = new LocalPrManager(gitService, workspaceRoot);
    const storageService = new StorageService(localPrManager);

    // Register custom URI scheme for git file content
    const gitFileContentProvider = new GitFileContentProvider(gitService);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('git-local-review', gitFileContentProvider)
    );

    // Initialize view providers
    const branchSelectorProvider = new BranchSelectorWebviewProvider(
        context.extensionUri, gitService, localPrManager
    );
    const changedFilesProvider = new ChangedFilesProvider(gitService, storageService, localPrManager);
    const localPrsProvider = new LocalPrsProvider(localPrManager);
    const localCommentsProvider = new LocalCommentsProvider(storageService);

    // Initialize comment controller
    const commentController = new ReviewCommentController(storageService);

    // Register Copilot Language Model Tool
    const localReviewTool = new LocalReviewTool(gitService, localPrManager, storageService);
    context.subscriptions.push(
        vscode.lm.registerTool('localPrReview_getComments', localReviewTool)
    );

    // Register views
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            BranchSelectorWebviewProvider.viewType,
            branchSelectorProvider
        ),
    );

    // Changed files tree view with checkbox support
    const changedFilesTreeView = vscode.window.createTreeView('localPrReview.changedFiles', {
        treeDataProvider: changedFilesProvider,
        manageCheckboxStateManually: true,
    });
    changedFilesTreeView.onDidChangeCheckboxState(e => {
        for (const [item, state] of e.items) {
            if (item instanceof FileChangeItem) {
                changedFilesProvider.setFileReviewed(
                    item.fileChange.filePath,
                    state === vscode.TreeItemCheckboxState.Checked
                );
            }
        }
    });

    context.subscriptions.push(
        changedFilesTreeView,
        vscode.window.createTreeView('localPrReview.localPrs', {
            treeDataProvider: localPrsProvider,
        }),
        vscode.window.createTreeView('localPrReview.localComments', {
            treeDataProvider: localCommentsProvider,
        })
    );

    // Initialize git asynchronously (after tree views are registered)
    const initialized = await gitService.initialize();
    if (!initialized) {
        vscode.window.showInformationMessage('Local PR Review: No git repository found. Open a folder with a git repo.');
    }

    // Load active review on startup
    if (initialized) {
        const activeReview = localPrManager.getActiveReview();
        if (activeReview) {
            await changedFilesProvider.refresh(activeReview.sourceBranch, activeReview.targetBranch);
        }
    }

    // Helper: auto-create review and refresh files when both branches are selected
    const autoRefreshFiles = async (base: string, compare: string) => {
        if (base && compare && base !== compare) {
            await localPrManager.createReview(base, compare);
            await changedFilesProvider.refresh(base, compare);
            localCommentsProvider.refresh();
            commentController.loadAllThreads();
        }
    };

    // Listen for branch selection from webview
    context.subscriptions.push(
        branchSelectorProvider.onDidSelectBranches(async ({ base, compare }) => {
            await autoRefreshFiles(base, compare);
        })
    );

    // --- Register commands ---

    // Create review
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.createReview', async () => {
            const source = branchSelectorProvider.getSourceBranch();
            const target = branchSelectorProvider.getTargetBranch();

            if (!source) {
                vscode.window.showWarningMessage('Please select a base branch first');
                return;
            }
            if (!target) {
                vscode.window.showWarningMessage('Please select a compare branch first');
                return;
            }
            if (source === target) {
                vscode.window.showWarningMessage('Base and compare branches must be different');
                return;
            }

            const review = await localPrManager.createReview(source, target);
            await changedFilesProvider.refresh(source, target);
            localCommentsProvider.refresh();
            vscode.window.showInformationMessage(`Review created: ${target} -> ${source}`);
        })
    );

    // Activate review (click on Local PR)
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.activateReview', async (item: LocalPrItem) => {
            localPrManager.setActiveReview(item.review.id);
            branchSelectorProvider.refresh();
            await changedFilesProvider.refresh(item.review.sourceBranch, item.review.targetBranch);
            localCommentsProvider.refresh();
            commentController.loadAllThreads();
        })
    );

    // Delete review
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.deleteReview', async (item: LocalPrItem) => {
            const answer = await vscode.window.showWarningMessage(
                `Delete review "${item.review.targetBranch} -> ${item.review.sourceBranch}"? This will also delete all comments.`,
                { modal: true },
                'Delete'
            );
            if (answer === 'Delete') {
                localPrManager.deleteReview(item.review.id);
                changedFilesProvider.clear();
                localCommentsProvider.refresh();
                branchSelectorProvider.refresh();
                commentController.loadAllThreads();
            }
        })
    );

    // Refresh changed files
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.refreshFiles', async () => {
            const active = localPrManager.getActiveReview();
            if (active) {
                await changedFilesProvider.refresh(active.sourceBranch, active.targetBranch);
            }
        })
    );

    // Open file (working copy)
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.openFile', async (item: FileChangeItem) => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (workspaceRoot) {
                const fileUri = vscode.Uri.joinPath(workspaceRoot, item.fileChange.filePath);
                await vscode.window.showTextDocument(fileUri);
            }
        })
    );

    // Open diff
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.openDiff', async (item: FileChangeItem) => {
            const leftUri = vscode.Uri.parse(
                `git-local-review://authority/${item.fileChange.filePath}?ref=${encodeURIComponent(item.sourceBranch)}`
            );
            const rightUri = vscode.Uri.parse(
                `git-local-review://authority/${item.fileChange.filePath}?ref=${encodeURIComponent(item.targetBranch)}`
            );

            const title = `${item.fileChange.filePath} (${item.sourceBranch} <-> ${item.targetBranch})`;

            await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

            // Load comments for this file
            commentController.loadThreadsForFile(rightUri, item.fileChange.filePath);
        })
    );

    // Comment commands
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.addComment', (reply: vscode.CommentReply) => {
            try {
                const thread = reply.thread;
                const filePath = extractFilePath(thread.uri);

                if (thread.comments.length === 0) {
                    commentController.createThread(
                        thread.uri,
                        thread.range!,
                        reply.text,
                        filePath
                    );
                    thread.dispose();
                } else {
                    commentController.addReply(thread, reply.text);
                }
                localCommentsProvider.refresh();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to add comment: ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.saveComment', (reply: vscode.CommentReply) => {
            try {
                const thread = reply.thread;
                const filePath = extractFilePath(thread.uri);

                if (thread.comments.length === 0) {
                    commentController.createThread(
                        thread.uri,
                        thread.range!,
                        reply.text,
                        filePath
                    );
                    thread.dispose();
                } else {
                    commentController.addReply(thread, reply.text);
                }
                localCommentsProvider.refresh();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to save comment: ${err.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.cancelComment', (reply: vscode.CommentReply) => {
            if (reply.thread.comments.length === 0) {
                reply.thread.dispose();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.resolveThread', (thread: vscode.CommentThread) => {
            if (thread.state === vscode.CommentThreadState.Unresolved) {
                commentController.resolveThread(thread);
            } else {
                commentController.unresolveThread(thread);
            }
            localCommentsProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.unresolveThread', (thread: vscode.CommentThread) => {
            commentController.unresolveThread(thread);
            localCommentsProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.editComment', (comment: vscode.Comment) => {
            // Toggle to editing mode
            (comment as any).mode = vscode.CommentMode.Editing;
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.deleteComment', (comment: vscode.Comment & { thread?: vscode.CommentThread }) => {
            // For comments/comment/title, VS Code may pass comment with parent reference
            // We need to find the thread from our controller
            const thread = comment.thread || commentController.findThreadForComment(comment);
            if (!thread) { return; }

            vscode.window.showWarningMessage('Delete this comment?', 'Delete', 'Cancel')
                .then(answer => {
                    if (answer === 'Delete') {
                        commentController.deleteComment(thread, comment);
                        localCommentsProvider.refresh();
                    }
                });
        })
    );

    // Refresh commands for Local PRs and Local Comments
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.refreshPrs', () => {
            localPrsProvider.refresh();
        }),
        vscode.commands.registerCommand('localPrReview.refreshComments', () => {
            localCommentsProvider.refresh();
        })
    );

    // Delete comments file
    context.subscriptions.push(
        vscode.commands.registerCommand('localPrReview.deleteCommentsFile', async (item: CommentFileItem) => {
            const answer = await vscode.window.showWarningMessage(
                'Delete all comments for this review?',
                { modal: true },
                'Delete'
            );
            if (answer === 'Delete') {
                const fs = await import('fs');
                const path = await import('path');
                if (fs.existsSync(item.filePath)) {
                    fs.unlinkSync(item.filePath);
                    const dir = path.dirname(item.filePath);
                    const remaining = fs.readdirSync(dir);
                    if (remaining.length === 0) {
                        fs.rmdirSync(dir);
                    }
                }
                localCommentsProvider.refresh();
                commentController.loadAllThreads();
            }
        })
    );

    // Disposables
    context.subscriptions.push(
        branchSelectorProvider,
        changedFilesProvider,
        localPrsProvider,
        localCommentsProvider,
        commentController,
        gitFileContentProvider,
        { dispose: () => localPrManager.dispose() }
    );
}

function extractFilePath(uri: vscode.Uri): string {
    const path = uri.path;
    return path.startsWith('/') ? path.slice(1) : path;
}

export function deactivate() {}
