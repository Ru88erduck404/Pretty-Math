'use strict';

// Builds test/demo.html: the real panel.css and panel.js driven by real
// rendered output, so the layout can be inspected outside VS Code.

const fs = require('fs');
const path = require('path');
const { analyze } = require('../src/pretty');

const CFG = {
  multiplication: 'implicit',
  indexAsSubscript: true,
  greekLetters: true,
  expandIdentities: true,
  stripNamespaces: ['Math', 'math', 'np', 'numpy', 'cmath', 'scipy', 'torch', 'jnp',
                    'sp', 'sym', 'sympy', 'smp', 'self', 'this'],
  caretMeansPower: 'auto',
  maxLines: 40,
  fontSize: 22
};

const SAMPLES = [
  ['python', 'E = 0.5 * m * v**2'],
  ['python', 'x = (-b + math.sqrt(b**2 - 4*a*c)) / (2*a)'],
  ['python', 'sigma = 1 / (1 + math.exp(-z))'],
  ['python', 'y = a / b * c'],
  ['python', 'y = a / (b * c)'],
  ['python', 'r = 1 / (1/a + 1/b + 1/c)'],
  ['python', 'w[i] = w[i] - eta * grad[i] / (math.sqrt(v[i]) + eps)'],
  ['python', 'loss = -np.sum(y * np.log(p) + (1 - y) * np.log(1 - p)) / n'],
  ['python', 'dist = math.hypot(x2 - x1, y2 - y1)'],
  ['python', 'k = 2 * math.pi * f / c_light'],
  ['python', 'q = x if x > 0 else -x'],
  ['python', 'theta_max = math.atan2(v_y, v_x)'],
  ['python', 'n = math.log(x, 2) + math.log10(y) + math.sin(theta)**2'],
  ['python', 'ok = (0 <= i) and (i < n) and not done'],
  ['python', 'flags = a ^ b | c & d'],
  ['python', 'val = 1.5e-3 * t**2 - 9.81 / 2 * t**2'],
  ['python', 'gamma = 1 / math.sqrt(1 - (v / c)**2)'],
  ['python', 'z = np.linalg.norm(v - u) ** 2'],
  ['python', 'p_hat = counts[i] / (counts[i] + counts[j])'],
  ['python', 'self.energy = self.mass * self.speed**2 / 2'],
  ['matlab', 'y = (a^2 + b^2)^0.5;'],
  ['cpp', 'double f = (v0*t + 0.5*g*t*t) / (1 + k*k); // fall'],
  ['javascript', 'const mid = lo + (hi - lo) / 2;'],
  ['python', 'y = a + * b'],

  ['python', 'dydx = sp.diff(y, x)'],
  ['python', 'a = sp.diff(x**2 * sp.sin(x), x)'],
  ['python', 'acc = sp.diff(position, t, 2)'],
  ['python', 'mixed = sp.diff(f, x, y)'],
  ['python', 'slope = expr.diff(t)'],
  ['python', 'area = sp.integrate(x**2 + 1, (x, 0, 1))'],
  ['python', 'F = sp.integrate(f, x)'],
  ['python', 'vol = sp.integrate(f, (x, 0, 1), (y, 0, 2))'],
  ['python', 'total = np.trapz(v, t)'],
  ['python', 'eq = sp.Eq(F, m * sp.diff(x, t, 2))'],
  ['python', 's = sp.Sum(1 / n**2, (n, 1, sp.oo))'],
  ['python', 'L = sp.limit(sp.sin(x) / x, x, 0)'],
  ['python', 'd = np.diff(samples)'],

  ['python', 'ok = flags & 0xFF == 0'],
  ['c', 'ok = flags & 0xFF == 0;'],
  ['python', 'inside = 0 <= i < n'],
  ['c', 'inside = 0 <= i < n;'],
  ['cpp', 'double d = std::sqrt(dx*dx + dy*dy);'],
  ['python', 'længde = np.sqrt(bredde**2 + højde**2)'],

  ['python', 'total = sum(w[i] * x[i] for i in range(n))'],
  ['python', 'mse = sum((y[i] - p[i])**2 for i in idx if mask[i]) / len(idx)'],
  ['python', 'ok = all(abs(r) < tol for r in residuals)'],
  ['python', 'squares = [x**2 for x in points]'],
  ['python', 'g = lambda x: 1 / (1 + math.exp(-x))'],
  ['java', 'double avg = (double) sum / count;'],
  ['rust', 'let ratio = (hits as f64) / (total as f64);'],
  ['javascript', 'const scale = (x) => x * 2 / (1 + x);']
];

const FROM = Number(process.argv[2] || 0);
const TO = Number(process.argv[3] || SAMPLES.length);
const OUT = process.argv[4] || 'demo.html';

const rows = SAMPLES.slice(FROM, TO).map(function (pair) {
  const lang = pair[0];
  const src = pair[1];
  const out = analyze(src, { start: 0, end: 0 }, lang, CFG);
  const st = out.statements[0] || { html: '', source: src, latex: '', error: null };
  st.lang = lang;
  st.original = src;
  return st;
});

const payload = {
  type: 'render',
  fileName: 'demo',
  language: 'mixed',
  fontSize: CFG.fontSize,
  showLatex: true,
  showTree: false,
  cursor: -1,
  statements: rows
};

const html = [
  '<!DOCTYPE html><html><head><meta charset="utf-8">',
  '<link rel="stylesheet" href="../media/panel.css">',
  '<style>',
  ':root{',
  '--vscode-foreground:#cccccc;--vscode-editor-foreground:#d4d4d4;',
  '--vscode-panel-background:#1e1e1e;--vscode-editor-background:#1e1e1e;',
  '--vscode-panel-border:#2b2b2b;--vscode-descriptionForeground:#9d9d9d;',
  '--vscode-font-family:"Segoe UI",sans-serif;--vscode-font-size:13px;',
  '--vscode-editor-font-family:Consolas,monospace;',
  '--vscode-charts-blue:#4fa3ff;--vscode-charts-orange:#d18616;',
  '--vscode-charts-purple:#b180d7;--vscode-charts-red:#f14c4c;',
  '--vscode-charts-green:#89d185;--vscode-charts-yellow:#cca700;',
  '--vscode-errorForeground:#f48771;',
  '--vscode-editor-selectionHighlightBackground:rgba(80,120,200,.35);',
  '--vscode-textCodeBlock-background:#252526;',
  '--vscode-button-secondaryBackground:#3a3d41;--vscode-button-secondaryForeground:#fff;',
  '--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;',
  '}',
  'body{background:#1e1e1e;}',
  '</style></head><body>',
  '<div id="bar"><span id="where"></span><span class="spacer"></span>',
  '<button id="smaller">A-</button><button id="bigger">A+</button>',
  '<button id="showtex">LaTeX</button><button id="tex">Copy</button>',
  '<button id="pin">Pin</button></div>',
  '<div id="content"></div>',
  '<script src="../media/panel.js"></script>',
  '<script>window.postMessage(' + JSON.stringify(payload).replace(/</g, '\\u003c') + ', "*");</script>',
  '</body></html>'
].join('\n');

const out = path.join(__dirname, OUT);
fs.writeFileSync(out, html, 'utf8');
console.log('wrote ' + out + ' (' + rows.length + ' samples, ' +
  rows.filter(function (r) { return r.error; }).length + ' with errors)');
