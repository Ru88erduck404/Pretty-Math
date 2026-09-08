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

function makeDocument(text, languageId) {
  const lines = text.split('\n');
  const starts = [];
  let at = 0;
  lines.forEach(function (l) { starts.push(at); at += l.length + 1; });
  return {
    languageId: languageId,
    lineCount: lines.length,
    fileName: 'C:/tmp/sample.' + (languageId === 'python' ? 'py' : 'js'),
    uri: { toString: function () { return 'file:///tmp/sample'; } },
    lineAt: function (n) { return { text: lines[n] }; },
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
const posted = [];
let clipboard = '';

const editor = {
  document: null,
  selection: null,
  viewColumn: 1,
  setDecorations: function (type, ranges) { decorations.push({ type: type, ranges: ranges }); },
  revealRange: function () {}
};

const vscodeStub = {
  Position: Position,
  Range: Range,
  Selection: Selection,
  Uri: { joinPath: function () { return { path: Array.prototype.slice.call(arguments, 1).join('/') }; } },
  ThemeColor: function (id) { this.id = id; },
  ConfigurationTarget: { Global: 1 },
  TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
  env: { clipboard: { writeText: function (t) { clipboard = t; return Promise.resolve(); } } },
  commands: {
    registerCommand: function () { return { dispose: function () {} }; },
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
    onDidChangeConfiguration: eventStub('config')
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
