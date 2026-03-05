# Local PR Review - Agent Specification

**Status:** Validated

## Requirements

### Functional
- Extension activates when a workspace with a git repository is opened
- Sidebar with 4 sections: Branch Selector, Changed Files, Local PRs, Local Comments
- **Branch Selector:** Source dropdown (default `devel`), destination searchable picker (empty by default), "Create Review" button
- **Changed Files:** Shows files for the active Local PR. Clicking a file opens `vscode.diff`
- **Local PRs:** List of saved review sessions (branch pairs). Click to activate (auto-fills branch selector, shows changed files). Trash icon to delete (removes PR and its comments JSON)
- **Local Comments:** Lists JSON comment files grouped by Local PR. Click to open the raw JSON file
- Inline commenting on diff files using VS Code's Comment API (`vscode.comments`)
- Each comment thread has resolve/unresolve state (`CommentThreadState.Resolved` / `Unresolved`)
- JSON-backed persistence: `.vscode/local-reviews/{source}_{target}/comments.json`

### Non-Functional
- Zero network calls -- fully offline
- Instant comment load (local file read)
- Extension bundle size under 500KB

## Constraints

- Must use VS Code's built-in Git extension API (`vscode.git`) for branch listing and diff
- Must use VS Code Comment API for inline comments (not custom webview)
- Must use VS Code TreeView API for file change list (not custom webview)
- TypeScript, compiled with esbuild or webpack
- Target VS Code engine `^1.85.0`

## Approach

Build a clean VS Code extension with six modules:
1. **Git Service** -- wraps the built-in Git extension API for branch/diff operations
2. **Branch Selector View** -- webview or tree view with source/target dropdowns and Create Review button
3. **Changed Files Provider** -- displays changed files for the active Local PR
4. **Local PRs Provider** -- lists saved review sessions, handles activate/delete
5. **Comment Controller** -- manages inline comments using VS Code Comment API
6. **Storage Service** -- reads/writes comment JSON files, manages Local PR registry

No webviews needed for file lists -- use native VS Code TreeView APIs. Branch selector uses QuickPick commands triggered from the tree view title bar.

## Design

### Architecture

```
Extension Entry (extension.ts)
    |
    +-- GitService (git/gitService.ts)
    |     - getBranches(): string[]
    |     - getChangedFiles(source, target): FileChange[]
    |     - getFileAtRef(ref, path): string
    |
    +-- LocalPrManager (services/localPrManager.ts)
    |     - createReview(source, target): LocalPr
    |     - deleteReview(id): void
    |     - getActiveReview(): LocalPr | undefined
    |     - setActiveReview(id): void
    |     - listReviews(): LocalPr[]
    |     - persists to .vscode/local-reviews/registry.json
    |
    +-- ChangedFilesProvider (views/changedFilesProvider.ts)
    |     - implements TreeDataProvider<FileChangeItem>
    |     - shows files for the active Local PR
    |     - click handler opens vscode.diff
    |
    +-- LocalPrsProvider (views/localPrsProvider.ts)
    |     - implements TreeDataProvider<LocalPrItem>
    |     - lists all saved Local PRs
    |     - click to activate, trash icon to delete
    |
    +-- LocalCommentsProvider (views/localCommentsProvider.ts)
    |     - implements TreeDataProvider<CommentFileItem>
    |     - lists JSON comment files grouped by Local PR
    |     - click opens the raw JSON file
    |
    +-- ReviewCommentController (comments/commentController.ts)
    |     - creates CommentController via vscode.comments API
    |     - manages CommentThreads per file
    |     - handles add/edit/delete/resolve/unresolve
    |
    +-- StorageService (storage/storageService.ts)
          - save/load comments as JSON
          - path: .vscode/local-reviews/{source}_{target}/comments.json
```

### Key Components

| Component | Responsibility | Location |
|-----------|---------------|----------|
| Extension entry | Activation, wiring | `src/extension.ts` |
| GitService | Branch listing, diff, file-at-ref | `src/git/gitService.ts` |
| LocalPrManager | Create/delete/activate Local PRs, registry | `src/services/localPrManager.ts` |
| ChangedFilesProvider | TreeDataProvider for changed files section | `src/views/changedFilesProvider.ts` |
| LocalPrsProvider | TreeDataProvider for Local PRs list | `src/views/localPrsProvider.ts` |
| LocalCommentsProvider | TreeDataProvider for comment JSON files | `src/views/localCommentsProvider.ts` |
| ReviewCommentController | Comment API integration | `src/comments/commentController.ts` |
| StorageService | JSON read/write for comments | `src/storage/storageService.ts` |
| Types | Shared interfaces | `src/types.ts` |

### Data Flow

#### Branch Selection -> Create Review
```
User triggers "Select Source Branch" command -> QuickPick shows local branches (default: devel)
User triggers "Select Destination Branch" command -> QuickPick with search shows local branches
User clicks "Create Review" button
  -> LocalPrManager.createReview(source, target)
  -> Saves to .vscode/local-reviews/registry.json
  -> Sets as active review
  -> GitService.getChangedFiles(source, target) runs `git diff --name-status source...target`
  -> ChangedFilesProvider.refresh(files)
  -> LocalPrsProvider.refresh()
  -> LocalCommentsProvider.refresh()
```

#### Clicking a Local PR
```
User clicks a Local PR in the list
  -> LocalPrManager.setActiveReview(id)
  -> Branch selector auto-fills source/destination
  -> GitService.getChangedFiles(source, target)
  -> ChangedFilesProvider.refresh(files)
  -> Comments for this PR loaded from JSON
```

#### Deleting a Local PR
```
User clicks trash icon on a Local PR
  -> Confirmation dialog
  -> LocalPrManager.deleteReview(id)
  -> Removes .vscode/local-reviews/{source}_{target}/ directory
  -> LocalPrsProvider.refresh()
  -> LocalCommentsProvider.refresh()
  -> If was active, clear Changed Files
```

#### Opening a Diff
```
User clicks file in tree view
  -> GitService.getFileAtRef(source, filePath) -> creates git: URI
  -> GitService.getFileAtRef(target, filePath) -> creates git: URI
  -> vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title)
```

#### Adding a Comment
```
User selects text in diff editor -> "Add Comment" appears (comment controller)
  -> User types comment -> Submit
  -> CommentThread created with Comment { body, author, timestamp }
  -> StorageService.save() writes to JSON
  -> Comments panel refreshes
```

#### Resolve/Unresolve
```
User clicks resolve on CommentThread
  -> thread.state = CommentThreadState.Resolved
  -> StorageService.save() updates JSON
  -> Thread visually collapses
```

### Data Schema

**comments.json**
```json
{
  "version": 1,
  "sourceBranch": "devel",
  "targetBranch": "feature/my-feature",
  "sourceCommit": "abc1234",
  "targetCommit": "def5678",
  "threads": [
    {
      "id": "thread-uuid-1",
      "filePath": "src/app.ts",
      "startLine": 10,
      "endLine": 12,
      "state": "unresolved",
      "comments": [
        {
          "id": "comment-uuid-1",
          "body": "This should handle null cases",
          "author": "guru",
          "timestamp": "2026-03-05T10:30:00Z"
        }
      ]
    }
  ]
}
```

### VS Code API Usage

**Comment Controller Setup:**
```typescript
const controller = vscode.comments.createCommentController(
  'localPrReview',
  'Local PR Review'
);
controller.commentingRangeProvider = {
  provideCommentingRanges(document) {
    // Allow commenting on any line in diff documents
    return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
  }
};
```

**Tree View Registration (package.json contribution):**
```json
{
  "viewsContainers": {
    "activitybar": [{
      "id": "localPrReview",
      "title": "Local PR Review",
      "icon": "resources/icon.svg"
    }]
  },
  "views": {
    "localPrReview": [
      {
        "id": "localPrReview.branchSelector",
        "name": "Branch Selector",
        "type": "tree"
      },
      {
        "id": "localPrReview.changedFiles",
        "name": "Changed Files"
      },
      {
        "id": "localPrReview.localPrs",
        "name": "Local PRs"
      },
      {
        "id": "localPrReview.localComments",
        "name": "Local Comments"
      }
    ]
  }
}
```

**Git Extension Access:**
```typescript
const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
if (!gitExtension?.isActive) {
  await gitExtension?.activate();
}
const api = gitExtension.exports.getAPI(1);
const repo = api.repositories[0];
const branches = await repo.getBranches({ remote: false });
```

### Package.json Key Contributions

```json
{
  "activationEvents": ["workspaceContains:.git"],
  "contributes": {
    "commands": [
      { "command": "localPrReview.selectSource", "title": "Select Source Branch", "icon": "$(git-branch)" },
      { "command": "localPrReview.selectDestination", "title": "Select Destination Branch", "icon": "$(search)" },
      { "command": "localPrReview.createReview", "title": "Create Review", "icon": "$(add)" },
      { "command": "localPrReview.deleteReview", "title": "Delete Review", "icon": "$(trash)" },
      { "command": "localPrReview.refreshFiles", "title": "Refresh Changed Files", "icon": "$(refresh)" }
    ],
    "menus": {
      "view/title": [
        { "command": "localPrReview.selectSource", "when": "view == localPrReview.branchSelector", "group": "navigation" },
        { "command": "localPrReview.selectDestination", "when": "view == localPrReview.branchSelector", "group": "navigation" },
        { "command": "localPrReview.createReview", "when": "view == localPrReview.branchSelector", "group": "navigation" },
        { "command": "localPrReview.refreshFiles", "when": "view == localPrReview.changedFiles", "group": "navigation" }
      ],
      "view/item/context": [
        { "command": "localPrReview.deleteReview", "when": "view == localPrReview.localPrs", "group": "inline" }
      ],
      "comments/commentThread/context": [
        { "command": "localPrReview.resolveThread", "group": "inline" },
        { "command": "localPrReview.unresolveThread", "group": "inline" }
      ],
      "comments/comment/context": [
        { "command": "localPrReview.editComment", "group": "inline" },
        { "command": "localPrReview.deleteComment", "group": "inline" }
      ]
    }
  }
}
```

### File Structure

```
src/
  extension.ts                # Entry point: activate/deactivate
  types.ts                    # Shared interfaces (FileChange, LocalPr, ReviewComment, etc.)
  git/
    gitService.ts             # Git operations via built-in extension API
  services/
    localPrManager.ts         # Create/delete/activate Local PRs, registry persistence
  views/
    branchSelectorProvider.ts # TreeDataProvider for branch selector section
    changedFilesProvider.ts   # TreeDataProvider for changed files
    localPrsProvider.ts       # TreeDataProvider for Local PRs list
    localCommentsProvider.ts  # TreeDataProvider for comment JSON files
  comments/
    commentController.ts      # VS Code Comment API controller
  storage/
    storageService.ts         # JSON file read/write for comments
resources/
  icon.svg                    # Sidebar icon
package.json                  # Extension manifest
tsconfig.json
esbuild.config.js             # Bundle config
```

## File References

These are reference materials for implementation:
- VS Code Comment API: https://code.visualstudio.com/api/extension-guides/comment-api
- VS Code TreeView API: https://code.visualstudio.com/api/extension-guides/tree-view
- VS Code Git Extension API: the `vscode.git` built-in extension exports
- GitHub PR extension (reference only): https://github.com/Microsoft/vscode-pull-request-github

## Success Criteria

- [ ] Extension activates in a git workspace without errors
- [ ] Branch selector shows all local branches, defaults source to `devel`
- [ ] Changed files tree view populates correctly after branch selection
- [ ] Clicking a file opens the correct diff in VS Code's diff editor
- [ ] Can add inline comments on any line in the diff
- [ ] Can resolve/unresolve comment threads
- [ ] Comments persist to `.vscode/local-reviews/{source}_{target}/comments.json`
- [ ] Comments reload correctly after VS Code restart
- [ ] All comments visible in the Comments panel tree view
- [ ] Zero network calls during all operations
