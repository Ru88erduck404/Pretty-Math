'use strict';

const vscode = require('vscode');
const { analyze } = require('./src/pretty');
const { collectValues, valuesFromDebugger } = require('./src/values');

// How much text around the cursor is scanned. Big enough for any wrapped
// formula, small enough that a huge file costs nothing per keystroke.
const WINDOW_LINES = 80;
const MAX_SELECTION = 20000;
// How far back to look for what the variables hold.
const VALUE_LINES = 500;
// A cap on how many variables one statement asks the debugger about.
const MAX_LIVE_LOOKUPS = 40;

function readConfig(doc) {
  const c = vscode.workspace.getConfiguration('prettyMath', doc ? doc.uri : null);
  return {
    autoUpdate: c.get('autoUpdate', true),
    fontSize: c.get('fontSize', 20),
    caretMeansPower: c.get('caretMeansPower', 'auto'),
    multiplication: c.get('multiplication', 'implicit'),
    indexAsSubscript: c.get('indexAsSubscript', true),
    greekLetters: c.get('greekLetters', true),
    expandIdentities: c.get('expandIdentities', true),
    derivativeSymbol: c.get('derivativeSymbol', 'auto'),
    stripNamespaces: c.get('stripNamespaces', []),
    showLatex: c.get('showLatex', false),
    showTree: c.get('showTree', false),
    maxLines: c.get('maxLines', 40),
    substituteValues: c.get('substituteValues', false),
    valueDigits: c.get('valueDigits', 6),
    valueScanLines: VALUE_LINES
  };
}

// The text above the cursor that assignments are read from.
function valueWindow(doc, selection) {
  const first = Math.max(0, selection.start.line - VALUE_LINES);
  const range = new vscode.Range(first, 0, selection.start.line,
    doc.lineAt(selection.start.line).text.length);
  return doc.getText(range);
}

// The frame a paused debug session is stopped in, when the running VS Code is
// new enough to expose it. Without it there is nothing to evaluate against.
function pausedFrameId() {
  const item = vscode.debug.activeStackItem;
  if (!item || typeof item.frameId !== 'number') return null;
  return item.frameId;
}

// The slice of the document we hand to the parser, plus its offset in the file.
function windowAround(doc, selection) {
  const first = Math.max(0, selection.start.line - WINDOW_LINES);
  const last = Math.min(doc.lineCount - 1, selection.end.line + WINDOW_LINES);
  const range = new vscode.Range(first, 0, last, doc.lineAt(last).text.length);
  return { text: doc.getText(range), base: doc.offsetAt(range.start) };
}

class PrettyMathView {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.pinned = false;
    this.last = null;          // { uri, statements, ... }
    this.timer = null;
    this.liveToken = 0;        // guards late debugger replies
    this.decoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
      borderRadius: '2px'
    });
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };
    view.webview.html = this.html(view.webview);

    view.webview.onDidReceiveMessage(this.onMessage.bind(this));
    view.onDidChangeVisibility(() => { if (view.visible) this.update(true); });
    view.onDidDispose(() => { this.view = null; });

    this.update(true);
  }

  onMessage(msg) {
    if (!msg) return;
    switch (msg.type) {
      case 'hover':
        this.highlight(msg.s, msg.e);
        break;
      case 'reveal':
        this.reveal(msg.s, msg.e);
        break;
      case 'pin':
        this.setPinned(!this.pinned);
        break;
      case 'copyLatex':
        this.copyLatex();
        break;
      case 'setConfig':
        vscode.workspace.getConfiguration('prettyMath')
          .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
        break;
      case 'refresh':
        this.update(true);
        break;
    }
  }

  editorForLast() {
    if (!this.last) return null;
    return vscode.window.visibleTextEditors.find(function (e) {
      return e.document.uri.toString() === this.last.uri;
    }.bind(this)) || null;
  }

  highlight(s, e) {
    const editor = this.editorForLast();
    if (!editor) return;
    if (typeof s !== 'number' || typeof e !== 'number' || e <= s) {
      editor.setDecorations(this.decoration, []);
      return;
    }
    const range = new vscode.Range(editor.document.positionAt(s), editor.document.positionAt(e));
    editor.setDecorations(this.decoration, [range]);
  }

  reveal(s, e) {
    const editor = this.editorForLast();
    if (!editor || typeof s !== 'number') return;
    const range = new vscode.Range(editor.document.positionAt(s), editor.document.positionAt(e));
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
  }

  setPinned(value) {
    this.pinned = value;
    this.post({ type: 'pinned', pinned: value });
    if (!value) this.update(true);
  }

  copyLatex() {
    if (!this.last || !this.last.statements.length) {
      vscode.window.showInformationMessage('Pretty Math: nothing to copy yet.');
      return;
    }
    const tex = this.last.statements
      .map(function (s) { return s.latex; })
      .filter(Boolean)
      .join('\\\\\n');
    if (!tex) {
      vscode.window.showInformationMessage('Pretty Math: this expression did not parse.');
      return;
    }
    vscode.env.clipboard.writeText(tex);
    vscode.window.setStatusBarMessage('Pretty Math: LaTeX copied', 2000);
  }

  post(msg) {
    if (this.view) this.view.webview.postMessage(msg);
  }

  schedule() {
    const cfg = readConfig();
    if (!cfg.autoUpdate) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.update(false); }, 70);
  }

  update(force) {
    if (!this.view || !this.view.visible) return;
    if (this.pinned && !force) return;
    if (this.pinned && force && this.last) { this.post(this.last); return; }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.post({ type: 'empty', reason: 'Open a file and put the cursor on a formula.' });
      return;
    }

    const cfg = readConfig(editor.document);
    const sel = editor.selection;
    const win = windowAround(editor.document, sel);
    let selStart = editor.document.offsetAt(sel.start) - win.base;
    let selEnd = editor.document.offsetAt(sel.end) - win.base;
    if (selEnd - selStart > MAX_SELECTION) selEnd = selStart + MAX_SELECTION;

    // Values read from assignments above the cursor. Cheap, so it happens up
    // front; the debugger's values, if any, arrive afterwards and win.
    let values = null;
    if (cfg.substituteValues) {
      try {
        values = collectValues(valueWindow(editor.document, sel),
          editor.document.languageId, cfg);
      } catch (err) {
        values = null;
      }
    }

    const run = (vals) => {
      return analyze(win.text, { start: selStart, end: selEnd },
        editor.document.languageId,
        Object.assign({}, cfg, { base: win.base, values: vals }));
    };

    let payload;
    try {
      payload = run(values);
    } catch (err) {
      this.post({ type: 'empty', reason: 'Pretty Math could not read this text: ' + err.message });
      return;
    }

    const debugging = cfg.substituteValues && !!vscode.debug.activeDebugSession;
    this.last = {
      type: 'render',
      uri: editor.document.uri.toString(),
      fileName: editor.document.fileName.split(/[\\/]/).pop(),
      language: payload.language,
      statements: payload.statements,
      cursor: editor.document.offsetAt(sel.active),
      selection: { start: editor.document.offsetAt(sel.start), end: editor.document.offsetAt(sel.end) },
      fontSize: cfg.fontSize,
      showLatex: cfg.showLatex,
      showTree: cfg.showTree,
      substituting: cfg.substituteValues,
      valueSource: cfg.substituteValues
        ? (debugging ? 'debugger' : (values && Object.keys(values).length ? 'file' : 'none'))
        : null,
      pinned: this.pinned
    };
    this.post(this.last);

    if (debugging) this.enrichFromDebugger(payload, values, run, cfg);
  }

  // Asks a paused debug session what the names in this statement are worth, and
  // redraws with those values. Runs after the first paint, so the panel never
  // waits on the debug adapter.
  enrichFromDebugger(payload, fileValues, run, cfg) {
    const frameId = pausedFrameId();
    const session = vscode.debug.activeDebugSession;
    if (frameId === null || !session) return;

    const wanted = [];
    payload.statements.forEach(function (st) {
      (st.names || []).forEach(function (n) {
        if (wanted.indexOf(n) === -1 && wanted.length < MAX_LIVE_LOOKUPS) wanted.push(n);
      });
    });
    if (!wanted.length) return;

    const token = ++this.liveToken;
    const asked = {};
    Promise.all(wanted.map(function (name) {
      return Promise.resolve(
        session.customRequest('evaluate', { expression: name, frameId: frameId, context: 'watch' })
      ).then(function (reply) {
        if (reply && typeof reply.result === 'string') asked[name] = reply.result;
      }, function () { /* not in scope in this frame */ });
    })).then(() => {
      // The cursor may have moved on while the adapter was thinking.
      if (token !== this.liveToken || !this.view || !this.view.visible || this.pinned) return;
      const live = valuesFromDebugger(asked, cfg.valueDigits);
      if (!Object.keys(live).length) return;
      let updated;
      try {
        updated = run(Object.assign({}, fileValues || {}, live));
      } catch (err) {
        return;
      }
      this.last = Object.assign({}, this.last, {
        statements: updated.statements,
        valueSource: 'debugger'
      });
      this.post(this.last);
    }, function () { /* the session went away */ });
  }

  html(webview) {
    const nonce = String(Math.random()).slice(2) + Date.now().toString(36);
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.js'));
    const csp = "default-src 'none'; style-src " + webview.cspSource +
      "; font-src " + webview.cspSource + " data:; img-src " + webview.cspSource +
      " data:; script-src 'nonce-" + nonce + "';";

    return '<!DOCTYPE html><html lang="en"><head>' +
      '<meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<link rel="stylesheet" href="' + css + '">' +
      '<title>Pretty Math</title></head><body>' +
      '<div id="bar">' +
      '<span id="where"></span>' +
      '<span class="spacer"></span>' +
      '<button id="smaller" title="Smaller">A-</button>' +
      '<button id="bigger" title="Bigger">A+</button>' +
      '<button id="values" title="Plug in what the variables are worth, from the file or from a paused debug session">Values</button>' +
      '<button id="showtex" title="Show the LaTeX under each expression">LaTeX</button>' +
      '<button id="tex" title="Copy this expression as LaTeX">Copy</button>' +
      '<button id="pin" title="Freeze the panel on this expression">Pin</button>' +
      '</div>' +
      '<div id="content"><p class="hint">Put the cursor on a line with a formula.</p></div>' +
      '<script nonce="' + nonce + '" src="' + js + '"></script>' +
      '</body></html>';
  }
}

function activate(context) {
  const provider = new PrettyMathView(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('prettyMath.view', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.onDidChangeTextEditorSelection(function () { provider.schedule(); }),
    vscode.window.onDidChangeActiveTextEditor(function () { provider.schedule(); }),
    vscode.workspace.onDidChangeTextDocument(function (e) {
      const editor = vscode.window.activeTextEditor;
      if (editor && e.document === editor.document) provider.schedule();
    }),
    vscode.workspace.onDidChangeConfiguration(function (e) {
      if (e.affectsConfiguration('prettyMath')) provider.update(true);
    }),
    vscode.commands.registerCommand('prettyMath.show', function () {
      return vscode.commands.executeCommand('prettyMath.view.focus');
    }),
    vscode.commands.registerCommand('prettyMath.pin', function () {
      provider.setPinned(!provider.pinned);
    }),
    vscode.commands.registerCommand('prettyMath.copyLatex', function () {
      provider.copyLatex();
    }),
    vscode.commands.registerCommand('prettyMath.toggleValues', function () {
      const c = vscode.workspace.getConfiguration('prettyMath');
      return c.update('substituteValues', !c.get('substituteValues', false),
        vscode.ConfigurationTarget.Global);
    })
  );

  // While stepping, the values change under a stationary cursor.
  if (vscode.debug.onDidChangeActiveStackItem) {
    context.subscriptions.push(
      vscode.debug.onDidChangeActiveStackItem(function () { provider.update(true); })
    );
  }
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(function () { provider.update(true); }),
    vscode.debug.onDidStartDebugSession(function () { provider.update(true); })
  );
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate };
