'use strict';

// Checks the library support the README claims, one assertion per claim, so the
// documentation cannot drift away from what the code does.

const { analyze } = require('../src/pretty');
const { collectValues, importModules } = require('../src/values');

const STRIP = ['Math', 'math', 'np', 'numpy', 'cmath', 'scipy', 'torch', 'jnp',
  'sp', 'sym', 'sympy', 'smp', 'std', 'self', 'this'];

const CFG = {
  multiplication: 'implicit', indexAsSubscript: true, greekLetters: true,
  expandIdentities: true, derivativeSymbol: 'auto', maxLines: 40, valueDigits: 6,
  valueScanLines: 500, stripNamespaces: STRIP
};

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

// The drawing, with the markup stripped: enough to tell notation apart.
function drawn(src, lang, values) {
  const cfg = values ? Object.assign({}, CFG, { values: values }) : CFG;
  const st = analyze(src, { start: 0, end: 0 }, lang || 'python', cfg).statements[0];
  if (!st) return '(nothing)';
  if (st.error) return 'ERROR: ' + st.error.message;
  return st.html.replace(/<[^>]*>/g, '');
}

// ---- math and cmath --------------------------------------------------------
check('math.sqrt', drawn('y = math.sqrt(x)'), 'y=√x');
check('math.exp', drawn('y = math.exp(-t)'), 'y=e−t');
check('math.log10', drawn('y = math.log10(x)'), 'y=log10x');
check('math.hypot', drawn('y = math.hypot(a, b)'), 'y=√a2+b2');
check('math.floor', drawn('y = math.floor(x)'), 'y=⌊x⌋');
check('math.ceil', drawn('y = math.ceil(x)'), 'y=⌈x⌉');
check('math.fabs', drawn('y = math.fabs(x)'), 'y=|x|');
check('math.factorial', drawn('y = math.factorial(n)'), 'y=n!');
check('math.fmod', drawn('y = math.fmod(a, b)'), 'y=amodb');
check('trig with a bare argument', drawn('y = math.sin(theta)'), 'y=sinθ');
check('trig raised to a power', drawn('y = math.sin(t)**2'), 'y=sin2t');
// `log` is described by its kind alone, with no printable name, so the powered
// form used to draw the function as the word "undefined".
check('log raised to a power', drawn('y = math.log(x)**2'), 'y=log2x');
check('ln raised to a power', drawn('y = math.ln(x)**2'), 'y=ln2x');
// log, then its subscript 10, then the exponent 2, then the argument.
check('log10 raised to a power', drawn('y = math.log10(x)**2'), 'y=log102x');
check('every powerable name has a printable form', (function () {
  const S = require('../src/symbols');
  const bad = [];
  S.POWERABLE.forEach(function (name) {
    const out = drawn('y = math.' + name + '(x)**2');
    if (/undefined/.test(out)) bad.push(name);
  });
  return bad.join(',') || 'none';
})(), 'none');
check('math.atan2 keeps its parentheses', drawn('y = math.atan2(b, a)'), 'y=atan2(b,a)');
check('cmath is stripped too', drawn('y = cmath.sqrt(z)'), 'y=√z');

// ---- numpy -----------------------------------------------------------------
check('np.sqrt', drawn('y = np.sqrt(x)'), 'y=√x');
check('np.linalg.norm', drawn('y = np.linalg.norm(v)'), 'y=‖v‖');
check('np.dot', drawn('y = np.dot(a, b)'), 'y=a·b');
check('np.cross', drawn('y = np.cross(a, b)'), 'y=a×b');
check('np.trapz is an integral', drawn('y = np.trapz(f, x)'), 'y=∫fdx');
check('np.diff is a difference, not a derivative',
  drawn('d = np.diff(samples)'), 'd=Δsamples');
check('np.gradient', drawn('g = np.gradient(y)'), 'g=∇y');
check('np.pi', drawn('c = 2 * np.pi * r'), 'c=2πr');

// ---- sympy -----------------------------------------------------------------
check('sp.diff', drawn('d = sp.diff(y, x)'), /d=ddxy|d=dydx/);
check('sp.diff second order', drawn('a = sp.diff(y, t, 2)'), /d2/);
check('mixed partials use the partial symbol', drawn('m = sp.diff(f, x, y)'), /∂/);
// The upper limit comes first in the markup because it sits above the sign.
check('sp.integrate with limits',
  drawn('a = sp.integrate(f, (x, 0, 1))'), 'a=∫10fdx');
check('sp.Sum with limits', drawn('s = sp.Sum(f, (n, 1, N))'), /∑/);
check('sp.Product', drawn('p = sp.Product(k, (k, 1, n))'), /∏/);
check('sp.limit', drawn('l = sp.limit(f, x, 0)'), /limx→0/);
check('sp.Eq becomes an equals sign', drawn('e = sp.Eq(F, m*a)'), 'e=F=ma');
check('sp.Ge becomes a relation', drawn('e = sp.Ge(x, 0)'), 'e=x≥0');
check('sp.Rational is a fraction', drawn('r = sp.Rational(1, 3)'), 'r=13');
check('sp.Abs', drawn('a = sp.Abs(x)'), 'a=|x|');
check('sp.oo is infinity', drawn('s = sp.Sum(f, (n, 1, sp.oo))'), /∞/);

// ---- scipy -----------------------------------------------------------------
check('scipy quad', drawn('a = scipy.integrate.quad(f, 0, 1)'), 'a=∫10f');
check('scipy simpson', drawn('a = simpson(y, x)'), 'a=∫ydx');

const SCIPY_FILE = [
  'from scipy import constants as cn',
  'import numpy as np',
  'import math',
  'p = 2.0 * cn.bar',
  'r = cn.R',
  'na = cn.N_A',
  'kb = cn.k',
  'cc = cn.c',
  'gg = cn.g',
  'ev = cn.eV',
  'kilo = cn.kilo',
  'zc = cn.zero_Celsius',
  'circle = 2 * np.pi',
  'nat = math.e',
  ''
].join('\n');
const consts = collectValues(SCIPY_FILE, 'python', CFG);
check('cn.bar', consts.p.text, '200000');
check('cn.R', consts.r.text, '8.31446');
check('cn.N_A', consts.na.text, '6.02214e23');
check('cn.k', consts.kb.text, '1.38065e-23');   // six significant digits
check('valueDigits is honoured in exponential form',
  collectValues('from scipy import constants as cn\nx = cn.k\n', 'python',
    Object.assign({}, CFG, { valueDigits: 3 })).x.text, '1.38e-23');
check('cn.c', consts.cc.text, '299792458');
check('cn.g', consts.gg.text, '9.80665');
check('cn.eV', consts.ev.text, '1.60218e-19');
check('an SI prefix', consts.kilo.text, '1000');
check('cn.zero_Celsius', consts.zc.text, '273.15');
check('np.pi through the module table', consts.circle.text, '6.28319');
check('math.e', consts.nat.text, '2.71828');
check('the module map records what each alias means',
  importModules(SCIPY_FILE).cn, 'scipy.constants');

// A constant is worth showing where it appears, not only where it feeds an
// assignment: cn.R * T should read 8.31446 · T once values are on.
const USES = 'from scipy import constants as cn\nT = 300\nq = cn.R * T\n';
const useVals = collectValues(USES, 'python', CFG);
check('a constant used in a formula is recorded', useVals['cn.R'].text, '8.31446');
check('and it is drawn in place of the symbol',
  drawn('q = cn.R * T', 'python', useVals), 'q=8.31446·300');
check('but only under its qualified spelling, so your own R is untouched',
  useVals.R, undefined);
check('a variable of your own called R keeps its own value',
  collectValues('R = 5\nx = R\n', 'python', CFG).R.text, '5');
check('an unused constant is not recorded',
  useVals['cn.bar'], undefined);

// ---- builtins and comprehensions ------------------------------------------
check('sum over a comprehension', drawn('t = sum(x**2 for x in xs)'), 't=∑x∈xsx2');
check('all is for-all', drawn('ok = all(x > 0 for x in xs)'), /∀/);
check('any is there-exists', drawn('ok = any(x < 0 for x in xs)'), /∃/);
check('max over a comprehension', drawn('m = max(f(x) for x in xs)'), /max/);
check('plain sum', drawn('t = sum(v)'), 't=∑v');
check('abs', drawn('a = abs(x)'), 'a=|x|');
check('round keeps its name', drawn('r = round(x)'), 'r=⌊x⌉');

// ---- qualifiers dropped for any library -----------------------------------
check('a configured qualifier is dropped', drawn('y = torch.sqrt(x)'), 'y=√x');
check('self is dropped', drawn('e = self.mass * 2'), 'e=mass·2');
const PANDAS = 'import pandas as pd\nrows = pd.read_csv(path)\n';
check('an alias the file declares is learned',
  importModules(PANDAS).pd, 'pandas');
check('an unknown library call is still drawn, just as a call',
  drawn('rows = pd.read_csv(path)', 'python',
    null), 'rows=pd.read_csv(path)');

// ---- what deliberately yields no value ------------------------------------
const NOVALUE = [
  'from scipy import constants as cn',
  'import pandas as pd',
  'a = cn.value("Bohr radius")',
  'b = pd.read_csv("x.csv")',
  'c = my_own_function(3)',
  'd = [1, 2, 3]',
  'e = "text"',
  ''
].join('\n');
const none = collectValues(NOVALUE, 'python', CFG);
['a', 'b', 'c', 'd', 'e'].forEach(function (name) {
  check('no value for ' + name, none[name], undefined);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
