import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { LocalPr, LocalPrRegistry } from '../types';
import { GitService } from '../git/gitService';

export class LocalPrManager {
    private registry: LocalPrRegistry = { version: 1, reviews: [] };
    private registryPath: string;
    private reviewsDir: string;

    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    constructor(
        private gitService: GitService,
        workspaceRoot: string
    ) {
        this.reviewsDir = path.join(workspaceRoot, '.vscode', 'local-reviews');
        this.registryPath = path.join(this.reviewsDir, 'registry.json');
        this.loadRegistry();
    }

    private loadRegistry(): void {
        try {
            if (fs.existsSync(this.registryPath)) {
                const data = fs.readFileSync(this.registryPath, 'utf-8');
                this.registry = JSON.parse(data);
            }
        } catch {
            this.registry = { version: 1, reviews: [] };
        }
    }

    private saveRegistry(): void {
        if (!fs.existsSync(this.reviewsDir)) {
            fs.mkdirSync(this.reviewsDir, { recursive: true });
        }
        fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8');
        this._onDidChange.fire();
    }

    async createReview(sourceBranch: string, targetBranch: string): Promise<LocalPr> {
        // Check if review already exists for this branch pair
        const existing = this.registry.reviews.find(
            r => r.sourceBranch === sourceBranch && r.targetBranch === targetBranch
        );
        if (existing) {
            this.setActiveReview(existing.id);
            return existing;
        }

        const sourceCommit = await this.gitService.getCommitHash(sourceBranch);
        const targetCommit = await this.gitService.getCommitHash(targetBranch);

        const review: LocalPr = {
            id: crypto.randomUUID(),
            sourceBranch,
            targetBranch,
            sourceCommit: sourceCommit.trim(),
            targetCommit: targetCommit.trim(),
            createdAt: new Date().toISOString(),
        };

        this.registry.reviews.push(review);
        this.registry.activeReviewId = review.id;
        this.saveRegistry();

        return review;
    }

    deleteReview(id: string): void {
        const review = this.registry.reviews.find(r => r.id === id);
        if (!review) { return; }

        // Remove comments directory
        const commentsDir = this.getReviewDir(review);
        if (fs.existsSync(commentsDir)) {
            fs.rmSync(commentsDir, { recursive: true });
        }

        this.registry.reviews = this.registry.reviews.filter(r => r.id !== id);
        if (this.registry.activeReviewId === id) {
            this.registry.activeReviewId = undefined;
        }
        this.saveRegistry();
    }

    setActiveReview(id: string): void {
        this.registry.activeReviewId = id;
        this.saveRegistry();
    }

    getActiveReview(): LocalPr | undefined {
        if (!this.registry.activeReviewId) { return undefined; }
        return this.registry.reviews.find(r => r.id === this.registry.activeReviewId);
    }

    listReviews(): LocalPr[] {
        return this.registry.reviews;
    }

    findReviewByBranch(branch: string): LocalPr | undefined {
        return this.registry.reviews.find(
            r => r.targetBranch === branch || r.sourceBranch === branch
        );
    }

    getReviewDir(review: LocalPr): string {
        const dirName = `${review.sourceBranch}_${review.targetBranch}`.replace(/\//g, '-');
        return path.join(this.reviewsDir, dirName);
    }

    getCommentsFilePath(review: LocalPr): string {
        return path.join(this.getReviewDir(review), 'comments.json');
    }

    getReviewedFiles(): string[] {
        const review = this.getActiveReview();
        return review?.reviewedFiles || [];
    }

    setReviewedFiles(files: string[]): void {
        const review = this.getActiveReview();
        if (review) {
            review.reviewedFiles = files;
            this.saveRegistry();
        }
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}
