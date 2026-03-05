# Local PR Review - Specification

**Date:** 2026-03-05
**Status:** Validated

## Context

Developers need to self-review their code changes before creating a pull request. The existing GitHub PR extension only works after a PR exists on the remote. There is no tool for local, offline code review with persistent inline comments that survive across sessions.

## Decision

Build a VS Code extension from scratch (TypeScript) that provides local branch diff viewing and inline commenting with local-only JSON-backed storage. No remote API calls in the MVP.

We chose ground-up over forking the GitHub PR extension because we need <1% of its functionality and forking would mean deleting ~100K lines of irrelevant code.

## Sidebar Layout

The extension adds an activity bar icon. Clicking it shows a sidebar with four sections:

```
+-----------------------------------+
| SOURCE BRANCH                     |
| [devel            v]              |  <- default "devel"
|                                   |
| DESTINATION BRANCH                |
| [Search branches...   ]           |  <- searchable, empty by default
|                                   |
| [+ Create Review]                 |
+-----------------------------------+
| CHANGED FILES                     |  <- files for active PR
|   src/auth.ts                     |  <- click opens diff
|   src/login.ts                    |
+-----------------------------------+
| LOCAL PRS                         |
| > feature/auth -> devel  [active] |  <- click to activate
| > bugfix/login -> devel      [x]  |  <- trash icon to delete
+-----------------------------------+
| LOCAL COMMENTS                    |
|   feature/auth -> devel           |
|     comments.json                 |  <- click to open JSON
+-----------------------------------+
```

## Requirements

### Branch Selector (Section 1)
- Source branch dropdown, defaults to `devel`
- Destination branch with searchable picker, empty by default
- "Create Review" button to save a Local PR entry

### Changed Files (Section 2)
- Shows files changed between source and destination of the **active** Local PR
- Clicking a file opens VS Code's built-in diff editor
- Updates automatically when a different Local PR is selected

### Local PRs (Section 3)
- Lists all saved review sessions (branch pairs)
- Clicking a Local PR makes it active: auto-fills source/destination and shows its changed files
- Trash icon to delete a Local PR (and its stored comments)
- Persists across VS Code restarts

### Local Comments (Section 4)
- Lists JSON comment files grouped by Local PR
- Clicking a JSON file opens it for direct viewing
- Transparent data layer -- AI agents can read these files directly

### Inline Comments
- User can add inline comments on any line in the diff editor
- Comments have resolve/unresolve toggle
- Comments are stored as JSON files locally, per branch pair
- No network calls required -- everything works offline

## Constraints

- VS Code extension only (TypeScript + Node.js)
- Depends on VS Code's built-in Git extension for branch info
- Git must be installed and the workspace must be a git repository
- MVP is GitHub-only for future PR creation (not in MVP scope)

## Out of Scope (MVP)

- Creating PRs on GitHub
- Review checklist (checkboxes per file)
- Copilot tool integration for reading comments
- Multi-remote support (GitLab, Azure DevOps)
- Authentication / GitHub API calls
- Syncing comments to remote

## Open Questions

- [ ] Extension name: "Local PR Review" or something catchier?
- [ ] Should comments persist after branches are deleted/merged?
- [ ] Icon / branding for the sidebar panel

## Success Criteria

- [ ] Can select two local branches and see file diff list
- [ ] Can open any file diff in the built-in diff editor
- [ ] Can add inline comments on specific lines
- [ ] Can resolve/unresolve comments
- [ ] Can see all comments in a panel
- [ ] Comments persist across VS Code restarts (JSON files)
- [ ] Works fully offline with zero network calls
