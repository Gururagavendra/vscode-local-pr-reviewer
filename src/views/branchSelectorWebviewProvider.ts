import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { LocalPrManager } from '../services/localPrManager';

export class BranchSelectorWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'localPrReview.branchSelector';

    private _view?: vscode.WebviewView;
    private _onDidSelectBranches = new vscode.EventEmitter<{ base: string; compare: string }>();
    readonly onDidSelectBranches = this._onDidSelectBranches.event;

    private baseBranch: string = 'origin/devel';
    private compareBranch: string = '';
    private branches: string[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private gitService: GitService,
        private localPrManager: LocalPrManager,
    ) {
        const active = this.localPrManager.getActiveReview();
        if (active) {
            this.baseBranch = active.sourceBranch;
            this.compareBranch = active.targetBranch;
        }
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'requestBranches': {
                    if (this.branches.length === 0) {
                        this.branches = await this.gitService.getBranches(true);
                    }
                    webviewView.webview.postMessage({
                        type: 'branches',
                        branches: this.branches,
                    });
                    break;
                }
                case 'selectBase': {
                    this.baseBranch = message.branch;
                    this._fireBranchChange();
                    break;
                }
                case 'selectCompare': {
                    this.compareBranch = message.branch;
                    this._fireBranchChange();
                    break;
                }
                case 'refreshBranches': {
                    this.branches = await this.gitService.getBranches(true);
                    webviewView.webview.postMessage({
                        type: 'branches',
                        branches: this.branches,
                    });
                    break;
                }
            }
        });

        // Send initial state
        this._updateWebview();
    }

    private _fireBranchChange(): void {
        if (this.baseBranch && this.compareBranch && this.baseBranch !== this.compareBranch) {
            this._onDidSelectBranches.fire({ base: this.baseBranch, compare: this.compareBranch });
        }
        this._updateWebview();
    }

    private _updateWebview(): void {
        this._view?.webview.postMessage({
            type: 'setState',
            base: this.baseBranch,
            compare: this.compareBranch,
        });
    }

    getSourceBranch(): string { return this.baseBranch; }
    getTargetBranch(): string { return this.compareBranch; }

    setSourceBranch(branch: string): void {
        this.baseBranch = branch;
        this._updateWebview();
    }

    setTargetBranch(branch: string): void {
        this.compareBranch = branch;
        this._updateWebview();
    }

    refresh(): void {
        const active = this.localPrManager.getActiveReview();
        if (active) {
            this.baseBranch = active.sourceBranch;
            this.compareBranch = active.targetBranch;
        }
        this._updateWebview();
    }

    dispose(): void {
        this._onDidSelectBranches.dispose();
    }

    private _getHtml(): string {
        return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        padding: 8px;
    }
    .field {
        margin-bottom: 10px;
        position: relative;
    }
    .field-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .field-label .icon {
        font-size: 14px;
    }
    .branch-input-wrapper {
        position: relative;
    }
    .branch-input {
        width: 100%;
        padding: 5px 28px 5px 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent));
        border-radius: 4px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        outline: none;
    }
    .branch-input:focus {
        border-color: var(--vscode-focusBorder);
    }
    .branch-input::placeholder {
        color: var(--vscode-input-placeholderForeground);
    }
    .dropdown-arrow {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--vscode-descriptionForeground);
        pointer-events: none;
        font-size: 12px;
    }
    .dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        max-height: 200px;
        overflow-y: auto;
        background: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
        border-radius: 4px;
        z-index: 100;
        display: none;
        margin-top: 2px;
    }
    .dropdown.visible { display: block; }
    .dropdown-item {
        padding: 4px 8px;
        cursor: pointer;
        font-size: var(--vscode-font-size);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .dropdown-item:hover,
    .dropdown-item.active {
        background: var(--vscode-list-hoverBackground);
    }
    .dropdown-item.selected {
        background: var(--vscode-list-activeSelectionBackground);
        color: var(--vscode-list-activeSelectionForeground);
    }
    .dropdown-item .remote-tag {
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        margin-left: 4px;
    }
    .arrow-separator {
        text-align: center;
        color: var(--vscode-descriptionForeground);
        font-size: 16px;
        margin: 2px 0 6px 0;
    }
    .status-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
    }
    .status-bar .check {
        color: var(--vscode-charts-green, #89d185);
        font-size: 14px;
    }
    .status-bar .warning {
        color: var(--vscode-editorWarning-foreground, #cca700);
    }
    .no-results {
        padding: 6px 8px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        font-size: 12px;
    }
</style>
</head>
<body>
    <div class="field">
        <div class="field-label">
            <span class="icon">&#9678;</span> base
        </div>
        <div class="branch-input-wrapper">
            <input
                class="branch-input"
                id="baseInput"
                type="text"
                placeholder="Select base branch..."
                autocomplete="off"
                spellcheck="false"
            />
            <span class="dropdown-arrow">&#9662;</span>
            <div class="dropdown" id="baseDropdown"></div>
        </div>
    </div>

    <div class="arrow-separator">&larr;</div>

    <div class="field">
        <div class="field-label">
            <span class="icon">&#9683;</span> compare
        </div>
        <div class="branch-input-wrapper">
            <input
                class="branch-input"
                id="compareInput"
                type="text"
                placeholder="Select compare branch..."
                autocomplete="off"
                spellcheck="false"
            />
            <span class="dropdown-arrow">&#9662;</span>
            <div class="dropdown" id="compareDropdown"></div>
        </div>
    </div>

    <div class="status-bar" id="statusBar"></div>

    <script>
        const vscode = acquireVsCodeApi();
        let allBranches = [];
        let activeDropdown = null;
        let activeIndex = -1;

        const baseInput = document.getElementById('baseInput');
        const compareInput = document.getElementById('compareInput');
        const baseDropdown = document.getElementById('baseDropdown');
        const compareDropdown = document.getElementById('compareDropdown');
        const statusBar = document.getElementById('statusBar');

        // Request branches on load
        vscode.postMessage({ type: 'requestBranches' });

        function filterBranches(query) {
            if (!query) return allBranches.slice(0, 50);
            const lower = query.toLowerCase();
            return allBranches.filter(b => b.toLowerCase().includes(lower)).slice(0, 50);
        }

        function renderDropdown(dropdown, items, selectedValue) {
            if (items.length === 0) {
                dropdown.innerHTML = '<div class="no-results">No matching branches</div>';
            } else {
                dropdown.innerHTML = items.map((b, i) => {
                    const isRemote = b.startsWith('origin/') || b.includes('remotes/');
                    const cls = b === selectedValue ? 'dropdown-item selected' : 'dropdown-item';
                    const tag = isRemote ? '<span class="remote-tag">remote</span>' : '';
                    return '<div class="' + cls + '" data-branch="' + b + '" data-index="' + i + '">' + b + tag + '</div>';
                }).join('');
            }
            dropdown.classList.add('visible');
        }

        function hideDropdown(dropdown) {
            dropdown.classList.remove('visible');
            activeDropdown = null;
            activeIndex = -1;
        }

        function setupInput(input, dropdown, messageType) {
            let currentValue = '';

            input.addEventListener('focus', () => {
                activeDropdown = dropdown;
                activeIndex = -1;
                const filtered = filterBranches(input.value);
                renderDropdown(dropdown, filtered, currentValue);
            });

            input.addEventListener('input', () => {
                activeIndex = -1;
                const filtered = filterBranches(input.value);
                renderDropdown(dropdown, filtered, currentValue);
            });

            input.addEventListener('keydown', (e) => {
                const items = dropdown.querySelectorAll('.dropdown-item[data-branch]');
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIndex = Math.min(activeIndex + 1, items.length - 1);
                    updateActive(items);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIndex = Math.max(activeIndex - 1, 0);
                    updateActive(items);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (activeIndex >= 0 && items[activeIndex]) {
                        selectBranch(items[activeIndex].dataset.branch, input, dropdown, messageType);
                    }
                } else if (e.key === 'Escape') {
                    input.value = currentValue;
                    hideDropdown(dropdown);
                    input.blur();
                }
            });

            dropdown.addEventListener('mousedown', (e) => {
                // Prevent blur from firing before click
                e.preventDefault();
            });

            dropdown.addEventListener('click', (e) => {
                const item = e.target.closest('.dropdown-item[data-branch]');
                if (item) {
                    selectBranch(item.dataset.branch, input, dropdown, messageType);
                }
            });

            input.addEventListener('blur', () => {
                setTimeout(() => hideDropdown(dropdown), 150);
            });

            function selectBranch(branch, inp, dd, msgType) {
                currentValue = branch;
                inp.value = branch;
                hideDropdown(dd);
                inp.blur();
                vscode.postMessage({ type: msgType, branch: branch });
            }

            return {
                setValue(val) {
                    currentValue = val;
                    input.value = val;
                }
            };
        }

        function updateActive(items) {
            items.forEach((item, i) => {
                item.classList.toggle('active', i === activeIndex);
                if (i === activeIndex) {
                    item.scrollIntoView({ block: 'nearest' });
                }
            });
        }

        const baseController = setupInput(baseInput, baseDropdown, 'selectBase');
        const compareController = setupInput(compareInput, compareDropdown, 'selectCompare');

        function updateStatus() {
            const base = baseInput.value;
            const compare = compareInput.value;
            if (base && compare && base !== compare) {
                statusBar.innerHTML = '<span class="check">&#10003;</span> Ready to review';
            } else if (base && compare && base === compare) {
                statusBar.innerHTML = '<span class="warning">&#9888;</span> Same branch selected';
            } else {
                statusBar.innerHTML = '';
            }
        }

        // Listen for messages from extension
        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'branches':
                    allBranches = msg.branches;
                    break;
                case 'setState':
                    if (msg.base) baseController.setValue(msg.base);
                    if (msg.compare) compareController.setValue(msg.compare);
                    updateStatus();
                    break;
            }
        });

        // Update status on any change
        const observer = new MutationObserver(updateStatus);
        baseInput.addEventListener('change', updateStatus);
        compareInput.addEventListener('change', updateStatus);

        // Also watch for programmatic value changes
        setInterval(updateStatus, 500);
    </script>
</body>
</html>`;
    }
}
