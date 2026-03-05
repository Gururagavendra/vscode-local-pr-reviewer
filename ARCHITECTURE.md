# Architecture

This document describes the internal architecture of the **Local PR Review** VS Code extension.

---

## High-Level Flow

```mermaid
graph TD
    User(["👤 User"])
    Copilot(["🤖 Copilot Chat"])

    User -->|opens sidebar| ActivityBar["Activity Bar\n(Local PR Review)"]
    User -->|reviews code in| DiffEditor["Diff Editor"]
    Copilot -->|queries via| LRTool["#localReviewComments\nLanguage Model Tool"]

    subgraph Views ["VS Code Views"]
        direction TB
        BranchSelector["🔀 Branch Selector\nWebviewView — pick base & compare"]
        ChangedFiles["📁 Changed Files\nTreeView — grouped by directory\n✔ reviewed checkbox · 💬 comment badge · ↗ open file"]
        CommentsPanel["💬 Comments Panel\nTreeView — all threads & replies"]
        ReviewsList["📋 Saved Reviews\nTreeView — switch between sessions"]
    end

    subgraph Core ["Core Services"]
        direction TB
        GitService["🔧 Git Service\nbranch list · file diffs · commit log"]
        CommentController["💬 Comment Controller\nVS Code Comment API\ncreate · edit · delete · resolve"]
        LocalPrManager["📦 Local PR Manager\nreview CRUD · reviewed-files state"]
        StorageService["💾 Storage Service\nread / write JSON per review"]
    end

    subgraph Persistence ["Persistence"]
        JSONFiles[".vscode/local-reviews/\n&lt;review-id&gt;.json"]
    end

    ActivityBar --> BranchSelector & ChangedFiles & CommentsPanel & ReviewsList
    DiffEditor -->|inline comment| CommentController

    LRTool --> StorageService

    BranchSelector --> GitService
    ChangedFiles --> GitService
    ChangedFiles --> StorageService
    ChangedFiles --> LocalPrManager
    CommentsPanel --> LocalPrManager
    ReviewsList --> LocalPrManager

    CommentController --> LocalPrManager
    LocalPrManager --> StorageService
    StorageService --> JSONFiles
```

---

## Data Flow — Adding a Comment

```mermaid
sequenceDiagram
    actor User
    participant DiffEditor as Diff Editor
    participant CommentController
    participant LocalPrManager
    participant StorageService
    participant JSONFiles as .vscode/local-reviews/

    User->>DiffEditor: Click gutter to add comment
    DiffEditor->>CommentController: onDidCreateCommentThread()
    CommentController->>LocalPrManager: addComment(reviewId, file, line, text)
    LocalPrManager->>StorageService: saveReview(reviewId, data)
    StorageService->>JSONFiles: write <review-id>.json
    JSONFiles-->>StorageService: ack
    StorageService-->>LocalPrManager: ack
    LocalPrManager-->>CommentController: updated thread
    CommentController-->>DiffEditor: render inline comment
```

---

## Data Flow — Copilot Query

```mermaid
sequenceDiagram
    actor User
    participant Copilot as Copilot Chat
    participant LRTool as LocalReviewTool
    participant StorageService
    participant LocalPrManager

    User->>Copilot: "Summarise my unresolved comments"
    Copilot->>LRTool: invoke #localReviewComments
    LRTool->>LocalPrManager: getActiveReviewId()
    LocalPrManager->>StorageService: loadReview(reviewId)
    StorageService-->>LocalPrManager: review data
    LocalPrManager-->>LRTool: comments[]
    LRTool-->>Copilot: formatted comment list
    Copilot-->>User: "You have 3 unresolved comments in src/..."
```

---

## Module Map

| Module | Path | Responsibility |
|---|---|---|
| `extension.ts` | `src/` | Entry point — registers all views, commands, and event handlers |
| `GitService` | `src/git/` | Wraps VS Code Git API + `child_process` for diff, branch list, commits |
| `CommentController` | `src/comments/` | Manages all inline comment threads via the VS Code Comment API |
| `LocalPrManager` | `src/services/` | Review CRUD — create, load, save, delete, reviewed-file state |
| `StorageService` | `src/storage/` | Reads and writes review JSON to `.vscode/local-reviews/` |
| `BranchSelectorWebviewProvider` | `src/views/` | WebviewView panel for branch selection |
| `ChangedFilesProvider` | `src/views/` | TreeView — directories + files with badges, checkboxes, open-file action |
| `LocalCommentsProvider` | `src/views/` | TreeView — flat list of all comment threads and replies |
| `LocalPrsProvider` | `src/views/` | TreeView — saved review sessions |
| `LocalReviewTool` | `src/tools/` | Copilot LM Tool — exposes comments to `#localReviewComments` chat queries |

---

## Persistence Format

Each review is stored as a JSON file at `.vscode/local-reviews/<review-id>.json`:

```json
{
  "id": "uuid",
  "name": "My review",
  "baseBranch": "main",
  "compareBranch": "feature/my-feature",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "reviewedFiles": ["src/foo.ts"],
  "comments": [
    {
      "id": "uuid",
      "filePath": "src/foo.ts",
      "line": 42,
      "text": "Consider extracting this to a helper",
      "resolved": false,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```
