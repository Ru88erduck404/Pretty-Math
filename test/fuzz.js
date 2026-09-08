'use strict';

// Property-based fuzzing with a fixed seed, so a failure is reproducible.
//
// Expressions are generated from a grammar for the target language, then half
// of them are corrupted, and the invariants below are checked for every case:
//
//   * analyze() never throws and never hangs
//   * a parse error always carries a position inside the document
//   * rendered HTML has balanced spans and no undefined/NaN leaking through
//   * every node's source range lies inside the document, is non-empty, and is
//     contained by its parent's range -- this is what makes hover highlighting
//     and click-to-select trustworthy

const { analyze } = require('../src/pretty');

const CFG = {
  multiplication: 'implicit', indexAsSubscript: true, greekLetters: true,
  expandIdentities: true, derivativeSymbol: 'auto', maxLines: 40,
  stripNamespaces: ['math', 'np', 'sp', 'self']
};
const LANGS = ['python', 'javascript', 'c', 'cpp', 'java', 'rust', 'julia'];

let seed = Number(process.env.PRETTY_MATH_SEED || 20260908);
const startingSeed = seed;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(a) { return a[Math.floor(rnd() * a.length) % a.length]; }
function chance(p) { return rnd() < p; }

const NAMES = ['x', 'y', 'a_i', 'theta', 'v_0', 'rate', 'self.mass', 'np.pi',
  'data[i]', 'længde', 'n'];
const NUMS = ['0', '1', '2', '0.5', '1e-3', '0xFF', '1_000', '9.81', '.5'];
const BIN = ['+', '-', '*', '/', '**', '<<', '>>', '&', '|', '^', '==', '!=', '<', '>='];
const FUNCS = ['math.sqrt', 'abs', 'math.exp', 'math.log', 'math.sin', 'np.linalg.norm',
  'sp.diff', 'sp.integrate', 'sp.Eq', 'min', 'max', 'sum', 'hypot', 'pow'];

// Only syntax the language actually has: otherwise a refusal is the parser
// being right, not a gap.
function expr(depth, lang) {
  const py = lang === 'python';
  const ops = py ? BIN.concat(['and', 'or', '%']) : BIN.concat(['&&', '||', '%']);
  if (depth <= 0 || chance(0.25)) return chance(0.5) ? pick(NAMES) : pick(NUMS);
  const roll = rnd();
  if (roll < 0.42) return expr(depth - 1, lang) + ' ' + pick(ops) + ' ' + expr(depth - 1, lang);
  if (roll < 0.56) return '(' + expr(depth - 1, lang) + ')';
  if (roll < 0.68) {
    const n = 1 + Math.floor(rnd() * 3);
    const args = [];
    for (let i = 0; i < n; i++) args.push(expr(depth - 1, lang));
    return pick(FUNCS) + '(' + args.join(', ') + ')';
  }
  if (roll < 0.76) return '-' + expr(depth - 1, lang);
  if (roll < 0.82) return expr(depth - 1, lang) + '[' + expr(0, lang) + ']';
  if (roll < 0.88) {
    return py ? expr(depth - 1, lang) + ' if ' + expr(0, lang) + ' else ' + expr(depth - 1, lang)
      : expr(0, lang) + ' ? ' + expr(depth - 1, lang) + ' : ' + expr(depth - 1, lang);
  }
  if (!py) return expr(depth - 1, lang) + ' ' + pick(ops) + ' ' + expr(depth - 1, lang);
  if (roll < 0.94) {
    return 'sum(' + expr(depth - 1, lang) + ' for ' + pick(['i', 'x']) + ' in ' + pick(NAMES) + ')';
  }
  return '[' + expr(depth - 1, lang) + ' for x in ' + pick(NAMES) + ']';
}

function corrupt(s) {
  const chars = s.split('');
  const rounds = 1 + Math.floor(rnd() * 3);
  for (let r = 0; r < rounds; r++) {
    const at = Math.floor(rnd() * chars.length);
    const how = rnd();
    if (how < 0.35) chars.splice(at, 1);
    else if (how < 0.7) {
      chars.splice(at, 0, pick(['(', ')', '[', ']', '*', '/', ',', ':', '"', '\\', '#', '**', '{']));
    } else {
      chars[at] = pick(['@', '$', '!', '~', '?', '`', ';', '§', '€']);
    }
  }
  return chars.join('');
}

function checkRanges(html, docLength) {
  const tag = /<span\b([^>]*)>|<\/span>/g;
  const stack = [];
  let m;
  while ((m = tag.exec(html)) !== null) {
    if (m[0] === '</span>') {
      if (!stack.length) return 'unbalanced </span>';
      stack.pop();
      continue;
    }
    const s = /data-s="(\d+)"/.exec(m[1]);
    const e = /data-e="(\d+)"/.exec(m[1]);
    if (!s || !e) { stack.push(null); continue; }
    const range = [Number(s[1]), Number(e[1])];
    if (!(range[0] >= 0 && range[1] <= docLength)) return 'range outside the document: ' + range;
    if (!(range[0] < range[1])) return 'empty or inverted range: ' + range;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i]) continue;
      if (range[0] < stack[i][0] || range[1] > stack[i][1]) {
        return 'child ' + range + ' escapes parent ' + stack[i];
      }
      break;
    }
    stack.push(range);
  }
  return stack.length ? 'unclosed <span>' : null;
}

const failures = [];
let cases = 0;
let rendered = 0;
let refused = 0;

function trial(src, lang) {
  const text = 'result = ' + src + '\n';
  const started = Date.now();
  let out;
  try {
    out = analyze(text, { start: 9, end: 9 }, lang, CFG);
  } catch (err) {
    failures.push('threw [' + lang + '] ' + JSON.stringify(src) + ' -- ' + err.message);
    return;
  }
  const ms = Date.now() - started;
  cases++;
  if (ms > 500) failures.push('slow (' + ms + 'ms) [' + lang + '] ' + JSON.stringify(src));

  const st = out.statements[0];
  if (!st) return;
  if (st.error) {
    refused++;
    if (typeof st.error.docPos !== 'number' || st.error.docPos < 0 || st.error.docPos > text.length) {
      failures.push('error position outside the document [' + lang + '] ' + JSON.stringify(src));
    }
    if (!st.error.message) failures.push('error without a message [' + lang + '] ' + JSON.stringify(src));
    return;
  }
  rendered++;
  if (/undefined|NaN|\[object/.test(st.html)) {
    failures.push('broken html [' + lang + '] ' + JSON.stringify(src) + ' -- ' + st.html.slice(0, 120));
    return;
  }
  const bad = checkRanges(st.html, text.length);
  if (bad) failures.push('ranges [' + lang + '] ' + JSON.stringify(src) + ' -- ' + bad);
  if (typeof st.latex !== 'string') {
    failures.push('no latex [' + lang + '] ' + JSON.stringify(src));
  }
}

const ROUNDS = Number(process.env.PRETTY_MATH_ROUNDS || 1500);
for (let i = 0; i < ROUNDS; i++) {
  const lang = pick(LANGS);
  const src = expr(3 + Math.floor(rnd() * 3), lang);
  trial(src, lang);
  if (chance(0.5)) trial(corrupt(src), lang);
}

failures.slice(0, 20).forEach(function (f) { console.log('FAIL  ' + f); });
console.log('');
console.log(cases + ' cases from seed ' + startingSeed + ' (' + rendered + ' drawn, ' +
  refused + ' refused), ' + failures.length + ' failures');
process.exit(failures.length ? 1 : 0);
