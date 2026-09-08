'use strict';

const { analyze } = require('../src/pretty');
const { flavorFor } = require('../src/flavors');
const { parse, precedenceFor } = require('../src/parser');
const { toLatex } = require('../src/latex');
const prep = require('../src/prep');

const CFG = {
  multiplication: 'implicit',
  indexAsSubscript: true,
  greekLetters: true,
  expandIdentities: true,
  stripNamespaces: ['Math', 'math', 'np', 'numpy', 'cmath', 'scipy', 'torch',
                    'sp', 'sym', 'sympy', 'smp', 'self', 'this'],
  caretMeansPower: 'auto',
  maxLines: 40
};

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = expected instanceof RegExp ? expected.test(actual) : actual === expected;
  if (ok) { pass++; return; }
  fail++;
  console.log('FAIL  ' + name);
  console.log('  expected: ' + expected);
  console.log('  actual:   ' + actual);
}

function tex(src, lang) {
  const f = flavorFor(lang || 'python', CFG);
  return toLatex(parse(src, f), {
    stripNamespaces: CFG.stripNamespaces,
    prec: precedenceFor(f),
    chainsComparisons: f.chainsComparisons
  });
}

function one(src, lang, cursor) {
  const r = analyze(src, { start: cursor === undefined ? 0 : cursor, end: cursor === undefined ? 0 : cursor }, lang || 'python', CFG);
  return r.statements[0];
}

// ---- parsing / precedence -------------------------------------------------
check('float division', tex('a / b'), '\\frac{a}{b}');
check('chained division groups left', tex('a / b / c'), '\\frac{\\frac{a}{b}}{c}');
check('mul after div stays in numerator? no', tex('a / b * c'), '\\frac{a}{b} \\cdot c');
check('power right assoc', tex('2 ** 3 ** 2'), '2^{3^{2}}');
check('unary minus below power', tex('-x ** 2'), '-x^{2}');
check('paren power', tex('(-x) ** 2'), '\\left(-x\\right)^{2}');
check('sub not associative', tex('a - (b - c)'), 'a - \\left(b - c\\right)');
check('add is associative', tex('a + (b + c)'), 'a + b + c');
check('caret is xor in python', tex('a ^ b'), 'a \\oplus b');
check('caret is power in matlab', tex('a ^ b', 'matlab'), 'a^{b}');
check('matlab elementwise', tex('a .* b', 'matlab'), 'a \\odot b');
check('comparison chain', tex('0 < x < 1'), '0 < x < 1');
check('floor division', tex('n // 2'), '\\left\\lfloor \\frac{n}{2} \\right\\rfloor');
check('js comment is not floor div', tex('n / 2', 'javascript'), '\\frac{n}{2}');

// ---- functions and identities --------------------------------------------
check('sqrt', tex('math.sqrt(x)'), '\\sqrt{x}');
check('np namespace', tex('np.sqrt(x + 1)'), '\\sqrt{x + 1}');
check('hypot expands', tex('math.hypot(dx, dy)'), '\\sqrt{\\mathrm{dx}^{2} + \\mathrm{dy}^{2}}');
check('half power is a root', tex('x ** 0.5'), '\\sqrt{x}');
check('one third power', tex('x ** (1/3)'), '\\sqrt[3]{x}');
check('exp', tex('math.exp(-t / tau)'), 'e^{\\frac{-t}{\\tau}}');
check('abs', tex('abs(v)'), '\\left|v\\right|');
check('log base', tex('math.log(x, 2)'), '\\log_{2}\\left(x\\right)');
check('trig power', tex('math.sin(theta) ** 2'), '\\sin^{2}\\left(\\theta\\right)');
check('standard operator names', tex('math.cos(a) + f(b)'), '\\cos\\left(a\\right) + \\operatorname{f}\\left(b\\right)');
check('fraction times factor gets a dot', tex('a / b * c'), '\\frac{a}{b} \\cdot c');
check('mixed logic shows grouping', tex('a and b or c'), '\\left(a \\wedge b\\right) \\vee c');
check('mixed bitwise shows grouping', tex('a ^ b | c & d'), '\\left(a \\oplus b\\right) \\mathbin{|} \\left(c \\mathbin{\\&} d\\right)');
check('shift beside arithmetic shows grouping', tex('a + b << c'), '\\left(a + b\\right) \\ll c');
check('greek subscript', tex('theta_max'), '\\theta_{\\mathrm{max}}');
check('digit subscript', tex('x1 + x2'), 'x_{1} + x_{2}');
check('self stripped', tex('self.mass * self.v ** 2 / 2'), '\\frac{\\mathrm{mass} \\cdot v^{2}}{2}');
check('index subscript', tex('a[i] * b[i + 1]'), 'a_{i} \\cdot b_{i + 1}');
check('ternary cases', tex('x if x > 0 else -x'), /begin\{cases\}/);
check('scientific notation', tex('1.5e-3 * x'), '1.5 \\times 10^{-3} \\cdot x');

// ---- bitwise vs comparison, which the languages genuinely disagree on ------
// Python masks then compares; C compares then masks, the classic C bug.
check('python masks then compares', tex('flags & 0xFF == 0', 'python'),
  '\\left(\\mathrm{flags} \\mathbin{\\&} \\mathtt{0xFF}\\right) = 0');
check('C compares then masks', tex('flags & 0xFF == 0', 'c'),
  '\\mathrm{flags} \\mathbin{\\&} \\left(\\mathtt{0xFF} = 0\\right)');
check('javascript follows C', tex('flags & 0xFF == 0', 'javascript'),
  '\\mathrm{flags} \\mathbin{\\&} \\left(\\mathtt{0xFF} = 0\\right)');
check('julia follows python', tex('flags & 0xFF == 0', 'julia'),
  '\\left(\\mathrm{flags} \\mathbin{\\&} \\mathtt{0xFF}\\right) = 0');
check('C relational binds tighter than equality', tex('a == b < c', 'c'),
  'a = \\left(b < c\\right)');
check('python chains comparisons', tex('0 <= i < n', 'python'), '0 \\leq i < n');
check('C does not chain comparisons', tex('0 <= i < n', 'c'),
  '\\left(0 \\leq i\\right) < n');
check('hex literals survive intact', tex('mask = 0xFF + 0b1010 + 0o17'),
  '\\mathrm{mask} = \\mathtt{0xFF} + \\mathtt{0b1010} + \\mathtt{0o17}');
check('C float suffix is still stripped', tex('x = 1.5f * 2L', 'c'),
  'x = 1.5 \\cdot 2');

// ---- calculus -------------------------------------------------------------
check('derivative of a name', tex('sp.diff(f, x)'), '\\frac{\\mathrm{d} f}{\\mathrm{d} x}');
check('derivative of an expression', tex('diff(x**2 + 1, x)'),
  '\\frac{\\mathrm{d}}{\\mathrm{d} x}\\left(x^{2} + 1\\right)');
check('second derivative', tex('sp.diff(f, x, 2)'), '\\frac{\\mathrm{d}^{2} f}{\\mathrm{d} x^{2}}');
check('order given as a tuple', tex('diff(f, (x, 2))'), '\\frac{\\mathrm{d}^{2} f}{\\mathrm{d} x^{2}}');
check('mixed partials use partial d', tex('diff(f, x, y)'),
  '\\frac{\\partial^{2} f}{\\partial x\\,\\partial y}');
check('method form', tex('expr.diff(t)'), '\\frac{\\mathrm{d} \\mathrm{expr}}{\\mathrm{d} t}');
check('numpy diff is a difference', tex('np.diff(a)'), '\\Delta a');
check('numpy diff with order', tex('np.diff(a, n=2)'), '\\Delta^{2} a');

check('indefinite integral', tex('sp.integrate(f, x)'), '\\int f\\,\\mathrm{d}x');
check('a sum under the sign is bracketed', tex('integrate(x + 1, x)'),
  '\\int \\left(x + 1\\right)\\,\\mathrm{d}x');
check('derivative operator brackets a product', tex('diff(x * y, x)'),
  '\\frac{\\mathrm{d}}{\\mathrm{d} x}\\left(x \\cdot y\\right)');
check('definite integral', tex('integrate(x**2, (x, 0, 1))'),
  '\\int_{0}^{1} x^{2}\\,\\mathrm{d}x');
check('double integral', tex('integrate(f, x, y)'), '\\int\\int f\\,\\mathrm{d}x\\,\\mathrm{d}y');
check('Integral class', tex('sp.Integral(sp.sin(x), (x, 0, sp.pi))'),
  '\\int_{0}^{\\pi} \\sin\\left(x\\right)\\,\\mathrm{d}x');
check('numeric integral', tex('np.trapz(y, x)'), '\\int y\\,\\mathrm{d}x');
check('quad', tex('scipy.integrate.quad(f, 0, 1)'), '\\int_{0}^{1} f');

check('Eq becomes an equals sign', tex('sp.Eq(y, m*x + b)'), 'y = m \\cdot x + b');
check('Ge becomes a relation', tex('Ge(x, 0)'), 'x \\geq 0');
check('Sum with limits', tex('sp.Sum(1/n**2, (n, 1, sp.oo))'),
  '\\sum_{n = 1}^{\\infty} \\frac{1}{n^{2}}');
check('Product with limits', tex('Product(k, (k, 1, n))'), '\\prod_{k = 1}^{n} k');
check('limit', tex('sp.limit(sp.sin(x)/x, x, 0)'),
  '\\lim_{x \\to 0} \\frac{\\sin\\left(x\\right)}{x}');
check('one sided limit', tex('limit(1/x, x, 0, "+")'), '\\lim_{x \\to 0^{+}} \\frac{1}{x}');
check('Rational', tex('sp.Rational(1, 3)'), '\\frac{1}{3}');
check('plain sum is untouched', tex('sum(v)'), '\\sum v');

const deriv = one('dydx = sp.diff(y, x)').html;
check('derivative renders as a fraction', /pm-frac-num/.test(deriv) && /pm-dd/.test(deriv), true);
const integ = one('area = sp.integrate(f, (x, 0, 1))').html;
check('integral renders a sign with limits',
  /pm-int-glyph/.test(integ) && /pm-lim-up/.test(integ), true);
const eqn = one('sp.Eq(F, m * a)').html;
check('Eq renders a relation', /pm-op-rel/.test(eqn), true);

// ---- html rendering -------------------------------------------------------
const h = one('E = 0.5 * m * v ** 2').html;
check('html has fraction-free product', /pm-power/.test(h) && /pm-assign/.test(h), true);
check('html carries offsets', /data-s="\d+" data-e="\d+"/.test(h), true);

const frac = one('y = (a + b) / (c - d)').html;
check('html fraction', /pm-frac-num/.test(frac) && /pm-frac-den/.test(frac), true);

// ---- offset mapping -------------------------------------------------------
const doc = 'value = alpha * beta\n';
const st = one(doc, 'python', 3);
check('doc offsets start at 0', st.docStart, 0);
check('doc offsets end at line end', st.docEnd, 20);
const m = /data-s="(\d+)" data-e="(\d+)"[^>]*>[^<]*<span class="pm-greek">β/.exec(st.html);
check('beta maps back to source', m && doc.slice(Number(m[1]), Number(m[2])), 'beta');

// ---- statement extraction -------------------------------------------------
const wrapped = 'total = (first_term\n         + second_term\n         + third_term)\nnext_line = 1\n';
const w = analyze(wrapped, { start: 30, end: 30 }, 'python', CFG);
check('joins wrapped lines', w.statements[0].source, 'total = (first_term + second_term + third_term)');

const commented = 'x = a * b  # times b\ny = 2\n';
check('drops comments', one(commented, 'python', 2).source, 'x = a * b');

const cstyle = 'double speed = dist / time; // m/s\n';
check('drops C type and semicolon', one(cstyle, 'cpp', 20).source, 'speed = dist / time');

const ret = '    return (a + b) / 2;\n';
check('drops return', one(ret, 'java', 10).source, '(a + b) / 2');

const iff = 'if (x > 0 && y < 10) {\n';
check('drops if scaffolding', one(iff, 'javascript', 5).source, 'x > 0 && y < 10');

// ---- errors are reported, not thrown --------------------------------------
const bad = one('x = a + * b');
check('parse error reported', !!bad.error, true);
check('error has position', bad.error.pos > 0, true);

const empty = analyze('\n\n', { start: 1, end: 1 }, 'python', CFG);
check('empty input yields nothing', empty.statements.length, 0);

// ---- multi-statement selection --------------------------------------------
const sel = 'a = 1\nb = a + 2\nc = b / a\n';
const many = analyze(sel, { start: 0, end: sel.length }, 'python', CFG);
check('selection yields all statements', many.statements.length, 3);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
