'use strict';

// A small, closed evaluator over the parsed expression. It exists so that
// `n = 60 * 60` can be shown as 3600 without running any of the user's code:
// nothing here calls eval, spawns anything, or reaches outside this table.

const { dottedName } = require('./parser');

const CONSTANTS = {
  pi: Math.PI, PI: Math.PI, M_PI: Math.PI, Pi: Math.PI,
  tau: Math.PI * 2, TAU: Math.PI * 2,
  e: Math.E, E: Math.E, M_E: Math.E,
  inf: Infinity, Inf: Infinity, INF: Infinity, infinity: Infinity,
  Infinity: Infinity, INFINITY: Infinity, oo: Infinity,
  nan: NaN, NaN: NaN, NAN: NaN
};

// scipy.constants. Without these, one `cn.bar` in a chain of assignments makes
// everything downstream of it unknown -- which is how a whole notebook ends up
// showing no values at all. The SI-exact ones are exact; the measured ones are
// CODATA 2018, the same source scipy uses.
const SCIPY_CONSTANTS = {
  pi: Math.PI, golden: 1.618033988749895, golden_ratio: 1.618033988749895,

  c: 299792458, speed_of_light: 299792458,
  mu_0: 1.25663706212e-6, epsilon_0: 8.8541878128e-12,
  h: 6.62607015e-34, Planck: 6.62607015e-34, hbar: 1.0545718176461565e-34,
  G: 6.6743e-11, gravitational_constant: 6.6743e-11,
  g: 9.80665,
  e: 1.602176634e-19, elementary_charge: 1.602176634e-19,
  R: 8.314462618, gas_constant: 8.314462618,
  alpha: 0.0072973525693, fine_structure: 0.0072973525693,
  N_A: 6.02214076e23, Avogadro: 6.02214076e23,
  k: 1.380649e-23, Boltzmann: 1.380649e-23,
  sigma: 5.670374419e-8, Stefan_Boltzmann: 5.670374419e-8,
  Wien: 2.897771955e-3, Rydberg: 10973731.56816,

  m_e: 9.1093837015e-31, electron_mass: 9.1093837015e-31,
  m_p: 1.67262192369e-27, proton_mass: 1.67262192369e-27,
  m_n: 1.67492749804e-27, neutron_mass: 1.67492749804e-27,
  m_u: 1.6605390666e-27, u: 1.6605390666e-27, atomic_mass: 1.6605390666e-27,

  zero_Celsius: 273.15, degree: Math.PI / 180, arcmin: Math.PI / 10800,
  arcsec: Math.PI / 648000,

  minute: 60, hour: 3600, day: 86400, week: 604800,
  year: 31536000, Julian_year: 31557600,

  inch: 0.0254, foot: 0.3048, yard: 0.9144, mile: 1609.344,
  mil: 2.54e-5, point: 0.000352777777778, pt: 0.000352777777778,
  micron: 1e-6, angstrom: 1e-10, au: 149597870700, astronomical_unit: 149597870700,
  light_year: 9460730472580800, parsec: 3.0856775814913673e16,

  gram: 1e-3, metric_ton: 1e3, pound: 0.45359237, lb: 0.45359237,
  ounce: 0.028349523125, oz: 0.028349523125, stone: 6.35029318,

  atm: 101325, atmosphere: 101325, bar: 1e5, torr: 133.32236842105263,
  mmHg: 133.32236842105263, psi: 6894.757293168361,

  hectare: 1e4, acre: 4046.8564224,
  liter: 1e-3, litre: 1e-3, gallon: 0.0037854117839999997,

  kmh: 0.2777777777777778, mph: 0.44703999999999994, mach: 340.5,
  speed_of_sound: 340.5, knot: 0.5144444444444445,

  eV: 1.602176634e-19, electron_volt: 1.602176634e-19,
  calorie: 4.184, calorie_th: 4.184, calorie_IT: 4.1868,
  erg: 1e-7, Btu: 1055.05585262, ton_TNT: 4.184e9,
  hp: 745.6998715822702, horsepower: 745.6998715822702,
  dyn: 1e-5, dyne: 1e-5, lbf: 4.4482216152605, pound_force: 4.4482216152605,
  kgf: 9.80665, kilogram_force: 9.80665,

  yotta: 1e24, zetta: 1e21, exa: 1e18, peta: 1e15, tera: 1e12, giga: 1e9,
  mega: 1e6, kilo: 1e3, hecto: 100, deka: 10, deci: 0.1, centi: 0.01,
  milli: 1e-3, micro: 1e-6, nano: 1e-9, pico: 1e-12, femto: 1e-15,
  atto: 1e-18, zepto: 1e-21, yocto: 1e-24,
  kibi: 1024, mebi: 1048576, gibi: 1073741824, tebi: 1099511627776
};

// What each module offers by name, looked up through whatever the file called
// it: `from scipy import constants as cn` makes cn.bar this table's bar.
const MODULE_CONSTANTS = {
  'scipy.constants': SCIPY_CONSTANTS,
  'math': CONSTANTS,
  'cmath': CONSTANTS,
  'numpy': CONSTANTS
};

const FUNCTIONS = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, fabs: Math.abs,
  exp: Math.exp, expm1: Math.expm1, log: Math.log, ln: Math.log,
  log1p: Math.log1p, log2: Math.log2, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  sign: Math.sign, hypot: Math.hypot, pow: Math.pow,
  min: Math.min, max: Math.max,
  degrees: function (x) { return x * 180 / Math.PI },
  radians: function (x) { return x * Math.PI / 180 },
  fmod: function (a, b) { return a % b },
  factorial: function (n) {
    if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
    let out = 1;
    for (let i = 2; i <= n; i++) out *= i;
    return out;
  }
};

// Accepts what the lexer produces: 1_000, 0xFF, 1e-3, 2.5f, .5
function parseNumber(text) {
  const t = String(text).replace(/_/g, '');
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^0[bB][01]+$/.test(t)) return parseInt(t.slice(2), 2);
  if (/^0[oO][0-7]+$/.test(t)) return parseInt(t.slice(2), 8);
  const n = parseFloat(t.replace(/[fFlLuUdD]$/, ''));
  return Number.isNaN(n) ? null : n;
}

// Returns a number, or null when anything in the expression is unknown. Null
// propagates, so a single unknown name makes the whole value unknown rather
// than producing a confident wrong answer.
function evaluate(node, env, strip, modules) {
  if (!node) return null;
  const known = env || {};
  const stripped = strip || new Set();
  const aliases = modules || {};

  // `cn.bar` where the file said `from scipy import constants as cn`.
  const fromModule = function (parts) {
    for (let take = parts.length - 1; take >= 1; take--) {
      const module = aliases[parts.slice(0, take).join('.')];
      const table = module ? MODULE_CONSTANTS[module] : null;
      if (!table) continue;
      const rest = parts.slice(take).join('.');
      if (Object.prototype.hasOwnProperty.call(table, rest)) return table[rest];
    }
    return null;
  };

  const lookup = function (name) {
    if (Object.prototype.hasOwnProperty.call(known, name)) {
      const v = known[name];
      return typeof v === 'number' ? v : (v && typeof v.num === 'number' ? v.num : null);
    }
    if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) return CONSTANTS[name];
    return null;
  };

  switch (node.type) {
    case 'Num':
      return parseNumber(node.v);

    case 'Ident':
      return lookup(node.name);

    case 'Member': {
      const dotted = dottedName(node);
      if (dotted === null) return null;
      const direct = lookup(dotted);
      if (direct !== null) return direct;
      const parts = dotted.split('.');
      // A module's own constant, found through the name the file gave it.
      const module = fromModule(parts);
      if (module !== null) return module;
      // math.pi and np.pi are the same constant once the qualifier is dropped.
      if (parts.length > 1 && stripped.has(parts[0])) return lookup(parts[parts.length - 1]);
      return null;
    }

    case 'Cast':
      return evaluate(node.arg, known, stripped, aliases);

    case 'Unary': {
      const v = evaluate(node.arg, known, stripped, aliases);
      if (v === null) return null;
      if (node.op === '-') return -v;
      if (node.op === '+') return v;
      if (node.op === '~') return ~v;
      if (node.op === '!') return v ? 0 : 1;
      return null;
    }

    case 'Binary': {
      const a = evaluate(node.l, known, stripped, aliases);
      if (a === null) return null;
      const b = evaluate(node.r, known, stripped, aliases);
      if (b === null) return null;
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': case '@': case '.*': return a * b;
        case '/': case './': return b === 0 ? null : a / b;
        case '//': return b === 0 ? null : Math.floor(a / b);
        case '%': case 'mod': return b === 0 ? null : a - b * Math.floor(a / b);
        case '**': case '.^': return Math.pow(a, b);
        case '&': return a & b;
        case '|': return a | b;
        case 'xor': return a ^ b;
        case '<<': return a << b;
        case '>>': return a >> b;
        default: return null;
      }
    }

    case 'Call': {
      const name = dottedName(node.callee);
      if (name === null) return null;
      const parts = name.split('.');
      const fn = FUNCTIONS[parts[parts.length - 1]];
      if (!fn) return null;
      const args = [];
      for (let i = 0; i < node.args.length; i++) {
        const a = node.args[i];
        if (a.type === 'KeyVal' || a.type === 'Spread') return null;
        const v = evaluate(a, known, stripped, aliases);
        if (v === null) return null;
        args.push(v);
      }
      const out = fn.apply(null, args);
      return typeof out === 'number' && !Number.isNaN(out) ? out : null;
    }

    default:
      return null;
  }
}

// Short enough to sit inside a formula without swamping it.
function formatNumber(n, digits) {
  const d = digits || 6;
  if (typeof n !== 'number' || Number.isNaN(n)) return null;
  if (!Number.isFinite(n)) return n > 0 ? '∞' : '−∞';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);

  const size = Math.abs(n);
  if (size !== 0 && (size < 1e-4 || size >= 1e9)) {
    // The configured number of significant digits applies here too: capping it
    // made 1.380649e-23 print as 1.3806e-23 whatever the setting said.
    return n.toExponential(Math.max(0, Math.min(d - 1, 16)))
      .replace(/\.?0+e/, 'e')
      .replace('e+', 'e');
  }
  let s = n.toPrecision(d);
  if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

module.exports = {
  evaluate: evaluate,
  parseNumber: parseNumber,
  formatNumber: formatNumber,
  CONSTANTS: CONSTANTS,
  SCIPY_CONSTANTS: SCIPY_CONSTANTS,
  MODULE_CONSTANTS: MODULE_CONSTANTS
};
