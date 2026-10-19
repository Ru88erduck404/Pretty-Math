'use strict';

// The units engine and the lint rules. Two things are being pinned down here:
// that a real mistake is reported, and -- at least as important -- that a
// correct formula is met with silence. A check that cries wolf is worse than
// no check, so the quiet cases outnumber the loud ones below.

const { analyze } = require('../src/pretty');
const { collectUnits, parseUnit, unitComment, describe, dim, same } = require('../src/units');
const { importModules } = require('../src/values');
const { flavorFor } = require('../src/flavors');

const STRIP = ['Math', 'math', 'np', 'numpy', 'cmath', 'scipy', 'torch', 'jnp',
  'sp', 'sym', 'sympy', 'smp', 'std', 'self', 'this'];

const CFG = {
  multiplication: 'implicit', indexAsSubscript: true, greekLetters: true,
  expandIdentities: true, derivativeSymbol: 'auto', maxLines: 40, valueDigits: 6,
  valueScanLines: 500, stripNamespaces: STRIP,
  showChecks: true, checkUnits: true, lintFormulas: true, strictChecks: true
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

// The rules that fire for `src`, given the file `context` above it.
function rules(src, context, lang, over) {
  const text = context || '';
  const cfg = Object.assign({}, CFG, over || {}, {
    unitEnv: collectUnits(text, lang || 'python', CFG),
    unitModules: importModules(text)
  });
  const st = analyze(src, { start: 0, end: 0 }, lang || 'python', cfg).statements[0];
  if (!st) return '(nothing)';
  if (st.error) return 'REFUSED';
  return (st.checks || []).map(function (c) { return c.rule; }).join(',') || 'quiet';
}

function messages(src, context, lang) {
  const text = context || '';
  const cfg = Object.assign({}, CFG, {
    unitEnv: collectUnits(text, lang || 'python', CFG),
    unitModules: importModules(text)
  });
  const st = analyze(src, { start: 0, end: 0 }, lang || 'python', cfg).statements[0];
  if (!st || st.error) return '';
  return (st.checks || []).map(function (c) { return c.message; }).join(' | ');
}

// ---------------------------------------------------------------- unit words

check('a base unit', describe(parseUnit('K')), 'K');
check('a derived unit', describe(parseUnit('Pa')), 'Pa');
check('a quotient', describe(parseUnit('m/s')), 'm/s');
check('a power with a caret', describe(parseUnit('m/s^2')), 'm/s²');
check('a power written bare', describe(parseUnit('m3')), 'm³');
check('a power with a double star', describe(parseUnit('kg*m/s**2')), 'N');
check('a bracketed product in the denominator',
  describe(parseUnit('J/(mol*K)')), 'J/(mol·K)');
check('a space multiplies inside brackets',
  describe(parseUnit('J/(mol K)')), 'J/(mol·K)');
check('one over something', describe(parseUnit('1/s')), 'Hz');
check('a prefix changes the size, not the kind', describe(parseUnit('mm')), 'm');
check('a micro sign', describe(parseUnit('µm')), 'm');
check('kilowatt hours are energy', describe(parseUnit('kWh')), 'J');
check('a percentage is a ratio', describe(parseUnit('%')), 'dimensionless');
check('specific energy', describe(parseUnit('kJ/kg')), 'm²/s²');
// A tonne is a mass however it is spelled. Which tonne it is -- metric, short
// or long -- is a difference of size, not of kind, so nothing here can tell
// them apart and nothing pretends to.
check('a tonne', describe(parseUnit('t')), 'kg');
check('spelled out', describe(parseUnit('tonne')), 'kg');
check('in the plural', describe(parseUnit('tonnes')), 'kg');
check('the other spelling', describe(parseUnit('ton')), 'kg');
check('with a prefix', describe(parseUnit('kt')), 'kg');
check('a capital T is a tesla, not a tonne', describe(parseUnit('T')), 'T');
check('scipy agrees about the metric one',
  describe(collectUnits('from scipy import constants as cn\nx = 2 * cn.metric_ton\n',
    'python', CFG).x), 'kg');
check('and ton_TNT is an energy, not a mass',
  describe(collectUnits('from scipy import constants as cn\nx = 2 * cn.ton_TNT\n',
    'python', CFG).x), 'J');

// A throughput is per hour or per day far more often than per second.
check('tonnes per hour', describe(parseUnit('t/h')), 'kg/s');
check('tonnes per day', describe(parseUnit('tonnes/day')), 'kg/s');
check('cubic metres per day', describe(parseUnit('m3/day')), 'm³/s');
check('litres per minute', describe(parseUnit('L/min')), 'm³/s');
check('a flux through an area', describe(parseUnit('t/(m2 h)')), 'kg/(m²·s)');
check('energy over a year', describe(parseUnit('kWh/year')), 'W');
// Words that look like units but are not, which is the risk of accepting any
// word at all.
['daily', 'yearly', 'hourly', 'done', 'deadline', 'dry', 'tons_per_thing'].forEach(function (w) {
  check('"' + w + '" is prose', parseUnit(w), null);
});

check('prose is not a unit', parseUnit('temperature in kelvin'), null);
check('a word that is not a unit', parseUnit('nonsense'), null);
check('an empty string', parseUnit(''), null);
check('unbalanced brackets', parseUnit('J/(mol'), null);
check('a trailing operator', parseUnit('m/'), null);
check('a number that is not one', parseUnit('7'), null);

const PY = flavorFor('python', {});
check('a comment declaring a unit', describe(unitComment('T = 300  # K', PY)), 'K');
check('a bracketed comment', describe(unitComment('x = 1 # [J/(mol K)]', PY)), 'J/(mol·K)');
check('a comment with a quotient', describe(unitComment('Q = 2 # m3/s', PY)), 'm³/s');
// "in K" would parse as inch-kelvin if words were read one at a time, which is
// exactly why an unbracketed comment has to be a single run of characters.
check('prose mentioning a unit is still prose', unitComment('T = 300 # in K', PY), null);
check('a sentence', unitComment('n = 7  # this is just a note', PY), null);
check('no comment at all', unitComment('T = 300', PY), null);
check('an empty comment', unitComment('T = 300  #', PY), null);

// ------------------------------------------------------------ what is known

const FILE = [
  'from scipy import constants as cn',
  'import math',
  'T = 300  # K',
  'P = 1.013 * cn.bar',
  'Vol = 0.025  # m3',
  'n_mol = 2.0  # mol',
  'A_col = 1.2  # m2',
  'Q = 0.05  # m3/s',
  'rho = 998  # kg/m3',
  'mu = 1.0e-3  # Pa*s',
  'plain = 42',
  'ratio = P / cn.bar',
  ''
].join('\n');
const ENV = collectUnits(FILE, 'python', CFG);

check('a unit from a comment', describe(ENV.T), 'K');
check('a unit inferred from a scipy constant', describe(ENV.P), 'Pa');
check('a compound unit from a comment', describe(ENV.mu), 'Pa·s');
// A bare number says nothing about what it is a number of. Treating it as
// dimensionless would make `P + plain` look like an error when the only real
// problem is that nobody wrote the unit down.
check('a bare number is not dimensionless, it is unknown', ENV.plain, undefined);
check('but a genuine ratio is dimensionless', describe(ENV.ratio), 'dimensionless');

// ---------------------------------------------------------- units: reported

check('adding two different quantities',
  rules('x = Q / A_col + rho', FILE), 'units');
check('the message names both sides',
  messages('x = Q / A_col + rho', FILE), /m\/s and kg\/m³/);
check('subtracting two different quantities',
  rules('x = Vol - A_col', FILE), 'units');
check('an exponential of a quantity',
  rules('x = math.exp(P)', FILE), 'units');
check('a sine of a quantity',
  rules('x = math.sin(Vol)', FILE), 'units');
check('a comparison between different quantities',
  rules('x = P > Vol', FILE), 'units');
check('an exponent that has units',
  rules('x = 2 ** T', FILE), 'units');
check('hypot given two different quantities',
  rules('x = math.hypot(Vol, A_col)', FILE), 'units');
check('a choice between two different quantities',
  rules('x = Vol if flag else A_col', FILE), 'units');

// ------------------------------------------------------------ units: silent

check('an ideal gas law', rules('G = (P*Vol)/(cn.R*T)', FILE), 'quiet');
check('a molar concentration', rules('c = n_mol / Vol', FILE), 'quiet');
check('a Reynolds number', rules('Re = rho * (Q/A_col) * 0.025 / mu', FILE), 'quiet');
check('a superficial velocity', rules('v = Q / A_col', FILE), 'quiet');
check('a residence time', rules('t = Vol / Q', FILE), 'quiet');
check('pressures of different spellings add up',
  rules('x = P + 2*cn.atm - 3*cn.psi', FILE), 'quiet');
check('a root halves the units', rules('x = math.sqrt(A_col)', FILE), 'quiet');
check('and the root of an area is a length',
  describe(collectUnits(FILE + 'side = math.sqrt(A_col)\n', 'python', CFG).side), 'm');
check('a log of a ratio', rules('x = math.log(P/cn.bar)', FILE), 'quiet');
check('an energy from mass and speed',
  rules('E = 0.5 * 2*cn.gram * (3*cn.kmh)**2', FILE), 'quiet');
check('nothing is said about names with no units',
  rules('x = alpha + beta * gamma', FILE), 'quiet');
check('a bare number added to a quantity is not second-guessed',
  rules('x = P + 1000', FILE), 'quiet');
check('nor is an unknown name', rules('x = P + plain', FILE), 'quiet');
check('an index is the units of what it indexes',
  rules('x = pressures[i] + P', 'P = 1.0 * cn.bar\npressures = []\n'), 'quiet');
// A name used for two different quantities is a name we cannot reason about.
check('a name whose units change is forgotten',
  collectUnits('from scipy import constants as cn\nx = 1*cn.bar\nx = 2*cn.gram\n',
    'python', CFG).x, undefined);
check('and stays forgotten afterwards',
  collectUnits('from scipy import constants as cn\nx = 1*cn.bar\nx = 2*cn.gram\nx = 3*cn.bar\n',
    'python', CFG).x, undefined);

// SI prefixes are numbers, not units: kilo is 1000 and changes nothing.
check('an SI prefix carries no dimension',
  rules('x = cn.kilo * P + cn.atm', FILE), 'quiet');
// Angles are ratios of lengths, so they are dimensionless and may be sined.
check('an angle may be handed to sin',
  rules('x = math.sin(30 * cn.degree)', FILE), 'quiet');

// ---------------------------------------------------------------- the lint

check('degrees into sin', rules('y = math.sin(theta_deg)'), 'degrees');
check('degrees into cos through numpy', rules('y = np.cos(angle_degrees)'), 'degrees');
check('the message says what to do',
  messages('y = math.sin(theta_deg)'), /radians\(theta_deg\)/);
check('radians out of atan kept as degrees',
  rules('theta_deg = math.atan(dy/dx)'), 'degrees');
check('a plain angle is left alone', rules('y = math.sin(theta)'), 'quiet');
check('a name that says radians is left alone', rules('y = math.sin(theta_rad)'), 'quiet');
check('a conversion is left alone', rules('y = math.sin(math.radians(theta_deg))'), 'quiet');
check('a correctly named result is left alone',
  rules('theta_rad = math.atan(dy/dx)'), 'quiet');

check('equality against a float', rules('ok = (a - b) == 1.5'), 'float-equality');
check('inequality against a float', rules('ok = x != 0.1'), 'float-equality');
check('equality against a whole number is fine', rules('ok = n == 3'), 'quiet');
check('equality against a hex number is fine', rules('ok = n == 0xFF'), 'quiet');

check('a minus outside a power of a number', rules('e = -2**2'), 'minus-power');
// With a variable base both readings are ordinary, and the drawing already
// shows which one was written, so there is nothing to warn about.
check('a minus outside a power of a name is left alone', rules('e = -x**2'), 'quiet');
check('a bracketed base is left alone', rules('e = (-2)**2'), 'quiet');

check('integer division in C', rules('d = 1/2', null, 'cpp'), 'integer-division');
check('integer division in Java', rules('d = 1/2', null, 'java'), 'integer-division');
check('the same thing in Python is fine', rules('d = 1/2'), 'quiet');
check('one real number is enough in C', rules('d = 1.0/2', null, 'cpp'), 'quiet');
check('a name is not a literal in C', rules('d = a/2', null, 'cpp'), 'quiet');

check('a comparison chain in C', rules('ok = 0 < i < n', null, 'cpp'), 'comparison-chain');
check('a comparison chain in JavaScript',
  rules('ok = 0 < i < n', null, 'javascript'), 'comparison-chain');
check('the same thing in Python is fine', rules('ok = 0 < i < n'), 'quiet');
check('a bracketed comparison in C is deliberate',
  rules('ok = (0 < i) < n', null, 'cpp'), 'quiet');

check('a mask compared before it is applied in C',
  rules('m = flags & 0xFF == 0', null, 'c'), 'mask-precedence');
check('the same line in Python means what it says',
  rules('m = flags & 0xFF == 0'), 'quiet');
check('brackets settle it in C', rules('m = (flags & 0xFF) == 0', null, 'c'), 'quiet');

// -------------------------------------------------------------- the switches

check('everything off says nothing',
  rules('x = math.exp(P) == 0.5', FILE, 'python', { showChecks: false }), 'quiet');
check('units off leaves the lint',
  rules('x = math.exp(P) == 0.5', FILE, 'python', { checkUnits: false }), 'float-equality');
check('lint off leaves the units',
  rules('x = math.exp(P) == 0.5', FILE, 'python', { lintFormulas: false }), 'units');
check('both on reports both, in the order they appear in the line',
  rules('x = math.exp(P) == 0.5', FILE), 'float-equality,units');

// A remark carries where it is about, so the panel can quote it and jump there.
check('a remark knows its own text', (function () {
  const cfg = Object.assign({}, CFG, { unitEnv: ENV, unitModules: importModules(FILE) });
  const st = analyze('x = Q / A_col + rho', { start: 0, end: 0 }, 'python', cfg).statements[0];
  const c = st.checks[0];
  return c.source;
})(), 'Q / A_col + rho');

// ---------------------------------------------------------------- stability

// A check that throws must cost nothing but the check. The drawing is the part
// that matters, and it has to survive anything the checker meets.
const ODD = [
  'x = ', 'x = )', '', '   ', 'x = y', 'x = [[1,2],[3,4]]', 'x = {"a": 1}',
  'x = lambda t: t**2', 'x = [i for i in range(3)]', 'x = a if b else c',
  'x = f(*args, **kw)', 'x = a[1:2:3]', 'x = -(-(-(-x)))', 'x = T',
  'x = cn.R', 'x = math.sqrt(-1)', 'x = 2**2**2**2', 'x = a.b.c.d.e',
  'x = "text" + 1', 'x = T == T == T'
];
let survived = 0;
ODD.forEach(function (src) {
  try {
    const cfg = Object.assign({}, CFG, { unitEnv: ENV, unitModules: importModules(FILE) });
    const out = analyze(src, { start: 0, end: 0 }, 'python', cfg);
    out.statements.forEach(function (st) {
      if (st.checks && !Array.isArray(st.checks)) throw new Error('checks is not a list');
    });
    survived++;
  } catch (err) {
    console.log('THREW on ' + JSON.stringify(src) + ': ' + err.message);
  }
});
check('odd input never costs the drawing', survived, ODD.length);

// A unit comment is attacker-controlled text like any other comment.
const NASTY = ['m'.repeat(5000), 'm^'.repeat(500) + '2', '(((((((((m)))))))))',
  'm^999999999', 'm^-999999999', '/'.repeat(200), '1/1/1/1/1/1/1/1',
  'K'.repeat(100) + '/' + 's'.repeat(100), '%%%%%', 'µ'.repeat(300)];
let held = 0;
NASTY.forEach(function (u) {
  const started = Date.now();
  try {
    parseUnit(u);
    if (Date.now() - started < 1000) held++;
    else console.log('SLOW on a unit of ' + u.length + ' characters');
  } catch (err) {
    console.log('THREW on a unit of ' + u.length + ' characters: ' + err.message);
  }
});
check('a hostile unit comment is handled quickly', held, NASTY.length);

// Dimension arithmetic itself.
check('the same dimensions compare equal', same(dim({ m: 1 }), dim({ m: 1 })), true);
check('different ones do not', same(dim({ m: 1 }), dim({ s: 1 })), false);
check('an unnamed combination still reads',
  describe(dim({ kg: 1, m: 2, s: -2, mol: -1 })), 'kg·m²/(s²·mol)');
check('a single thing below the line needs no brackets',
  describe(dim({ m: 1, s: -1 })), 'm/s');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
