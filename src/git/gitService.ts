import * as vscode from 'vscode';
import * as cp from 'child_process';
import { FileChange, FileChangeStatus, GitApi, GitRepository, CommitInfo } from '../types';

export class GitService {
    private repo: GitRepository | undefined;
    private workspaceRoot: string;

    private _onDidChangeBranch = new vscode.EventEmitter<string>();
    readonly onDidChangeBranch = this._onDidChangeBranch.event;
    private _onDidChangeHead = new vscode.EventEmitter<void>();
    readonly onDidChangeHead = this._onDidChangeHead.event;
    private _lastBranch: string | undefined;
    private _lastCommit: string | undefined;

    constructor(private context: vscode.ExtensionContext) {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    }

    async initialize(): Promise<boolean> {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (!gitExtension) {
            vscode.window.showErrorMessage('Git extension not found');
            return false;
        }

        if (!gitExtension.isActive) {
            await gitExtension.activate();
        }

        const api = gitExtension.exports.getAPI(1);

        // If repos are already available, use them
        if (api.repositories.length > 0) {
            this.repo = api.repositories[0];
            this._trackBranchChanges();
            return true;
        }

        // Wait for git extension to discover repositories (up to 10 seconds)
        return new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
                disposable.dispose();
                resolve(false);
            }, 10000);

            const disposable = api.onDidOpenRepository((repo: GitRepository) => {
                clearTimeout(timeout);
                disposable.dispose();
                this.repo = repo;
                this._trackBranchChanges();
                resolve(true);
            });
        });
    }

    private _trackBranchChanges(): void {
        if (!this.repo) { return; }
        this._lastBranch = this.repo.state.HEAD?.name;
        this._lastCommit = this.repo.state.HEAD?.commit;
        this.repo.state.onDidChange(() => {
            const current = this.repo?.state.HEAD?.name;
            const currentCommit = this.repo?.state.HEAD?.commit;
            if (current && current !== this._lastBranch) {
                this._lastBranch = current;
                this._lastCommit = currentCommit;
                this._onDidChangeBranch.fire(current);
            } else if (currentCommit && currentCommit !== this._lastCommit) {
                this._lastCommit = currentCommit;
                this._onDidChangeHead.fire();
            }
        });
    }

    async getBranches(includeRemote: boolean = false): Promise<string[]> {
        if (!this.repo) {
            return [];
        }

        const localBranches = await this.repo.getBranches({ remote: false });
        const localNames = localBranches
            .map(b => b.name)
            .filter((name): name is string => !!name);

        if (!includeRemote) {
            return localNames;
        }

        // Also include remote tracking branches (origin/*)
        try {
            const remoteBranches = await this.repo.getBranches({ remote: true });
            const remoteNames = remoteBranches
                .map(b => b.name)
                .filter((name): name is string => !!name);
            return [...localNames, ...remoteNames];
        } catch {
            return localNames;
        }
    }

    async getCurrentBranch(): Promise<string | undefined> {
        return this.repo?.state.HEAD?.name;
    }

    async getCommitHash(branch: string): Promise<string> {
        return this.execGit(`rev-parse ${branch}`);
    }

    async isCurrentBranch(branch: string): Promise<boolean> {
        const current = await this.getCurrentBranch();
        return current === branch;
    }

    async getChangedFiles(source: string, target: string): Promise<FileChange[]> {
        // If target is the current branch, compare against working tree (includes uncommitted changes)
        const isWorkingTree = await this.isCurrentBranch(target);
        const diffCmd = isWorkingTree
            ? `diff --name-status ${source}`
            : `diff --name-status ${source}...${target}`;
        const output = await this.execGit(diffCmd);
        if (!output.trim()) {
            return [];
        }

        return output.trim().split('\n').map(line => {
            const parts = line.split('\t');
            const statusChar = parts[0].charAt(0);
            const filePath = parts[1];
            const oldFilePath = parts.length > 2 ? parts[1] : undefined;
            const actualPath = parts.length > 2 ? parts[2] : parts[1];

            let status: FileChangeStatus;
            switch (statusChar) {
                case 'A': status = 'added'; break;
                case 'D': status = 'deleted'; break;
                case 'R': status = 'renamed'; break;
                default: status = 'modified'; break;
            }

            return {
                status,
                filePath: actualPath,
                oldFilePath: status === 'renamed' ? oldFilePath : undefined,
            };
        });
    }

    getFileUri(ref: string, filePath: string): vscode.Uri {
        // Use git show to create a URI for the file at a specific ref
        return vscode.Uri.parse(
            `git-local-review://authority/${filePath}?ref=${encodeURIComponent(ref)}`
        );
    }

    async getFileContent(ref: string, filePath: string): Promise<string> {
        try {
            return await this.execGit(`show ${ref}:${filePath}`);
        } catch {
            return '';
        }
    }

    async getCommitsBetween(source: string, target: string): Promise<CommitInfo[]> {
        const SEP = '---SEP---';
        const format = `%H${SEP}%h${SEP}%s${SEP}%an${SEP}%aI${SEP}%ar`;
        try {
            const output = await this.execGit(`log --format="${format}" ${source}..${target}`);
            if (!output.trim()) {
                return [];
            }
            return output.trim().split('\n').map(line => {
                const [hash, shortHash, message, author, date, relativeDate] = line.split(SEP);
                return { hash, shortHash, message, author, date, relativeDate };
            });
        } catch {
            return [];
        }
    }

    private execGit(args: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(
                `git ${args}`,
                { cwd: this.workspaceRoot, maxBuffer: 10 * 1024 * 1024 },
                (error, stdout, stderr) => {
                    if (error) {
                        reject(new Error(stderr || error.message));
                    } else {
                        resolve(stdout);
                    }
                }
            );
        });
    }
}
