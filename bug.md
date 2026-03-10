# Bug Report — `vscode-local-pr-reviewer`

> Generated: 10 March 2026  
> Verified: 10 March 2026 (all bugs confirmed against actual source code)  
> Total bugs: 31 confirmed · 0 false positives  
> Classified: High (3) · Medium (10) · Low (18)

---

## 🔴 HIGH PRIORITY

---

### BUG-GS-01 — Command Injection via Shell String Concatenation
**File:** `src/git/gitService.ts`  
**Category:** Security  

`execGit` uses `cp.exec` (which spawns a shell) with all parameters directly concatenated into a command string. Branch names and file paths are never sanitised.

```typescript
private execGit(args: string): Promise<string> {
    return new Promise((resolve, reject) => {
        cp.exec(
            `git ${args}`,   // ← shell-expanded; user-controlled input
            { cwd: this.workspaceRoot, maxBuffer: 10 * 1024 * 1024 },
```

Affected callers:
- `getCommitHash(branch)` → `rev-parse ${branch}`
- `getChangedFiles(source, target)` → `diff --name-status ${source}...${target}`
- `getFileContent(ref, filePath)` → `show ${ref}:${filePath}`
- `getCommitsBetween(source, target)` → `log --format="..." ${source}..${target}`

A branch named `main; rm -rf ~` or a file path containing spaces/shell metacharacters produces incorrect or dangerous shell commands.

**Fix:** Replace `cp.exec` with `cp.execFile('git', argsArray)` so the OS never invokes a shell.

---

### BUG-WV-01 — XSS via Unescaped Branch Names Injected into `innerHTML`
**File:** `src/views/branchSelectorWebviewProvider.ts`  
**Category:** Security (XSS)  

Git branch names are injected into `innerHTML` without HTML-encoding inside the webview's inline `<script>`:

```javascript
dropdown.innerHTML = items.map((b, i) => {
    const cls = b === selectedValue ? 'dropdown-item selected' : 'dropdown-item';
    const tag = isRemote ? '<span class="remote-tag">remote</span>' : '';
    return '<div class="' + cls + '" data-branch="' + b + '" data-index="' + i + '">' + b + tag + '</div>';
}).join('');
```

Git's ref-format rules do **not** forbid `<`, `>`, or `&`. A branch named `<img src=x onerror='vscode.postMessage(...)'>` or `" onmouseenter="..."` will execute arbitrary JavaScript in the webview context.

**Fix:** Replace `innerHTML` string concatenation with `document.createElement` + `element.textContent`, or apply an HTML-escaping function before insertion.

---

### BUG-WV-02 — Missing Content-Security-Policy in Webview HTML
**File:** `src/views/branchSelectorWebviewProvider.ts`  
**Category:** Security  

The `_getHtml()` method does **not** include a `<meta http-equiv="Content-Security-Policy">` tag. All inline scripts run without a nonce restriction. Compare with `suggestChangePanel.ts` which does use a CSP. This widens the XSS attack surface significantly.

**Fix:** Add a CSP header with `script-src 'nonce-${nonce}'` and generate a cryptographically secure nonce (see also BUG-SC-01).

---

## 🟠 MEDIUM PRIORITY

---

### BUG-CC-01 — `comment.timestamp` Is Optional; Undefined Breaks `deleteComment`
**File:** `src/comments/commentController.ts`  
**Category:** Null Dereference / Logic Error  

```typescript
const commentTimestamp = comment.timestamp?.getTime();   // can be undefined
const storedComment = storedThread.comments.find(c =>
    new Date(c.timestamp).getTime() === commentTimestamp  // undefined === number → never matches
    && c.author === comment.author.name
);
```

`vscode.Comment.timestamp` is `Date | undefined`. If it is `undefined`, `commentTimestamp` is `undefined`, the `.find()` condition is always `false`, `storedComment` is `undefined`, and the delete silently does nothing. The comment appears deleted in the UI but persists in storage after every reload.

**Fix:** Require a timestamp when creating comments, or use a stable unique comment ID for matching.

---

### BUG-CC-02 — `__threadData` Stored on `any`-Cast `CommentThread`
**File:** `src/comments/commentController.ts`  
**Category:** Type Safety  

```typescript
(thread as any).__threadData = {
    threadId: savedThread.id,
    filePath: savedThread.filePath,
} satisfies ThreadData;
```

VS Code may proxy or re-wrap `CommentThread` objects. The `any` cast bypasses type safety and the custom property could be silently lost in future VS Code versions.

**Fix:** Use a `WeakMap<vscode.CommentThread, ThreadData>` to associate metadata with threads.

---

### BUG-WV-05 — Incoming Message `branch` Field Not Validated
**File:** `src/views/branchSelectorWebviewProvider.ts`  
**Category:** Type Safety / Security  

```typescript
case 'selectBase': {
    this.baseBranch = message.branch;   // no type or null check
    this._fireBranchChange();
    break;
}
```

If the webview sends `{ type: 'selectBase', branch: null }` or omits `branch` entirely, `this.baseBranch` becomes `null`/`undefined` and propagates through the entire review creation flow.

**Fix:** Add a runtime check: `if (typeof message.branch !== 'string' || !message.branch) return;`

---

### BUG-EX-01 — `createReview` Command Skips `syncReviewableFiles` and `loadAllThreads`
**File:** `src/extension.ts`  
**Category:** Logic Error  

After creating a new review, the comment controller's reviewable-file set and thread list are never updated:

```typescript
const review = await localPrManager.createReview(source, target);
await changedFilesProvider.refresh(source, target);
localCommentsProvider.refresh();
// ← syncReviewableFiles() NOT called
// ← commentController.loadAllThreads() NOT called
```

As a result, comments from an existing `comments.json` for that branch pair won't appear, and the `+` gutter icon won't be available on working-tree files until `activateReview` is triggered separately.

---

### BUG-CF-01 — `getParent` Returns Wrong Parent for `FileChangeItem` Inside a Folder
**File:** `src/views/changedFilesProvider.ts`  
**Category:** Logic Error  

```typescript
getParent(element: ChangedFileTreeItem): ChangedFileTreeItem | undefined {
    if (element instanceof FileChangeItem || element instanceof FolderItem) {
        return this.filesSection;   // always returns the section, never the parent FolderItem
    }
```

A `FileChangeItem` inside a `FolderItem` returns `filesSection` as its parent rather than the containing `FolderItem`. This breaks `TreeView.reveal()` navigation because VS Code walks the parent chain to expand ancestors before revealing a node.

---

### BUG-LP-01 — `onDidChange` Subscription Leaked
**File:** `src/views/localPrsProvider.ts`  
**Category:** Memory Leak  

```typescript
constructor(private localPrManager: LocalPrManager) {
    this.localPrManager.onDidChange(() => this.refresh());   // Disposable discarded
}
```

The `Disposable` returned by `.onDidChange(...)` is never stored or disposed. The listener holds a reference to `this` throughout the extension's lifetime even after the provider is theoretically torn down.

**Fix:**
```typescript
private _changeListener: vscode.Disposable;
constructor(...) {
    this._changeListener = this.localPrManager.onDidChange(() => this.refresh());
}
dispose(): void {
    this._changeListener.dispose();
    this._onDidChangeTreeData.dispose();
}
```

---

### BUG-RT-01 — Active Review Not Restored When No Review Was Previously Active
**File:** `src/tools/localReviewTool.ts`  
**Category:** Logic Error / State Corruption  

```typescript
const previousActive = this.localPrManager.getActiveReview();   // may be undefined
this.localPrManager.setActiveReview(review.id);                 // always sets

if (previousActive && previousActive.id !== review.id) {        // ← guard skipped when undefined
    this.localPrManager.setActiveReview(previousActive.id);
}
```

If no review was active before the tool call, `previousActive` is `undefined`, the restore condition is skipped, and the review for the current branch is left permanently active — silently mutating user state and writing to disk.

---

### BUG-PM-01 — Branch Name Collision in Review Directory Names
**File:** `src/services/localPrManager.ts`  
**Category:** Logic Error  

```typescript
getReviewDir(review: LocalPr): string {
    const dirName = `${review.sourceBranch}_${review.targetBranch}`.replace(/\//g, '-');
    return path.join(this.reviewsDir, dirName);
}
```

The slash-replacement is not injective. For example:
- `feature/foo` vs `main` → `feature-foo_main`
- `feature-foo` vs `main` → also `feature-foo_main`

Two distinct branch pairs resolve to the same directory, causing one review's `comments.json` to overwrite another's.

**Fix:** Use the review `id` (UUID) as the directory name.

---

### BUG-FD-01 — Synchronous Disk Read on Every Decorated File
**File:** `src/decorations/fileDecorationProvider.ts`  
**Category:** Performance  

```typescript
private getUnresolvedCount(filePath: string): number {
    const comments = this.storageService.loadComments();   // fs.readFileSync on every call
```

`provideFileDecoration` is called for every file visible in the Explorer. Each call triggers a synchronous `fs.readFileSync` on the VS Code render thread. With large file trees this causes repeated blocking disk reads, degrading UI responsiveness.

**Fix:** Cache the comments object in `StorageService` and invalidate only when a write occurs.

---

### BUG-GS-03 — Log Format String Embedded in Shell Command
**File:** `src/git/gitService.ts`  
**Category:** Security / Logic Error  

```typescript
const format = `%H${SEP}%h${SEP}%s${SEP}%an${SEP}%aI${SEP}%ar`;
const output = await this.execGit(`log --format="${format}" ${source}..${target}`);
```

The `--format` value is wrapped in shell double-quotes that are themselves inside the shell command string. If a branch name contains `"` or a shell metacharacter the command breaks or becomes injectable (compounded by BUG-GS-01).

---

## 🟡 LOW PRIORITY

---

### BUG-CC-03 — `commentingRangeProvider` Range End Column 0 Cuts Off Last Line
**File:** `src/comments/commentController.ts`  
**Category:** Logic Error  

```typescript
return [new vscode.Range(0, 0, document.lineCount - 1, 0)];
```

The range end is column 0 of the last line — the very beginning of that line — so the last line itself cannot be commented on.

**Fix:** Use `document.lineAt(document.lineCount - 1).range.end` as the end position.

---

### BUG-WV-03 — `MutationObserver` Created but `.observe()` Never Called
**File:** `src/views/branchSelectorWebviewProvider.ts`  
**Category:** Dead Code  

```javascript
const observer = new MutationObserver(updateStatus);  // observe() never called
```

The observer is constructed, takes up memory, and does nothing. The workaround is a polling timer (see BUG-WV-04).

---

### BUG-WV-04 — Indefinite `setInterval` Polling Instead of Event-Driven Updates
**File:** `src/views/branchSelectorWebviewProvider.ts`  
**Category:** Performance  

```javascript
setInterval(updateStatus, 500);
```

A 500 ms polling timer runs forever in the webview because `MutationObserver` is broken (BUG-WV-03).

**Fix:** Call `updateStatus()` directly inside the `setValue()` helper or dispatch a synthetic `change` event after programmatic updates; remove the interval.

---

### BUG-WV-06 — Async Message Handler Errors Silently Swallowed
**File:** `src/views/branchSelectorWebviewProvider.ts`  
**Category:** Error Handling  

```typescript
webviewView.webview.onDidReceiveMessage(async (message) => {
    switch (message.type) {
        case 'requestBranches': {
            this.branches = await this.gitService.getBranches(true);   // can throw; no try/catch
```

If `getBranches` throws, the rejected promise from the async callback is unhandled. The webview receives no response and the branch list remains empty with no user-visible error.

---

### BUG-WV-07 — Hardcoded Default Branch `'origin/devel'`
**File:** `src/views/branchSelectorWebviewProvider.ts`  
**Category:** Logic Error  

```typescript
private baseBranch: string = 'origin/devel';
```

This branch does not exist in most repositories, causing an instant error state on first open.

**Fix:** Default to `''` and rely on the active review restore or user selection.

---

### BUG-EX-02 — `refreshTimer` Not Cleared on Extension Deactivate
**File:** `src/extension.ts`  
**Category:** Memory Leak  

```typescript
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async () => {
        ...
        refreshTimer = setTimeout(async () => { ... }, 500);
    })
);
```

`refreshTimer` is never added to `context.subscriptions` and not cleared in `deactivate()`. If a save fires just before deactivation, the timer callback runs inside a partially deactivated extension context.

---

### BUG-EX-03 — Unhandled Promise Rejection in `setTimeout` Async Callback
**File:** `src/extension.ts`  
**Category:** Error Handling  

```typescript
refreshTimer = setTimeout(async () => {
    await changedFilesProvider.refresh(active.sourceBranch, active.targetBranch);
    // no try/catch
}, 500);
```

If `changedFilesProvider.refresh` rejects, the rejection is silently lost.

---

### BUG-EX-04 — `.then()` Without `.catch()` in `deleteComment` Handler
**File:** `src/extension.ts`  
**Category:** Error Handling  

```typescript
vscode.window.showWarningMessage('Delete this comment?', 'Delete', 'Cancel')
    .then(answer => {
        if (answer === 'Delete') {
            commentController.deleteComment(thread, comment);
        }
    });  // ← no .catch()
```

Any exception thrown inside the `.then()` callback produces an unhandled promise rejection.

---

### BUG-EX-05 — Non-null Assertion `thread.range!` Without Guard
**File:** `src/extension.ts`  
**Category:** Null Dereference  

```typescript
commentController.createThread(thread.uri, thread.range!, reply.text, filePath);
```

Appears in multiple command handlers. `CommentThread.range` is optional per the VS Code API; the `!` assertion will throw a runtime `TypeError` if it is `undefined`.

---

### BUG-GS-02 — Dead Variable `filePath` in `getChangedFiles`
**File:** `src/git/gitService.ts`  
**Category:** Dead Code  

```typescript
const filePath = parts[1];              // ← assigned, never used
const oldFilePath = parts.length > 2 ? parts[1] : undefined;
const actualPath = parts.length > 2 ? parts[2] : parts[1];
```

`filePath` is immediately shadowed by `actualPath` and never referenced. Dead code.

---

### BUG-GS-04 — `_onDidChange` EventEmitter in `GitFileContentProvider` Is Never Fired
**File:** `src/git/gitFileContentProvider.ts`  
**Category:** Logic Error / Resource Leak  

```typescript
private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
readonly onDidChange = this._onDidChange.event;
```

`_onDidChange.fire()` is never called anywhere. VS Code registers it as a content-provider change notifier, but stale content in diff views can never be invalidated (e.g., after a force-push). The EventEmitter allocates memory and serves no purpose.

---

### BUG-RT-02 — Two Spurious UI Refreshes Per LM Tool Invocation
**File:** `src/tools/localReviewTool.ts`  
**Category:** Logic Error / Performance  

```typescript
this.localPrManager.setActiveReview(review.id);       // fires _onDidChange → full tree re-render
// ... work ...
this.localPrManager.setActiveReview(previousActive.id); // fires again
```

`setActiveReview` triggers `saveRegistry()` → `_onDidChange.fire()` → `LocalPrsProvider.refresh()`. Calling it twice causes two full tree re-renders on every LM tool invocation.

---

### BUG-FD-02 — `badge` Exceeds Two-Character VS Code Limit
**File:** `src/decorations/fileDecorationProvider.ts`  
**Category:** API Misuse  

```typescript
badge: `${count}`,
```

`FileDecoration.badge` is limited to 2 characters by the VS Code API. When `count >= 100` the badge is a 3-character string and VS Code will silently truncate or ignore it.

**Fix:** `badge: count > 99 ? '99+' : \`${count}\``

---

### BUG-PM-02 — `saveRegistry` Has No Error Handling
**File:** `src/services/localPrManager.ts`  
**Category:** Error Handling  

```typescript
private saveRegistry(): void {
    if (!fs.existsSync(this.reviewsDir)) {
        fs.mkdirSync(this.reviewsDir, { recursive: true });
    }
    fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8');
    this._onDidChange.fire();
}
```

If `mkdirSync` or `writeFileSync` throws (e.g., disk full, permissions denied), the error propagates uncaught through every call site (`createReview`, `deleteReview`, `setActiveReview`).

---

### BUG-CF-02 — All Threads Counted but Tooltip Says "Unresolved"
**File:** `src/views/changedFilesProvider.ts`  
**Category:** Logic Error  

```typescript
for (const thread of comments.threads) {   // counts ALL threads, including resolved
    counts.set(thread.filePath, (counts.get(thread.filePath) || 0) + 1);
```

`FileChangeItem.tooltip` uses this count with the text `"unresolved comment(s)"`, but the count includes resolved threads. `ReviewFileDecorationProvider` correctly filters by `state === 'unresolved'`, creating an inconsistency between the tree item description and the explorer badge.

---

### BUG-SC-01 — `getNonce()` Uses `Math.random()` (Cryptographically Weak)
**File:** `src/views/suggestChangePanel.ts`  
**Category:** Security  

```typescript
function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
```

`Math.random()` is not a CSPRNG. A predictable nonce weakens the CSP protection.

**Fix:**
```typescript
import * as crypto from 'crypto';
const nonce = crypto.randomBytes(16).toString('hex');
```

---

### BUG-BS-01 — `BranchSelectorProvider` File Is Entirely Dead Code
**File:** `src/views/branchSelectorProvider.ts`  
**Category:** Code Quality  

`BranchSelectorProvider` is defined but never imported or used anywhere. The extension uses `BranchSelectorWebviewProvider` exclusively. The file should be removed to prevent maintenance confusion.

---

### BUG-PK-01 — `uuid` Dependency Declared but Never Used
**File:** `package.json`  
**Category:** Code Quality  

```json
"dependencies": { "uuid": "^9.0.0" },
"devDependencies": { "@types/uuid": "^10.0.0" }
```

All UUID generation uses Node's built-in `crypto.randomUUID()`. The `uuid` package and its types are never imported anywhere in the source.

**Fix:** Remove both entries from `package.json` and run `npm uninstall uuid @types/uuid`.

---

### BUG-PK-02 — Engine Minimum `1.85.0` but LM Tool API Requires `1.93+`
**File:** `package.json`  
**Category:** Compatibility  

```json
"engines": { "vscode": "^1.85.0" }
```

`vscode.lm.registerTool` was added in VS Code 1.93. Users on VS Code 1.85–1.92 will silently get a broken LM tool feature with no diagnostic message.

**Fix:** Raise the engine minimum to `^1.93.0`, or add a logged warning inside the existing `try/catch` that wraps `registerTool`.

---

## Summary Table

| ID | File | Description | Severity | Verified |
|---|---|---|---|---|
| GS-01 | `git/gitService.ts` | Command injection via `cp.exec` string concat | **High** | ✅ `cp.exec(\`git ${args}\`, ...)` confirmed at line 168 |
| WV-01 | `views/branchSelectorWebviewProvider.ts` | XSS via unescaped branch names in `innerHTML` | **High** | ✅ `dropdown.innerHTML = items.map((b,i) => '...' + b + '...')` confirmed |
| WV-02 | `views/branchSelectorWebviewProvider.ts` | No Content-Security-Policy in webview | **High** | ✅ `_getHtml()` has no `<meta http-equiv="Content-Security-Policy">` tag |
| CC-01 | `comments/commentController.ts` | `comment.timestamp` undefined → delete silently fails | **Medium** | ✅ `comment.timestamp?.getTime()` matched against stored timestamp; `undefined === number` never matches. Note: `toVscodeComment` always sets timestamp, so this is only triggered by future code paths. |
| CC-02 | `comments/commentController.ts` | `__threadData` on `any`-cast `CommentThread` | **Medium** | ✅ `(thread as any).__threadData = {...}` confirmed |
| WV-05 | `views/branchSelectorWebviewProvider.ts` | `message.branch` not validated | **Medium** | ✅ `this.baseBranch = message.branch` with no null/type guard |
| EX-01 | `extension.ts` | `createReview` skips `syncReviewableFiles`/`loadAllThreads` | **Medium** | ✅ `createReview` command calls `changedFilesProvider.refresh` but neither `syncReviewableFiles()` nor `commentController.loadAllThreads()`. Compare: `activateReview` calls both. |
| CF-01 | `views/changedFilesProvider.ts` | `getParent` wrong for `FileChangeItem` inside folder | **Medium** | ✅ `getParent` always returns `this.filesSection` for `FileChangeItem`, never the containing `FolderItem` |
| LP-01 | `views/localPrsProvider.ts` | `onDidChange` subscription leaked | **Medium** | ✅ `this.localPrManager.onDidChange(() => this.refresh())` return value discarded |
| RT-01 | `tools/localReviewTool.ts` | Active review not restored when no prior active exists | **Medium** | ✅ `if (previousActive && previousActive.id !== review.id)` guard skips restore when `previousActive === undefined` |
| PM-01 | `services/localPrManager.ts` | Branch name collision → review directory overwrite | **Medium** | ✅ `\`${review.sourceBranch}_${review.targetBranch}\`.replace(/\//g, '-')` is not injective |
| FD-01 | `decorations/fileDecorationProvider.ts` | Synchronous disk read on every decorated file | **Medium** | ✅ `getUnresolvedCount` calls `storageService.loadComments()` → `fs.readFileSync` on each decoration call |
| GS-03 | `git/gitService.ts` | Log format string injectable in shell command | **Medium** | ✅ `\`log --format="${format}" ${source}..${target}\`` confirmed |
| CC-03 | `comments/commentController.ts` | Range end col 0 cuts off last commentable line | **Low** | ✅ `new vscode.Range(0, 0, document.lineCount - 1, 0)` confirmed |
| WV-03 | `views/branchSelectorWebviewProvider.ts` | `MutationObserver` created but `.observe()` never called | **Low** | ✅ `const observer = new MutationObserver(updateStatus)` — `.observe()` absent |
| WV-04 | `views/branchSelectorWebviewProvider.ts` | `setInterval` polling instead of event-driven updates | **Low** | ✅ `setInterval(updateStatus, 500)` confirmed |
| WV-06 | `views/branchSelectorWebviewProvider.ts` | Async message handler errors silently swallowed | **Low** | ✅ `onDidReceiveMessage(async (message) => { ... await this.gitService.getBranches(true); ...})` no try/catch |
| WV-07 | `views/branchSelectorWebviewProvider.ts` | Hardcoded `'origin/devel'` default branch | **Low** | ✅ `private baseBranch: string = 'origin/devel'` confirmed |
| EX-02 | `extension.ts` | `refreshTimer` not cleared on extension deactivate | **Low** | ✅ `refreshTimer` never added to `context.subscriptions`; no `deactivate()` function clears it |
| EX-03 | `extension.ts` | Unhandled rejection in `setTimeout` async callback | **Low** | ✅ `setTimeout(async () => { await changedFilesProvider.refresh(...); }, 500)` no try/catch |
| EX-04 | `extension.ts` | `.then()` without `.catch()` in `deleteComment` | **Low** | ✅ `vscode.window.showWarningMessage(...).then(answer => {...})` no `.catch()` |
| EX-05 | `extension.ts` | `thread.range!` non-null assertion may throw | **Low** | ✅ `commentController.createThread(thread.uri, thread.range!, ...)` in both `addComment` and `saveComment` commands |
| GS-02 | `git/gitService.ts` | Dead variable `filePath` in `getChangedFiles` | **Low** | ✅ `const filePath = parts[1]` declared, immediately shadowed by `actualPath`, never referenced |
| GS-04 | `git/gitFileContentProvider.ts` | `_onDidChange` EventEmitter never fired | **Low** | ✅ `_onDidChange.fire()` absent from the entire file |
| RT-02 | `tools/localReviewTool.ts` | Two spurious UI refreshes per tool invocation | **Low** | ✅ `setActiveReview` called twice; each call triggers `saveRegistry()` → `_onDidChange.fire()` → full tree re-render |
| FD-02 | `decorations/fileDecorationProvider.ts` | `badge` exceeds 2-char VS Code limit when count ≥ 100 | **Low** | ✅ `badge: \`${count}\`` confirmed |
| PM-02 | `services/localPrManager.ts` | `saveRegistry` has no error handling | **Low** | ✅ `fs.mkdirSync` and `fs.writeFileSync` calls in `saveRegistry` have no try/catch |
| CF-02 | `views/changedFilesProvider.ts` | All threads counted; tooltip says "unresolved" | **Low** | ✅ `getCommentCounts()` iterates all threads; `FileChangeItem.tooltip` uses count with text `"unresolved comment(s)"` |
| SC-01 | `views/suggestChangePanel.ts` | `Math.random()` used for CSP nonce | **Low** | ✅ `chars.charAt(Math.floor(Math.random() * chars.length))` confirmed |
| BS-01 | `views/branchSelectorProvider.ts` | Entire file is dead / unreachable code | **Low** | ✅ `BranchSelectorProvider` not imported anywhere in `extension.ts`; only `BranchSelectorWebviewProvider` is used |
| PK-01 | `package.json` | `uuid` dependency declared but never used | **Low** | ✅ `"uuid": "^9.0.0"` in package.json; `from 'uuid'` found zero times in source |
| PK-02 | `package.json` | Engine min `1.85` declared; LM API needs `1.93+` | **Low** | ✅ `"vscode": "^1.85.0"` in package.json; `vscode.lm.registerTool` used in extension.ts |
