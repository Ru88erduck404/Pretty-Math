'use strict';

// Typing maths, and turning a typed line into maths. Two things are pinned
// down: that the shapes a formula is actually written in come out right, and
// that nothing happens to text which is not a formula -- a formatter that
// mangles what it cannot read is one you stop reaching for.

const notation = require('../src/notation');

// A backslash, built rather than written, so that the escaping in this file
// never has to be read twice to be believed.
const B = String.fromCharCode(92);

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

// What typing `line` and putting the cursor at its end would produce.
function typed(line) {
  const found = notation.expandAt(line, line.length);
  if (!found) return null;
  return line.slice(0, found.start) + found.text + line.slice(found.end);
}

// ------------------------------------------------------------ typing names

check('a greek letter', typed(B + 'alpha'), 'α');
check('a capital', typed(B + 'Omega'), 'Ω');
check('a relation', typed(B + 'le'), '≤');
check('an arrow', typed(B + 'to'), '→');
check('an integral sign', typed(B + 'int'), '∫');
check('a set', typed(B + 'R'), 'ℝ');
check('infinity', typed(B + 'infty'), '∞');
check('the other spelling of infinity', typed(B + 'infinity'), '∞');
check('a name in the middle of a line', typed('E = m' + B + 'cdot'), 'E = m·');

// A name that is only half typed is left alone, which is what makes both
// `\le` and `\leq` reachable: expanding the moment a name is complete would
// swallow the shorter one before the longer could be finished.
check('an incomplete name', typed(B + 'al'), null);
check('the longer name is still reachable', typed(B + 'leq'), '≤');
check('and so is the shorter one', typed(B + 'le'), '≤');
check('a bare backslash', typed(B), null);
check('a name with a letter after it', typed(B + 'alphax'), null);
check('no backslash at all', typed('alpha'), null);
check('a double backslash is an escape, not a name', typed(B + B), null);
check('an unknown name', typed(B + 'frobnicate'), null);

// Only the text before the cursor counts: what comes after is not being typed.
check('text after the cursor is untouched', (function () {
  const line = B + 'alpha + beta';
  const found = notation.expandAt(line, 6);
  return found ? line.slice(0, found.start) + found.text + line.slice(found.end) : null;
})(), 'α + beta');

// ------------------------------------------------------------- completions

check('completions for a prefix', (function () {
  const names = notation.completionsFor('alph').map(function (c) { return c.name; });
  return names.join(',');
})(), 'alpha');
check('a prefix with several answers offers the shortest first',
  notation.completionsFor('le')[0].name, 'le');
check('every completion carries its symbol',
  notation.completionsFor('').every(function (c) { return !!c.symbol; }), true);
check('an unknown prefix offers nothing', notation.completionsFor('zzz').length, 0);

// ----------------------------------------------------- the input dialect

// A range is written `x = a .. b`, as a calculator writes it. Rewriting that
// into the shape the parser already reads is why none of this needed a second
// grammar.
check('a definite integral',
  notation.toParserSyntax('int(f, x = 0 .. 1)'), 'integrate(f, (x, 0, 1))');
check('an indefinite integral',
  notation.toParserSyntax('int(x^2, x)'), 'integrate(x^2, x)');
check('a sum', notation.toParserSyntax('sum(1/i^2, i = 1 .. n)'), 'Sum(1/i^2, (i, 1, n))');
check('a product', notation.toParserSyntax('product(k, k = 1 .. n)'), 'Product(k, (k, 1, n))');
check('a limit', notation.toParserSyntax('limit(sin(x)/x, x = 0)'), 'limit(sin(x)/x, x, 0)');
check('a derivative is already in the right shape',
  notation.toParserSyntax('diff(y, x)'), 'diff(y, x)');
check('pi is spelled with a capital', notation.toParserSyntax('Pi*r^2'), 'pi*r^2');
check('and infinity in full', notation.toParserSyntax('1/infinity'), '1/oo');
check('an ordinary call is left alone', notation.toParserSyntax('f(a, b)'), 'f(a, b)');
check('a nested call keeps its own arguments',
  notation.toParserSyntax('int(f(x, y), x = a .. b)'), 'integrate(f(x, y), (x, a, b))');
check('arguments split at the top level only',
  notation.splitArgs('f(a, b), x = 0 .. 1').length, 2);

// --------------------------------------------------------- unicode output

function uni(src) { return notation.formatAsMath(src, 'unicode'); }

check('a power', uni('x^2'), 'x²');
check('a power with a sum in it', uni('x^(n+1)'), 'xⁿ⁺¹');
check('a root', uni('sqrt(2)'), '√2');
check('a root of a sum', uni('sqrt(a^2 + b^2)'), '√(a² + b²)');
check('greek by name', uni('alpha*beta'), 'α·β');
check('a subscript', uni('v_0'), 'v₀');
check('a named subscript', uni('theta_max'), 'θₘₐₓ');
check('a subscript and a power together', uni('omega_0^2'), 'ω₀²');
check('a constant', uni('Pi*r^2'), 'π·r²');
check('an absolute value', uni('abs(x) <= epsilon'), '|x| ≤ ε');
check('a definite integral', uni('int(x^2, x = 0 .. 1)'), '∫₀¹ x² dx');
check('a sum with limits', uni('sum(1/i^2, i = 1 .. n)'), '∑ᵢ₌₁ⁿ 1/i²');
check('a derivative', uni('diff(y, x)'), 'dy/dx');
check('a second derivative', uni('diff(y, x, 2)'), 'd²y/dx²');
check('a limit', uni('limit(sin(x)/x, x = 0)'), 'lim(x→0) sin(x)/x');
check('an exponential', uni('exp(x)'), 'eˣ');
check('a division keeps its brackets', uni('(a+b)/(c+d)'), '(a + b)/(c + d)');
check('and loses them where they say nothing', uni('a/b + c'), 'a/b + c');
check('an equation', uni('E = m*c^2'), 'E = m·c²');

// Unicode has no raised q, and no lowered b, so a raised form is all or
// nothing: half-raised text reads as a typo rather than as an exponent.
check('an exponent that cannot be raised stays on the line', uni('x^q'), 'x^(q)');
check('a subscript that cannot be lowered keeps its brackets', uni('a[b]'), 'a[b]');
check('a limit that cannot be raised is still legible',
  uni('int(f, x = 0 .. infinity)'), '∫(0→∞) f dx');

// ----------------------------------------------------------- latex output

function tex(src, opts) { return notation.formatAsMath(src, 'latex', opts); }

check('inline latex', tex('x^2 + y^2'), '$x^{2} + y^{2}$');
check('a fraction', tex('(a+b)/(c+d)'), '$\\frac{a + b}{c + d}$');
check('a root', tex('sqrt(alpha^2 + beta^2)'), '$\\sqrt{\\alpha^{2} + \\beta^{2}}$');
check('an integral with limits',
  tex('int(x^2, x = 0 .. 1)'), /\\int_\{0\}\^\{1\} x\^\{2\}/);
check('an infinite limit', tex('int(exp(-x^2), x = 0 .. infinity)'), /\\infty/);
check('a sum', tex('sum(1/i^2, i = 1 .. n)'), /\\sum_\{i = 1\}\^\{n\}/);
check('a derivative', tex('diff(y, x)'), /\\frac\{\\mathrm\{d\} y\}\{\\mathrm\{d\} x\}/);
check('a limit', tex('limit(sin(x)/x, x = 0)'), /\\lim_\{x \\to 0\}/);
check('greek', tex('alpha + beta'), '$\\alpha + \\beta$');
check('display maths is fenced on its own lines',
  tex('x^2', { display: true }), '$$\nx^{2}\n$$');

// ---------------------------------------------------------- left untouched

// Prose is not a formula. Anything that does not parse comes back as null, and
// the caller puts the text back exactly as it was.
['', '   ', 'the quick brown fox', 'x = ', ')(', 'f(', '# a comment',
 '| a | table |', '- a bullet'].forEach(function (src) {
  check('nothing is made of ' + JSON.stringify(src) + ' as unicode',
    notation.formatAsMath(src, 'unicode'), null);
  check('nothing is made of ' + JSON.stringify(src) + ' as latex',
    notation.formatAsMath(src, 'latex'), null);
});

// --------------------------------------------------- more than one call

// A pattern cannot tell where one call ends and the next begins. A greedy one
// swallowed both of these whole and then quietly gave up; a lazy one would
// stop at the first bracket inside the arguments. Brackets are matched instead.
check('two ranged calls on one line',
  notation.toParserSyntax('int(f, x = 0 .. 1) + int(g, x = 0 .. 2)'),
  'integrate(f, (x, 0, 1)) + integrate(g, (x, 0, 2))');
check('and both of them draw',
  uni('int(f, x = 0 .. 1) + int(g, x = 0 .. 2)'), '(∫₀¹ f dx) + (∫₀² g dx)');
check('a ranged call inside another',
  notation.toParserSyntax('int(int(f, y = 0 .. 1), x = 0 .. 1)'),
  'integrate(integrate(f, (y, 0, 1)), (x, 0, 1))');
check('a double integral draws',
  uni('int(int(f, y = 0 .. 1), x = 0 .. 1)'), '∫₀¹ ∫₀¹ f dy dx');
check('two limits on one line',
  uni('limit(f, x = 0) + limit(g, x = 1)'), '(lim(x→0) f) + (lim(x→1) g)');
check('a ranged call with an assignment around it',
  uni('A = int(f, x = 0 .. 1)'), 'A = ∫₀¹ f dx');
// A name ending in one of these is not one of these.
check('myint is not int', notation.toParserSyntax('myint(f, x = 0 .. 1)'),
  'myint(f, x = 0 .. 1)');
check('and int(x) is the ordinary builtin',
  uni('print(int(x))'), 'print(int(x))');
check('a bracket inside a string does not unbalance the scan',
  notation.toParserSyntax('f("a)b", x)'), 'f("a)b", x)');
// Quoted text is somebody's words, not notation to be translated.
check('a name is not rewritten inside a string',
  notation.toParserSyntax('msg = "infinity and beyond"'), 'msg = "infinity and beyond"');
check('nor is Pi', notation.toParserSyntax('f("Pi")'), 'f("Pi")');
check('but it is outside one', notation.toParserSyntax('x = Pi'), 'x = pi');
check('and both at once',
  notation.toParserSyntax('x = Pi + f("Pi")'), 'x = pi + f("Pi")');

// A layout only applies when the arguments it needs are there. `limit(f,
// x = 0)` beside another call reaches the renderer with its range as a keyword
// argument, and drawing it as `lim(→) f` threw the variable and the point
// away: a formula replaced by a different, wrong formula.
check('a limit missing its parts keeps them all',
  uni('limit(f, x) + 1'), /x/);
check('nothing is lost from a sum without a range',
  uni('Sum(f) + 1'), /f/);

// ------------------------------------------------ raised runs must not merge

// √v₀² cubed is not √v₀²³: two raised runs written next to each other read as
// one number.
check('a power on a base that already ends raised',
  uni('sqrt(v_0^2)^3'), '(√(v₀²))³');
check('a power on an exponential', uni('exp(x)^2'), '(eˣ)²');
check('a power of a power', uni('(x^2)^3'), '(x²)³');
check('which is not the same as a tower', uni('x^2^3'), 'x^(2³)');
// A radical has no bar in plain text, so only a single name or number can
// follow it unbracketed.
check('a root of a power is bracketed', uni('sqrt(x^2)'), '√(x²)');
check('a root raised to a power is bracketed', uni('sqrt(x)^2'), '(√x)²');
check('a root of a sum stays bracketed', uni('sqrt(a + b)'), '√(a + b)');
check('a plain root needs none', uni('sqrt(x)'), '√x');
check('nor does a root of a number', uni('sqrt(2)'), '√2');
check('nor one of a subscripted name', uni('sqrt(v_0)'), '√v₀');

// The same shapes in LaTeX, where a double superscript is not merely
// ambiguous: `x^{2}^{3}` is an error, and the cell renders nothing at all.
check('a power of a power is bracketed in latex',
  tex('(x^2)^3'), /\\left\(x\^\{2\}\\right\)\^\{3\}/);
check('and an exponential raised to a power',
  tex('exp(x)^2'), /\\left\(e\^\{x\}\\right\)\^\{2\}/);
check('no latex output carries a double superscript', (function () {
  const shapes = ['(x^2)^3', 'exp(x)^2', '((x^2)^3)^4', '2^2^2', 'x^2^3',
    'sqrt(x)^2', '(1/x)^2', 'exp(exp(x))', '(a^b)^c'];
  const bad = shapes.filter(function (s) {
    return /\^\{[^{}]*\}\^/.test(String(tex(s)));
  });
  return bad.join(',') || 'none';
})(), 'none');

// ------------------------------------------------- the drawing means the same

// Rendering only goes one way, so this turns the Unicode back into ordinary
// source and compares the two as numbers. A lost bracket shows up as a
// different answer; nothing else does.
const SUPER_BACK = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7',
  '⁸':'8','⁹':'9','⁺':'+','⁻':'-','⁽':'(','⁾':')','ⁿ':'n','ⁱ':'i','ᵃ':'a','ᵇ':'b',
  'ᶜ':'c','ᵈ':'d','ᵉ':'e','ᶠ':'f','ᵍ':'g','ʰ':'h','ʲ':'j','ᵏ':'k','ˡ':'l','ᵐ':'m',
  'ᵒ':'o','ᵖ':'p','ʳ':'r','ˢ':'s','ᵗ':'t','ᵘ':'u','ᵛ':'v','ʷ':'w','ˣ':'x','ʸ':'y','ᶻ':'z' };
const SUB_BACK = { '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7',
  '₈':'8','₉':'9','ₐ':'a','ₑ':'e','ₕ':'h','ᵢ':'i','ⱼ':'j','ₖ':'k','ₗ':'l','ₘ':'m',
  'ₙ':'n','ₒ':'o','ₚ':'p','ᵣ':'r','ₛ':'s','ₜ':'t','ᵤ':'u','ᵥ':'v','ₓ':'x' };
const GREEK_BACK = { 'α':'alpha','β':'beta','θ':'theta','μ':'mu','ρ':'rho',
  'σ':'sigma','ω':'omega' };

function unUnicode(text) {
  let s = String(text);
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁿⁱᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻ]+/g, function (run) {
    let plain = '';
    for (const ch of run) plain += SUPER_BACK[ch];
    return '**(' + plain + ')';
  });
  s = s.replace(/[₀₁₂₃₄₅₆₇₈₉ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]+/g, function (run) {
    let plain = '';
    for (const ch of run) plain += SUB_BACK[ch];
    return '_' + plain;
  });
  s = s.replace(/√/g, 'sqrt@').replace(/·/g, '*').replace(/−/g, '-').replace(/π/g, 'pi');
  Object.keys(GREEK_BACK).forEach(function (g) { s = s.split(g).join(GREEK_BACK[g]); });
  for (let pass = 0; pass < 20 && s.indexOf('sqrt@') >= 0; pass++) {
    const next = s.replace(/sqrt@\(/g, 'sqrt(')
      .replace(/sqrt@(sqrt\((?:[^()]|\([^()]*\))*\))/g, 'sqrt($1)')
      .replace(/sqrt@([A-Za-z_]\w*|\d+(?:\.\d+)?)/g, 'sqrt($1)');
    if (next === s) break;
    s = next;
  }
  return s;
}

const { parse } = require('../src/parser');
const { evaluate } = require('../src/evaluate');

let seed = Number(process.env.PRETTY_MATH_SEED || 20261022);
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(a) { return a[Math.floor(rnd() * a.length) % a.length]; }

const VARS = ['a', 'b', 'c', 'x', 'y', 'alpha', 'beta', 'theta', 'v_0', 'sigma'];
const ENV = {};
VARS.forEach(function (n, i) { ENV[n] = 1 + ((i * 7 + 3) % 11) * 0.37; });
ENV.pi = Math.PI;

function randomExpr(depth) {
  if (depth <= 0 || rnd() < 0.3) {
    return rnd() < 0.5 ? pick(VARS) : pick(['1', '2', '3', '0.5', '7', '1.5']);
  }
  const roll = rnd();
  if (roll < 0.52) {
    const op = pick(['+', '-', '*', '/', '**']);
    const right = op === '**' ? pick(['2', '3', '2']) : randomExpr(depth - 1);
    return randomExpr(depth - 1) + ' ' + op + ' ' + right;
  }
  if (roll < 0.66) return '(' + randomExpr(depth - 1) + ')';
  if (roll < 0.80) return '-' + randomExpr(depth - 1);
  return 'sqrt(' + randomExpr(depth - 1) + ')';
}

function valueOf(src) {
  try {
    return evaluate(parse(src, { caretIsPower: true }), ENV, new Set(), {});
  } catch (err) {
    return undefined;
  }
}

let compared = 0;
const wrong = [];
for (let i = 0; i < 3000; i++) {
  const src = randomExpr(3);
  const drawn = notation.formatAsMath(src, 'unicode');
  if (drawn === null) continue;
  const a = valueOf(src);
  if (a === null || a === undefined || !Number.isFinite(a)) continue;
  const b = valueOf(unUnicode(drawn));
  if (b === null || b === undefined || !Number.isFinite(b)) {
    wrong.push(src + '  ->  ' + drawn + '  ->  ' + unUnicode(drawn));
    continue;
  }
  compared++;
  if (Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b)) > 1e-9) {
    wrong.push(src + '  ->  ' + drawn + '   (' + a + ' vs ' + b + ')');
  }
}
wrong.slice(0, 5).forEach(function (w) { console.log('  MEANING CHANGED  ' + w); });
check('the drawing means what was typed, over ' + compared + ' expressions',
  wrong.length, 0);

// ---------------------------------------------------------------- hostile

// The same text an attacker or a stray paste might put in front of it.
const NASTY = [
  B + 'a'.repeat(5000),
  '('.repeat(500) + 'x' + ')'.repeat(500),
  'int(' .repeat(50) + 'x' + ')'.repeat(50),
  'x^'.repeat(200) + '2',
  '1/'.repeat(500) + '2',
  'a'.repeat(10000),
  'sum(f, i = 1 .. ' + 'n'.repeat(2000) + ')'
];
let held = 0;
NASTY.forEach(function (src) {
  const started = Date.now();
  try {
    notation.formatAsMath(src, 'unicode');
    notation.formatAsMath(src, 'latex');
    notation.expandAt(src, src.length);
    if (Date.now() - started < 2000) held++;
    else console.log('SLOW on input of ' + src.length + ' characters');
  } catch (err) {
    console.log('THREW on input of ' + src.length + ' characters: ' + err.message);
  }
});
check('hostile input is handled quickly and without throwing', held, NASTY.length);

// Formatting twice must not keep changing the text, or a held-down shortcut
// would walk away with it. Formatted maths is no longer source, so the second
// pass declines it and the caller leaves the line alone -- which is the
// behaviour that matters, whichever way it is reached.
['x^2 + y^2', 'alpha*beta', 'v_0*t', 'sqrt(2)'].forEach(function (src) {
  const once = uni(src);
  const twice = notation.formatAsMath(once, 'unicode');
  check('formatting ' + JSON.stringify(src) + ' twice changes nothing further',
    twice === null || twice === once, true);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
