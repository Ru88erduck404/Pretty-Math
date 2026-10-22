'use strict';

// Runs extension.js against a stubbed VS Code API: activation, the webview
// handshake, a cursor move, and the hover/reveal round trip.

const Module = require('module');
const path = require('path');

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = expected instanceof RegExp ? expected.test(String(actual)) : actual === expected;
  if (ok) { pass++; return; }
  fail++;
  console.log('FAIL  ' + name);
  console.log('  expected: ' + expected);
  console.log('  actual:   ' + actual);
}

// ------------------------------------------------------------------- stubs

const DEFAULTS = {
  autoUpdate: true, fontSize: 20, caretMeansPower: 'auto', multiplication: 'implicit',
  indexAsSubscript: true, greekLetters: true, expandIdentities: true,
  stripNamespaces: ['Math', 'math', 'np', 'self', 'this'],
  showLatex: false, showTree: false, maxLines: 40
};

function Position(line, character) { this.line = line; this.character = character; }
function Range(a, b, c, d) {
  if (a instanceof Position) { this.start = a; this.end = b; }
  else { this.start = new Position(a, b); this.end = new Position(c, d); }
}
function Selection(start, end) { Range.call(this, start, end); this.active = end; }

function makeDocument(text, languageId, scheme) {
  const lines = text.split('\n');
  const starts = [];
  let at = 0;
  lines.forEach(function (l) { starts.push(at); at += l.length + 1; });
  return {
    languageId: languageId,
    lineCount: lines.length,
    fileName: 'C:/tmp/sample.' + (languageId === 'python' ? 'py' : 'js'),
    uri: {
      scheme: scheme || 'file',
      toString: function () { return (scheme || 'file') + ':///tmp/sample/' + lines.length + '/' + text.length; }
    },
    lineAt: function (n) { return { text: lines[n], lineNumber: n }; },
    applyEdit: function (range, text) {
      const l = range.start.line;
      lines[l] = lines[l].slice(0, range.start.character) + text +
        lines[l].slice(range.end.character);
      this.lineCount = lines.length;
    },
    offsetAt: function (p) { return starts[p.line] + p.character; },
    positionAt: function (o) {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (o >= starts[i]) return new Position(i, o - starts[i]);
      }
      return new Position(0, 0);
    },
    getText: function (range) {
      if (!range) return text;
      return text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
    }
  };
}

const listeners = {};
function eventStub(name) {
  return function (fn) { listeners[name] = fn; return { dispose: function () {} }; };
}

const decorations = [];
const completionProviders = [];
const commandHandlers = {};
const posted = [];
let clipboard = '';
const extensionStubs = {};

const edits = [];
const editor = {
  document: null,
  selection: null,
  viewColumn: 1,
  setDecorations: function (type, ranges) { decorations.push({ type: type, ranges: ranges }); },
  revealRange: function () {},
  // Collects what an edit would do, and applies it to the stub document so
  // that the next assertion sees the text the user would see.
  edit: function (fn) {
    const made = [];
    fn({
      replace: function (range, text) { made.push({ range: range, text: text }); }
    });
    made.forEach(function (m) { edits.push(m); });
    if (made.length && editor.document && editor.document.applyEdit) {
      made.slice().reverse().forEach(function (m) { editor.document.applyEdit(m.range, m.text); });
    }
    return Promise.resolve(true);
  }
};

const vscodeStub = {
  Position: Position,
  Range: Range,
  Selection: Selection,
  Uri: { joinPath: function () { return { path: Array.prototype.slice.call(arguments, 1).join('/') }; } },
  ThemeColor: function (id) { this.id = id; },
  ConfigurationTarget: { Global: 1 },
  CompletionItemKind: { Constant: 20 },
  CompletionItem: function (label, kind) { this.label = label; this.kind = kind; },
  languages: {
    registerCompletionItemProvider: function (selector, provider) {
      completionProviders.push(provider);
      return { dispose: function () {} };
    }
  },
  TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
  env: { clipboard: { writeText: function (t) { clipboard = t; return Promise.resolve(); } } },
  commands: {
    registerCommand: function (name, fn) {
      commandHandlers[name] = fn;
      return { dispose: function () {} };
    },
    executeCommand: function () { return Promise.resolve(); }
  },
  workspace: {
    getConfiguration: function () {
      return {
        get: function (key, fallback) {
          return Object.prototype.hasOwnProperty.call(DEFAULTS, key) ? DEFAULTS[key] : fallback;
        },
        update: function () { return Promise.resolve(); }
      };
    },
    onDidChangeTextDocument: eventStub('change'),
    onDidChangeConfiguration: eventStub('config'),
    onDidChangeNotebookDocument: eventStub('notebookChange'),
    notebookDocuments: []
  },
  debug: {
    activeDebugSession: null,
    activeStackItem: undefined,
    onDidChangeActiveStackItem: eventStub('stackItem'),
    onDidStartDebugSession: eventStub('debugStart'),
    onDidTerminateDebugSession: eventStub('debugEnd')
  },
  extensions: {
    getExtension: function (id) { return extensionStubs[id] || undefined; }
  },
  NotebookCellKind: { Markup: 1, Code: 2 },
  CancellationTokenSource: function () {
    this.token = { isCancellationRequested: false };
    this.cancel = function () { this.token.isCancellationRequested = true; };
  },
  window: {
    get activeTextEditor() { return editor; },
    visibleTextEditors: [editor],
    createTextEditorDecorationType: function (o) { return { key: 'deco', options: o }; },
    registerWebviewViewProvider: function () { return { dispose: function () {} }; },
    onDidChangeTextEditorSelection: eventStub('selection'),
    onDidChangeActiveTextEditor: eventStub('activeEditor'),
    showTextDocument: function () { return Promise.resolve(); },
    showInformationMessage: function () {},
    setStatusBarMessage: function () {}
  }
};

const realLoad = Module._load;
Module._load = function (request) {
  if (request === 'vscode') return vscodeStub;
  return realLoad.apply(this, arguments);
};

// ------------------------------------------------------------------- drive

const extension = require(path.join(__dirname, '..', 'extension.js'));

const subscriptions = [];
const context = {
  subscriptions: subscriptions,
  extensionUri: { path: '/ext' }
};

extension.activate(context);
check('activation registers listeners', typeof listeners.selection, 'function');
check('activation registers disposables', subscriptions.length > 5, true);

// The provider is the object handed to registerWebviewViewProvider; grab it the
// same way VS Code would, by resolving a view.
const provider = subscriptions.length ? null : null;
const { analyze } = require('../src/pretty');

// Rebuild the provider through the module's own class by re-registering.
let captured = null;
vscodeStub.window.registerWebviewViewProvider = function (id, p) {
  captured = p;
  return { dispose: function () {} };
};
extension.activate(context);
check('provider captured', !!captured, true);

const view = {
  visible: true,
  webview: {
    options: null,
    html: '',
    cspSource: 'vscode-webview://x',
    asWebviewUri: function (u) { return 'vscode-resource:' + u.path; },
    postMessage: function (m) { posted.push(m); return Promise.resolve(true); },
    onDidReceiveMessage: function (fn) { this._onMessage = fn; return { dispose: function () {} }; }
  },
  onDidChangeVisibility: function () { return { dispose: function () {} }; },
  onDidDispose: function () { return { dispose: function () {} }; }
};

// A long file so the cursor sits well past the scanned window's start.
const filler = new Array(200).join('# padding line\n');
const code = filler + 'speed = distance / (t_end - t_start)\nother = 1\n';
editor.document = makeDocument(code, 'python');
const line = filler.split('\n').length - 1;
editor.selection = new Selection(new Position(line, 4), new Position(line, 4));

captured.resolveWebviewView(view);

check('webview scripts enabled', view.webview.options.enableScripts, true);
check('webview html has a CSP', /Content-Security-Policy/.test(view.webview.html), true);
check('webview html loads the panel script', /panel\.js/.test(view.webview.html), true);
check('webview html has a Checks button', /id="checks"/.test(view.webview.html), true);

const render = posted.filter(function (m) { return m.type === 'render'; }).pop();
check('a render was posted', !!render, true);
check('one statement found', render.statements.length, 1);
check('statement text', render.statements[0].source, 'speed = distance / (t_end - t_start)');

// Offsets must address the real file, not the scanned window.
const st = render.statements[0];
check('docStart lands on the statement', code.slice(st.docStart, st.docStart + 5), 'speed');
const m = /data-s="(\d+)" data-e="(\d+)"[^>]*><span class="pm-name">distance/.exec(st.html);
check('a node maps back to its source text', m && code.slice(Number(m[1]), Number(m[2])), 'distance');

// Hovering a node highlights that exact range in the editor.
view.webview._onMessage({ type: 'hover', s: Number(m[1]), e: Number(m[2]) });
const deco = decorations.pop();
check('hover sets one decoration', deco.ranges.length, 1);
check('decoration covers the token',
  code.slice(editor.document.offsetAt(deco.ranges[0].start), editor.document.offsetAt(deco.ranges[0].end)),
  'distance');

view.webview._onMessage({ type: 'hover', s: null, e: null });
check('leaving clears decorations', decorations.pop().ranges.length, 0);

// Clicking selects it in the editor.
view.webview._onMessage({ type: 'reveal', s: Number(m[1]), e: Number(m[2]) });
check('reveal moves the selection',
  code.slice(editor.document.offsetAt(editor.selection.start), editor.document.offsetAt(editor.selection.end)),
  'distance');

// Copy LaTeX.
view.webview._onMessage({ type: 'copyLatex' });
check('latex copied', clipboard, '\\mathrm{speed} = \\frac{\\mathrm{distance}}{t_{\\mathrm{end}} - t_{\\mathrm{start}}}');

// ---- math input ------------------------------------------------------------

// Typing, as the extension host sees it: a change event for the one character
// that was pressed, and whatever the extension does about it.
function type(doc, line, column, character) {
  editor.document = doc;
  editor.selection = new Selection(new Position(line, column), new Position(line, column));
  listeners.change({
    document: doc,
    contentChanges: [{
      text: character,
      rangeLength: 0,
      range: new Range(new Position(line, column), new Position(line, column))
    }]
  });
}

DEFAULTS.mathInput = true;
let mathDoc = makeDocument('E = m\\cdot', 'python');
type(mathDoc, 0, 10, ' ');
check('a name becomes a symbol when a space ends it',
  mathDoc.lineAt(0).text, 'E = m·');

// The space was only a delimiter and goes with the name; any other character
// was meant and stays.
mathDoc = makeDocument('a\\alpha+b', 'python');
type(mathDoc, 0, 7, '+');
check('another character ends the name and remains',
  mathDoc.lineAt(0).text, 'aα+b');

// A letter cannot end a name, or \\leq could never be typed.
mathDoc = makeDocument('\\le', 'python');
type(mathDoc, 0, 3, 'q');
check('a letter does not end a name', mathDoc.lineAt(0).text, '\\le');

// Switched off, nothing is touched at all.
DEFAULTS.mathInput = false;
mathDoc = makeDocument('x\\alpha', 'python');
type(mathDoc, 0, 7, ' ');
check('nothing is rewritten while math input is off',
  mathDoc.lineAt(0).text, 'x\\alpha');
DEFAULTS.mathInput = true;

// Completions are offered for what has been typed so far, and only after a
// backslash.
check('a completion provider is registered', completionProviders.length > 0, true);
const completions = completionProviders[0].provideCompletionItems(
  makeDocument('x = \\alp', 'python'), new Position(0, 8));
check('completions are offered for a half-typed name', completions.length > 0, true);
check('the first one is the letter itself', completions[0].insertText, 'α');
check('and it replaces the backslash too', completions[0].range.start.character, 4);
check('nothing is offered without a backslash',
  completionProviders[0].provideCompletionItems(
    makeDocument('x = alp', 'python'), new Position(0, 7)), undefined);

// Alt+M on a line of Python writes Unicode, because a backslash in a .py file
// is read as a backslash.
const formatCmd = commandHandlers['prettyMath.formatAsMath'];
check('the format command is registered', typeof formatCmd, 'function');

let fmtDoc = makeDocument('E = m*c^2', 'python');
editor.document = fmtDoc;
editor.selection = new Selection(new Position(0, 0), new Position(0, 0));
editor.selections = [editor.selection];
formatCmd();
check('a code line becomes unicode', fmtDoc.lineAt(0).text, 'E = m·c²');

// The same line in a notebook's markdown cell becomes LaTeX, which is what
// that cell will actually render.
fmtDoc = makeDocument('int(x^2, x = 0 .. 1)', 'markdown');
editor.document = fmtDoc;
editor.selection = new Selection(new Position(0, 0), new Position(0, 0));
editor.selections = [editor.selection];
formatCmd();
check('a markdown cell becomes latex', fmtDoc.lineAt(0).text,
  '$$\n\\int_{0}^{1} x^{2}\\,\\mathrm{d}x\n$$');

// Prose is left exactly as it was.
fmtDoc = makeDocument('the quick brown fox', 'markdown');
editor.document = fmtDoc;
editor.selection = new Selection(new Position(0, 0), new Position(0, 0));
editor.selections = [editor.selection];
formatCmd();
check('prose is left alone', fmtDoc.lineAt(0).text, 'the quick brown fox');

delete DEFAULTS.mathInput;
editor.selections = undefined;

// ---- checks ----------------------------------------------------------------

// The whole path, as the extension runs it: units are read from the file above
// the cursor, and the remark comes back in the payload the panel draws from.
const checkDoc = [
  'from scipy import constants as cn',
  'T = 300  # K',
  'P = 2.0 * cn.bar',
  'total = P + T',
  ''
].join('\n');
editor.document = makeDocument(checkDoc, 'python');
editor.selection = new Selection(new Position(3, 3), new Position(3, 3));
captured.update(true);
let checked = posted.filter(function (m) { return m.type === 'render'; }).pop();
check('the panel is told checks are on', checked.checking, true);
check('a unit mismatch is reported', (checked.statements[0].checks || []).length, 1);
check('and it says which two quantities',
  (checked.statements[0].checks[0] || {}).message, /Pa and K/);
check('the remark points back into the document',
  checkDoc.slice(checked.statements[0].checks[0].docStart,
    checked.statements[0].checks[0].docEnd), 'P + T');

// A formula that is right gets no remark, which is the common case.
editor.document = makeDocument(checkDoc.replace('total = P + T', 'total = P * T'), 'python');
captured.update(true);
checked = posted.filter(function (m) { return m.type === 'render'; }).pop();
check('a sound formula is met with silence',
  (checked.statements[0].checks || []).length, 0);

// Switched off, nothing is reported and the panel knows why it is quiet.
DEFAULTS.showChecks = false;
editor.document = makeDocument(checkDoc, 'python');
captured.update(true);
checked = posted.filter(function (m) { return m.type === 'render'; }).pop();
check('nothing is checked once switched off',
  (checked.statements[0].checks || []).length, 0);
check('and the button is told', checked.checking, false);
delete DEFAULTS.showChecks;

// ---- variable values -------------------------------------------------------

// Off by default: no value is drawn even though the file defines one.
const valueDoc = 'mass = 4\nspeed = 3\nenergy = mass * speed\ntail = 1\n';
editor.document = makeDocument(valueDoc, 'python');
editor.selection = new Selection(new Position(2, 2), new Position(2, 2));
captured.update(true);
let shown = posted.filter(function (m) { return m.type === 'render'; }).pop();
check('values off by default', /pm-value/.test(shown.statements[0].html), false);
check('button state reported as off', shown.substituting, false);

// The button toggles the setting, which is what the extension reads.
DEFAULTS.substituteValues = true;
captured.update(true);
shown = posted.filter(function (m) { return m.type === 'render'; }).pop();
check('values drawn once switched on', /class="pm-value"/.test(shown.statements[0].html), true);
check('the file is named as the source', shown.valueSource, 'file');
check('both variables substituted',
  (shown.statements[0].html.match(/class="pm-value"/g) || []).length, 2);

// A paused debug session overrides the file, and marks the values as live.
let evaluated = [];
vscodeStub.debug.activeDebugSession = {
  customRequest: function (kind, args) {
    evaluated.push(args.expression);
    if (kind !== 'evaluate') return Promise.reject(new Error('unsupported'));
    if (args.frameId !== 7) return Promise.reject(new Error('wrong frame'));
    const live = { mass: '10.5', speed: 'array([1, 2])' };
    return Object.prototype.hasOwnProperty.call(live, args.expression)
      ? Promise.resolve({ result: live[args.expression] })
      : Promise.reject(new Error('not in scope'));
  }
};
vscodeStub.debug.activeStackItem = { frameId: 7, threadId: 1 };
captured.update(true);

setTimeout(function () {
  const afterDebug = posted.filter(function (m) { return m.type === 'render'; }).pop();
  check('the debugger is asked about the names read',
    evaluated.sort().join(','), 'mass,speed');
  check('live values are used', /10\.5/.test(afterDebug.statements[0].html), true);
  check('live values are marked', /pm-value-live/.test(afterDebug.statements[0].html), true);
  check('the debugger is named as the source', afterDebug.valueSource, 'debugger');
  check('a non-numeric live value falls back to the file value',
    /class="pm-value"[^>]*>3</.test(afterDebug.statements[0].html), true);

  vscodeStub.debug.activeDebugSession = null;
  vscodeStub.debug.activeStackItem = undefined;
  DEFAULTS.substituteValues = false;
  editor.document = makeDocument(code, 'python');
  editor.selection = new Selection(new Position(line, 4), new Position(line, 4));
  rest();
}, 150);

function rest() {

// ---- notebooks -------------------------------------------------------------

// Variables live in earlier cells, which are separate documents. Reading only
// the current cell would find nothing.
const cell1 = makeDocument('import numpy as np\nT = 300\n', 'python', 'vscode-notebook-cell');
const cell2 = makeDocument('k_B = 1.380649e-23\n', 'python', 'vscode-notebook-cell');
const cell3 = makeDocument('E = k_B * T\n', 'python', 'vscode-notebook-cell');
const notebook = {
  uri: { toString: function () { return 'file:///tmp/book.ipynb'; } },
  getCells: function () {
    return [
      { index: 0, kind: 2, document: cell1 },
      { index: 1, kind: 2, document: cell2 },
      { index: 2, kind: 2, document: cell3 }
    ];
  }
};
vscodeStub.workspace.notebookDocuments = [notebook];

DEFAULTS.substituteValues = true;
DEFAULTS.jupyterValues = false;
editor.document = cell3;
editor.selection = new Selection(new Position(0, 3), new Position(0, 3));
captured.update(true);
let nb = posted.filter(function (m) { return m.type === 'render'; }).pop();
check('a notebook cell reads the cells above it', nb.valueSource, 'file');
check('a value from an earlier cell is used',
  /1\.38\d*e-23/.test(nb.statements[0].html), true);
check('and one from the cell before that too', /300/.test(nb.statements[0].html), true);

// Losing the active editor must not wipe the panel: clicking the button moves
// focus, and with a notebook that can clear activeTextEditor.
const realEditor = editor.document;
let savedEditor = vscodeStub.window.activeTextEditor;
Object.defineProperty(vscodeStub.window, 'activeTextEditor', {
  configurable: true, get: function () { return undefined; }
});
vscodeStub.window.visibleTextEditors = [editor];
const beforeBlur = posted.length;
captured.update(true);
const afterBlur = posted.slice(beforeBlur);
check('no editor focused does not clear the panel',
  afterBlur.some(function (m) { return m.type === 'empty'; }), false);
check('it redraws from the remembered editor',
  afterBlur.filter(function (m) { return m.type === 'render'; }).length > 0, true);
Object.defineProperty(vscodeStub.window, 'activeTextEditor', {
  configurable: true, get: function () { return editor; }
});

// With a kernel, the values come from it instead.
let probed = null;
let probeCount = 0;
extensionStubs['ms-toolsai.jupyter'] = {
  isActive: true,
  exports: {
    kernels: {
      getKernel: function (uri) {
        return Promise.resolve({
          status: 'idle',
          executeCode: function (code) {
            probed = code;
            probeCount++;
            return (async function* () {
              yield {
                items: [{
                  mime: 'application/vnd.code.notebook.stdout',
                  data: Buffer.from('{"k_B": 1.380649e-23, "T": 301.5}\n', 'utf8')
                }]
              };
            }());
          }
        });
      }
    }
  }
};
DEFAULTS.jupyterValues = true;
captured.kernelCache = null;
captured.kernelProbedAt = 0;
captured.update(true);

setTimeout(function () {
  const afterKernel = posted.filter(function (m) { return m.type === 'render'; }).pop();
  check('the kernel was asked about the names', /k_B/.test(probed || ''), true);
  check('the probe does not import into the namespace',
    /^print\(/.test(probed || ''), true);
  check('kernel values are used', afterKernel.valueSource, 'kernel');
  check('the kernel value wins over the file',
    /301\.5/.test(afterKernel.statements[0].html), true);

  // Moving the cursor about must not become a stream of kernel executions.
  const probesBefore = probeCount;
  captured.update(true);
  captured.update(true);
  captured.update(true);
  setTimeout(function () {
    check('repeated redraws reuse the answers rather than re-asking',
      probeCount, probesBefore);
    check('off by default for everyone else',
      require('../package.json').contributes.configuration
        .properties['prettyMath.jupyterValues'].default, false);
    afterKernelTests();
  }, 120);
}, 200);

function afterKernelTests() {

  // Back to a plain file for the remaining tests.
  extensionStubs['ms-toolsai.jupyter'] = undefined;
  vscodeStub.workspace.notebookDocuments = [];
  DEFAULTS.substituteValues = false;
  DEFAULTS.jupyterValues = true;
  editor.document = makeDocument(code, 'python');
  editor.selection = new Selection(new Position(line, 4), new Position(line, 4));
  vscodeStub.window.visibleTextEditors = [editor];
  pinTests();
}

function pinTests() {

// Pin freezes updates.
view.webview._onMessage({ type: 'pin' });
const before = posted.length;
editor.selection = new Selection(new Position(line + 1, 2), new Position(line + 1, 2));
listeners.selection({});
setTimeout(function () {
  const renders = posted.slice(before).filter(function (p) { return p.type === 'render'; });
  const changed = renders.some(function (r) { return r.statements[0].source === 'other = 1'; });
  check('pinned panel ignores cursor moves', changed, false);

  view.webview._onMessage({ type: 'pin' });   // unpin
  setTimeout(function () {
    const last = posted.filter(function (p) { return p.type === 'render'; }).pop();
    check('unpinning refreshes', last.statements[0].source, 'other = 1');

    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  }, 200);
}, 200);

}

}
