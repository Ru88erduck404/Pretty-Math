'use strict';

// Typing maths, and turning a typed line into maths. Two things are pinned
// down: that the shapes a formula is actually written in come out right, and
// that nothing happens to text which is not a formula -- a formatter that
// mangles what it cannot read is one you stop reaching for.

const maple = require('../src/maple');

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
  const found = maple.expandAt(line, line.length);
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
  const found = maple.expandAt(line, 6);
  return found ? line.slice(0, found.start) + found.text + line.slice(found.end) : null;
})(), 'α + beta');

// ------------------------------------------------------------- completions

check('completions for a prefix', (function () {
  const names = maple.completionsFor('alph').map(function (c) { return c.name; });
  return names.join(',');
})(), 'alpha');
check('a prefix with several answers offers the shortest first',
  maple.completionsFor('le')[0].name, 'le');
check('every completion carries its symbol',
  maple.completionsFor('').every(function (c) { return !!c.symbol; }), true);
check('an unknown prefix offers nothing', maple.completionsFor('zzz').length, 0);

// ------------------------------------------------------ the Maple dialect

// Maple writes a range as `x = a .. b`. Rewriting it into the shape the parser
// already reads is why none of this needed a second grammar.
check('a definite integral',
  maple.mapleToSource('int(f, x = 0 .. 1)'), 'integrate(f, (x, 0, 1))');
check('an indefinite integral',
  maple.mapleToSource('int(x^2, x)'), 'integrate(x^2, x)');
check('a sum', maple.mapleToSource('sum(1/i^2, i = 1 .. n)'), 'Sum(1/i^2, (i, 1, n))');
check('a product', maple.mapleToSource('product(k, k = 1 .. n)'), 'Product(k, (k, 1, n))');
check('a limit', maple.mapleToSource('limit(sin(x)/x, x = 0)'), 'limit(sin(x)/x, x, 0)');
check('a derivative is already in the right shape',
  maple.mapleToSource('diff(y, x)'), 'diff(y, x)');
check('Maple spells pi with a capital', maple.mapleToSource('Pi*r^2'), 'pi*r^2');
check('and infinity in full', maple.mapleToSource('1/infinity'), '1/oo');
check('an ordinary call is left alone', maple.mapleToSource('f(a, b)'), 'f(a, b)');
check('a nested call keeps its own arguments',
  maple.mapleToSource('int(f(x, y), x = a .. b)'), 'integrate(f(x, y), (x, a, b))');
check('arguments split at the top level only',
  maple.splitArgs('f(a, b), x = 0 .. 1').length, 2);

// --------------------------------------------------------- unicode output

function uni(src) { return maple.formatAsMath(src, 'unicode'); }

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

function tex(src, opts) { return maple.formatAsMath(src, 'latex', opts); }

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
    maple.formatAsMath(src, 'unicode'), null);
  check('nothing is made of ' + JSON.stringify(src) + ' as latex',
    maple.formatAsMath(src, 'latex'), null);
});

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
    maple.formatAsMath(src, 'unicode');
    maple.formatAsMath(src, 'latex');
    maple.expandAt(src, src.length);
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
  const twice = maple.formatAsMath(once, 'unicode');
  check('formatting ' + JSON.stringify(src) + ' twice changes nothing further',
    twice === null || twice === once, true);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
