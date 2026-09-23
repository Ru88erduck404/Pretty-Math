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
function evaluate(node, env, strip) {
  if (!node) return null;
  const known = env || {};
  const stripped = strip || new Set();

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
      // math.pi and np.pi are the same constant once the qualifier is dropped.
      if (parts.length > 1 && stripped.has(parts[0])) return lookup(parts[parts.length - 1]);
      return null;
    }

    case 'Cast':
      return evaluate(node.arg, known, stripped);

    case 'Unary': {
      const v = evaluate(node.arg, known, stripped);
      if (v === null) return null;
      if (node.op === '-') return -v;
      if (node.op === '+') return v;
      if (node.op === '~') return ~v;
      if (node.op === '!') return v ? 0 : 1;
      return null;
    }

    case 'Binary': {
      const a = evaluate(node.l, known, stripped);
      if (a === null) return null;
      const b = evaluate(node.r, known, stripped);
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
        const v = evaluate(a, known, stripped);
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
    return n.toExponential(Math.min(d - 1, 4))
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
  CONSTANTS: CONSTANTS
};
