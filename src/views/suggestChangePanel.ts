import * as vscode from 'vscode';

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

export class SuggestChangePanel {
    private panel: vscode.WebviewPanel;
    private resolved = false;

    /**
     * Open the suggestion composer. Returns the formatted diff comment body,
     * or undefined if the user cancelled.
     */
    static async show(
        extensionUri: vscode.Uri,
        originalCode: string,
        filePath: string
    ): Promise<string | undefined> {
        return new Promise((resolve) => {
            new SuggestChangePanel(extensionUri, originalCode, filePath, resolve);
        });
    }

    private constructor(
        extensionUri: vscode.Uri,
        private readonly originalCode: string,
        filePath: string,
        private readonly resolve: (value: string | undefined) => void
    ) {
        const fileName = filePath.split('/').pop() ?? filePath;

        this.panel = vscode.window.createWebviewPanel(
            'localPrReview.suggestChange',
            `Suggest Change: ${fileName}`,
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: false }
        );

        this.panel.webview.html = this.getHtml(this.panel.webview);

        this.panel.webview.onDidReceiveMessage(msg => {
            if (this.resolved) { return; }
            if (msg.type === 'submit') {
                this.resolved = true;
                const body = this.formatSuggestion(originalCode, msg.suggested as string);
                resolve(body);
                this.panel.dispose();
            } else if (msg.type === 'cancel') {
                this.resolved = true;
                resolve(undefined);
                this.panel.dispose();
            }
        });

        this.panel.onDidDispose(() => {
            if (!this.resolved) {
                this.resolved = true;
                resolve(undefined);
            }
        });
    }

    private formatSuggestion(original: string, suggested: string): string {
        const origLines = original.split('\n');
        const suggLines = suggested.split('\n');
        const diffLines = [
            '💡 **Suggestion:**',
            '',
            '```diff',
            ...origLines.map(l => `- ${l}`),
            ...suggLines.map(l => `+ ${l}`),
            '```',
        ];
        return diffLines.join('\n');
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        // Safely embed the original code as a JSON string to avoid escaping issues
        const originalJson = JSON.stringify(this.originalCode);

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Suggest a Change</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }
    h2 {
      margin: 0 0 16px 0;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 5px;
      color: var(--vscode-descriptionForeground);
    }
    .section { margin-bottom: 14px; }
    textarea {
      width: 100%;
      font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      color: var(--vscode-input-foreground);
      padding: 8px;
      border-radius: 3px;
      resize: vertical;
      min-height: 90px;
      outline: none;
    }
    textarea:focus { border-color: var(--vscode-focusBorder); }
    textarea.readonly {
      opacity: 0.55;
      cursor: default;
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .diff-preview {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 12px);
      border: 1px solid var(--vscode-panel-border, #444);
      border-radius: 3px;
      overflow: auto;
      max-height: 220px;
      min-height: 40px;
    }
    .diff-line {
      padding: 1px 10px;
      white-space: pre;
      line-height: 1.5;
    }
    .diff-remove { background: rgba(255,80,80,0.15); color: #f08080; }
    .diff-add    { background: rgba(80,200,120,0.15); color: #7ec896; }
    .buttons {
      display: flex;
      gap: 8px;
      margin-top: 18px;
    }
    button {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      padding: 5px 14px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <h2>💡 Suggest a Change</h2>

  <div class="section">
    <label>Original Code</label>
    <textarea class="readonly" id="original" readonly></textarea>
  </div>

  <div class="section">
    <label>Suggested Replacement</label>
    <textarea id="suggested" placeholder="Edit to suggest a replacement…"></textarea>
  </div>

  <div class="section">
    <label>Preview</label>
    <div class="diff-preview" id="preview"></div>
  </div>

  <div class="buttons">
    <button class="btn-primary" id="btnSubmit">Add as Comment</button>
    <button class="btn-secondary" id="btnCancel">Cancel</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const original  = document.getElementById('original');
    const suggested = document.getElementById('suggested');
    const preview   = document.getElementById('preview');

    // Safely set value from extension context
    const originalCode = ${originalJson};
    original.value  = originalCode;
    suggested.value = originalCode;

    function esc(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function updatePreview() {
      const orig = original.value.split('\\n');
      const sugg = suggested.value.split('\\n');
      let html = '';
      for (const l of orig) { html += '<div class="diff-line diff-remove">- ' + esc(l) + '</div>'; }
      for (const l of sugg) { html += '<div class="diff-line diff-add">+ '    + esc(l) + '</div>'; }
      preview.innerHTML = html;
    }

    suggested.addEventListener('input', updatePreview);
    updatePreview();

    document.getElementById('btnSubmit').addEventListener('click', () => {
      vscode.postMessage({ type: 'submit', suggested: suggested.value });
    });
    document.getElementById('btnCancel').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });
  </script>
</body>
</html>`;
    }
}
