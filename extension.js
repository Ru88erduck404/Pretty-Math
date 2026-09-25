'use strict';

const vscode = require('vscode');
const { analyze } = require('./src/pretty');
const { collectValues, valuesFromDebugger, mathAliases } = require('./src/values');
const { formatNumber } = require('./src/evaluate');
const { readKernelValues } = require('./src/jupyter');

// How much text around the cursor is scanned. Big enough for any wrapped
// formula, small enough that a huge file costs nothing per keystroke.
const WINDOW_LINES = 80;
const MAX_SELECTION = 20000;
// How far back to look for what the variables hold.
const VALUE_LINES = 500;
// A cap on how many variables one statement asks the debugger about.
const MAX_LIVE_LOOKUPS = 40;
// How long to wait for a debug adapter before giving up on live values.
const LIVE_TIMEOUT_MS = 1500;
// How long a kernel's answers are reused, and the floor on how often it may be
// disturbed. Someone scrolling a notebook must not become a stream of kernel
// executions.
const KERNEL_TTL_MS = 2000;
const KERNEL_MIN_GAP_MS = 750;

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
    jupyterValues: c.get('jupyterValues', false),
    valueScanLines: VALUE_LINES
  };
}

// The notebook a cell belongs to, if this document is a cell at all.
function notebookFor(doc) {
  if (!doc || !doc.uri || doc.uri.scheme !== 'vscode-notebook-cell') return null;
  const books = vscode.workspace.notebookDocuments || [];
  for (let i = 0; i < books.length; i++) {
    const cells = books[i].getCells();
    for (let k = 0; k < cells.length; k++) {
      if (cells[k].document === doc) return { notebook: books[i], index: cells[k].index };
    }
  }
  return null;
}

// The text above the cursor that assignments are read from. In a notebook the
// variables were defined in earlier cells, which are separate documents, so
// those have to be gathered too or nothing is ever known.
function valueWindow(doc, selection) {
  const first = Math.max(0, selection.start.line - VALUE_LINES);
  const range = new vscode.Range(first, 0, selection.start.line,
    doc.lineAt(selection.start.line).text.length);
  const here = doc.getText(range);

  const cell = notebookFor(doc);
  if (!cell) return here;

  const earlier = [];
  cell.notebook.getCells().forEach(function (c) {
    if (c.index >= cell.index) return;
    if (c.kind !== vscode.NotebookCellKind.Code) return;
    earlier.push(c.document.getText());
  });
  earlier.push(here);
  return earlier.join('\n');
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
    this.liveKey = null;       // frame + names the cached answers belong to
    this.liveAnswers = null;
    this.livePending = null;   // a lookup already in flight for that key
    this.kernelCache = null;   // { book, at, asked, values } for a notebook
    this.kernelPending = null;
    this.kernelProbedAt = 0;
    this.lastUri = null;       // the editor the last drawing came from
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

  // The editor the last drawing came from, while it is still open.
  rememberedEditor() {
    if (!this.lastUri) return null;
    const uri = this.lastUri;
    return (vscode.window.visibleTextEditors || []).find(function (e) {
      return e.document.uri.toString() === uri;
    }) || null;
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

    // Clicking a button in the panel takes focus out of the editor, and with a
    // notebook cell that can leave activeTextEditor undefined for a moment.
    // Wiping the panel then would look exactly like a crash, so the editor the
    // last drawing came from is used until a real one takes over.
    const editor = vscode.window.activeTextEditor || this.rememberedEditor();
    if (!editor) {
      this.post({ type: 'empty', reason: 'Open a file and put the cursor on a formula.' });
      return;
    }
    this.lastUri = editor.document.uri.toString();

    const cfg = readConfig(editor.document);
    const sel = editor.selection;
    const win = windowAround(editor.document, sel);

    // Everything above the cursor, including earlier notebook cells. Used both
    // for the qualifiers the file declares and for what the variables hold.
    let above = '';
    try {
      above = valueWindow(editor.document, sel);
    } catch (err) {
      above = '';
    }

    // `cn.R` reads as R after `from scipy import constants as cn`. Only maths
    // modules qualify: dropping `os.` or `pd.` would misrepresent the call.
    try {
      const aliases = mathAliases(above).filter(function (a) {
        return cfg.stripNamespaces.indexOf(a) === -1;
      });
      if (aliases.length) cfg.stripNamespaces = cfg.stripNamespaces.concat(aliases);
    } catch (err) {
      // not worth failing a drawing over
    }

    let selStart = editor.document.offsetAt(sel.start) - win.base;
    let selEnd = editor.document.offsetAt(sel.end) - win.base;
    if (selEnd - selStart > MAX_SELECTION) selEnd = selStart + MAX_SELECTION;

    // Values read from assignments above the cursor. Cheap, so it happens up
    // front; the debugger's values, if any, arrive afterwards and win.
    let values = null;
    if (cfg.substituteValues) {
      try {
        values = collectValues(above, editor.document.languageId, cfg);
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

    const cell = notebookFor(editor.document);
    const debugging = cfg.substituteValues && !!vscode.debug.activeDebugSession;
    const askingKernel = cfg.substituteValues && cfg.jupyterValues && !!cell && !debugging;
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
    else if (askingKernel) this.enrichFromKernel(payload, values, run, cfg, cell);
  }

  // Asks the notebook's kernel what the names in this statement hold. Like the
  // debugger path this runs after the first paint, so nothing waits on it.
  enrichFromKernel(payload, fileValues, run, cfg, cell) {
    const wanted = [];
    payload.statements.forEach(function (st) {
      (st.names || []).forEach(function (n) {
        if (wanted.indexOf(n) === -1 && wanted.length < MAX_LIVE_LOOKUPS) wanted.push(n);
      });
    });
    if (!wanted.length) return;

    // Someone moving the cursor around a notebook must not turn into a stream
    // of kernel executions. Answers are remembered per notebook for a couple of
    // seconds, and a name already asked about is not asked again within that
    // window even if it had no value. Between probes there is a floor on how
    // often the kernel can be disturbed at all.
    const book = cell.notebook.uri.toString();
    const now = Date.now();
    const cache = this.kernelCache;
    const fresh = cache && cache.book === book && (now - cache.at) < KERNEL_TTL_MS;

    if (fresh && wanted.every(function (n) { return cache.asked.indexOf(n) >= 0; })) {
      this.applyKernelValues(cache.values, fileValues, run, cfg);
      return;
    }
    if (this.kernelPending) return;
    if (now - this.kernelProbedAt < KERNEL_MIN_GAP_MS) {
      if (fresh) this.applyKernelValues(cache.values, fileValues, run, cfg);
      return;
    }

    // Ask about everything still fresh as well, so the cache keeps growing
    // rather than thrashing between two lines.
    const ask = fresh
      ? cache.asked.concat(wanted.filter(function (n) { return cache.asked.indexOf(n) < 0; }))
          .slice(0, MAX_LIVE_LOOKUPS)
      : wanted;

    this.kernelPending = book;
    this.kernelProbedAt = now;

    const token = ++this.liveToken;
    const source = new vscode.CancellationTokenSource();
    const give_up = setTimeout(function () { source.cancel(); }, LIVE_TIMEOUT_MS);

    Promise.resolve()
      .then(() => {
        const jup = vscode.extensions.getExtension('ms-toolsai.jupyter');
        if (!jup) return null;
        return jup.isActive ? jup.exports : jup.activate();
      })
      .then((api) => {
        if (!api) return null;
        return readKernelValues(api, cell.notebook.uri, ask, { token: source.token });
      })
      .then((numbers) => {
        clearTimeout(give_up);
        this.kernelPending = null;
        // Remember what was asked even when nothing came back, so a notebook
        // full of arrays is not re-probed on every keystroke.
        this.kernelCache = { book: book, at: Date.now(), asked: ask, values: numbers || {} };
        if (!numbers || token !== this.liveToken) return;
        if (!this.view || !this.view.visible || this.pinned) return;
        this.applyKernelValues(numbers, fileValues, run, cfg);
      })
      .catch(() => {
        clearTimeout(give_up);
        this.kernelPending = null;
      });
  }

  applyKernelValues(numbers, fileValues, run, cfg) {
    const live = {};
    Object.keys(numbers).forEach(function (name) {
      const shown = formatNumber(numbers[name], cfg.valueDigits);
      if (shown !== null) live[name] = { num: numbers[name], text: shown, live: true };
    });
    if (!Object.keys(live).length) return;
    let updated;
    try {
      updated = run(Object.assign({}, fileValues || {}, live));
    } catch (err) {
      return;
    }
    this.last = Object.assign({}, this.last, {
      statements: updated.statements,
      valueSource: 'kernel'
    });
    this.post(this.last);
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

    // Asking the adapter the same question again on every cursor move floods a
    // slow debug session for no new information. The answers only change when
    // the frame does, so they are cached against it.
    const key = frameId + '|' + wanted.join(',');
    if (this.liveKey === key && this.liveAnswers) {
      this.applyLiveValues(this.liveAnswers, fileValues, run, cfg);
      return;
    }
    if (this.livePending === key) return;
    this.livePending = key;

    const token = ++this.liveToken;
    const asked = {};
    const lookups = Promise.all(wanted.map(function (name) {
      return Promise.resolve(
        session.customRequest('evaluate', { expression: name, frameId: frameId, context: 'watch' })
      ).then(function (reply) {
        if (reply && typeof reply.result === 'string') asked[name] = reply.result;
      }, function () { /* not in scope in this frame */ });
    }));
    // A debug adapter that never answers must not leave this hanging.
    const timeout = new Promise(function (resolve) { setTimeout(resolve, LIVE_TIMEOUT_MS); });
    Promise.race([lookups, timeout]).then(() => {
      this.livePending = null;
      // The cursor may have moved on while the adapter was thinking.
      if (token !== this.liveToken || !this.view || !this.view.visible || this.pinned) return;
      this.liveKey = key;
      this.liveAnswers = asked;
      this.applyLiveValues(asked, fileValues, run, cfg);
    }, () => { this.livePending = null; });
  }

  applyLiveValues(asked, fileValues, run, cfg) {
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
      vscode.debug.onDidChangeActiveStackItem(function () {
        provider.liveKey = null;      // a new frame means new answers
        provider.liveAnswers = null;
        provider.update(true);
      })
    );
  }
  context.subscriptions.push(
    vscode.debug.onDidTerminateDebugSession(function () { provider.update(true); }),
    vscode.debug.onDidStartDebugSession(function () { provider.update(true); })
  );

  // Running a cell changes what the kernel holds, so anything remembered from
  // it is stale.
  if (vscode.workspace.onDidChangeNotebookDocument) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeNotebookDocument(function () {
        provider.kernelCache = null;
        provider.schedule();
      })
    );
  }
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate };
