import * as vscode from 'vscode';
import * as cp from 'child_process';
import { FileChange, FileChangeStatus, GitApi, GitRepository } from '../types';

export class GitService {
    private repo: GitRepository | undefined;
    private workspaceRoot: string;

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
                resolve(true);
            });
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
            const output = await this.execGit('branch -r --format=%(refname:short)');
            const remoteNames = output.trim().split('\n').filter(n => n.trim());
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

    async getChangedFiles(source: string, target: string): Promise<FileChange[]> {
        const output = await this.execGit(`diff --name-status ${source}...${target}`);
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
