'use strict';

// Dimensional analysis over a formula. The drawing shows you how an expression
// is built; this says whether what it builds makes physical sense. Adding a
// pressure to a temperature is invisible in both the code and the picture, and
// is exactly the kind of mistake that survives review and ruins a result.
//
// Nothing here guesses. A dimension is known only where it can be traced to a
// constant whose units are a matter of record -- scipy.constants -- or to an
// assignment built out of such constants. Everywhere else the answer is
// "unknown", which propagates and reports nothing. A check that stays quiet
// when it cannot tell is worth having; one that guesses is not.

const { parse, dottedName } = require('./parser');
const { flavorFor } = require('./flavors');
const { stripComments, stripScaffolding, flatten, fromDocument } = require('./prep');
const { importModules } = require('./values');

// Exponents of the seven SI base units, in this order. Rational exponents are
// allowed, since a square root halves them.
const BASE = ['kg', 'm', 's', 'A', 'K', 'mol', 'cd'];
const NONE = [0, 0, 0, 0, 0, 0, 0];

function dim(spec) {
  return BASE.map(function (b) { return spec[b] || 0; });
}

function isNone(d) {
  return d.every(function (x) { return Math.abs(x) < 1e-9; });
}

function same(a, b) {
  if (!a || !b) return false;
  for (let i = 0; i < BASE.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return false;
  }
  return true;
}

function mul(a, b) {
  return a.map(function (x, i) { return x + b[i]; });
}

function div(a, b) {
  return a.map(function (x, i) { return x - b[i]; });
}

function pow(a, n) {
  return a.map(function (x) { return x * n; });
}

// A name a physicist would recognise, so a report reads "pressure (Pa)" rather
// than a vector of exponents.
const NAMED = [
  ['dimensionless', dim({})],
  ['m', dim({ m: 1 })],
  ['kg', dim({ kg: 1 })],
  ['s', dim({ s: 1 })],
  ['A', dim({ A: 1 })],
  ['K', dim({ K: 1 })],
  ['mol', dim({ mol: 1 })],
  ['cd', dim({ cd: 1 })],
  ['m²', dim({ m: 2 })],
  ['m³', dim({ m: 3 })],
  ['m/s', dim({ m: 1, s: -1 })],
  ['m/s²', dim({ m: 1, s: -2 })],
  ['N', dim({ kg: 1, m: 1, s: -2 })],
  ['Pa', dim({ kg: 1, m: -1, s: -2 })],
  ['J', dim({ kg: 1, m: 2, s: -2 })],
  ['W', dim({ kg: 1, m: 2, s: -3 })],
  ['C', dim({ A: 1, s: 1 })],
  ['V', dim({ kg: 1, m: 2, s: -3, A: -1 })],
  ['Ω', dim({ kg: 1, m: 2, s: -3, A: -2 })],
  ['F', dim({ kg: -1, m: -2, s: 4, A: 2 })],
  ['T', dim({ kg: 1, s: -2, A: -1 })],
  ['Hz', dim({ s: -1 })],
  ['J/(mol·K)', dim({ kg: 1, m: 2, s: -2, mol: -1, K: -1 })],
  ['J/K', dim({ kg: 1, m: 2, s: -2, K: -1 })],
  ['J·s', dim({ kg: 1, m: 2, s: -1 })],
  ['1/mol', dim({ mol: -1 })],
  ['1/m', dim({ m: -1 })],
  ['mol/m³', dim({ mol: 1, m: -3 })],
  ['kg/m³', dim({ kg: 1, m: -3 })],
  ['kg/s', dim({ kg: 1, s: -1 })],
  ['mol/s', dim({ mol: 1, s: -1 })],
  ['m³/s', dim({ m: 3, s: -1 })],
  ['Pa·s', dim({ kg: 1, m: -1, s: -1 })],
  ['m²/s', dim({ m: 2, s: -1 })],
  ['W/(m²·K⁴)', dim({ kg: 1, s: -3, K: -4 })],
  ['m·K', dim({ m: 1, K: 1 })]
];

// "Pa", or failing that the exponents themselves, which still make a mismatch
// legible even when the combination has no name.
function describe(d) {
  for (let i = 0; i < NAMED.length; i++) {
    if (same(d, NAMED[i][1])) return NAMED[i][0];
  }
  const top = [];
  const bottom = [];
  BASE.forEach(function (b, i) {
    const n = d[i];
    if (Math.abs(n) < 1e-9) return;
    const mag = Math.abs(n);
    const piece = b + (Math.abs(mag - 1) < 1e-9 ? '' : superscript(round(mag)));
    (n > 0 ? top : bottom).push(piece);
  });
  if (!top.length && !bottom.length) return 'dimensionless';
  if (!bottom.length) return top.join('·');
  // Everything after the slash is below it, which only reads that way with
  // brackets once there is more than one of them.
  const under = bottom.length > 1 ? '(' + bottom.join('·') + ')' : bottom[0];
  return (top.join('·') || '1') + '/' + under;
}

const SUPER = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵',
  '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '.': '·', '-': '⁻', '/': 'ᐟ' };

function superscript(text) {
  return String(text).split('').map(function (ch) {
    return Object.prototype.hasOwnProperty.call(SUPER, ch) ? SUPER[ch] : ch;
  }).join('');
}

function round(n) {
  return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : String(Number(n.toFixed(3)));
}

// ---------------------------------------------------------------- constants

const P = dim({ kg: 1, m: -1, s: -2 });          // pressure
const J = dim({ kg: 1, m: 2, s: -2 });           // energy
const N = dim({ kg: 1, m: 1, s: -2 });           // force
const SPEED = dim({ m: 1, s: -1 });
const LEN = dim({ m: 1 });
const MASS = dim({ kg: 1 });
const TIME = dim({ s: 1 });

// Every name scipy.constants offers, with the units it is documented in. The
// SI prefixes and the ratios are dimensionless on purpose: `kilo` is the
// number 1000, not a unit, and multiplying by it changes nothing dimensionally.
const SCIPY_UNITS = {
  pi: NONE, golden: NONE, golden_ratio: NONE,
  alpha: NONE, fine_structure: NONE,

  c: SPEED, speed_of_light: SPEED,
  mu_0: dim({ kg: 1, m: 1, s: -2, A: -2 }),
  epsilon_0: dim({ kg: -1, m: -3, s: 4, A: 2 }),
  h: dim({ kg: 1, m: 2, s: -1 }), Planck: dim({ kg: 1, m: 2, s: -1 }),
  hbar: dim({ kg: 1, m: 2, s: -1 }),
  G: dim({ m: 3, kg: -1, s: -2 }), gravitational_constant: dim({ m: 3, kg: -1, s: -2 }),
  g: dim({ m: 1, s: -2 }),
  e: dim({ A: 1, s: 1 }), elementary_charge: dim({ A: 1, s: 1 }),
  R: dim({ kg: 1, m: 2, s: -2, mol: -1, K: -1 }),
  gas_constant: dim({ kg: 1, m: 2, s: -2, mol: -1, K: -1 }),
  N_A: dim({ mol: -1 }), Avogadro: dim({ mol: -1 }),
  k: dim({ kg: 1, m: 2, s: -2, K: -1 }), Boltzmann: dim({ kg: 1, m: 2, s: -2, K: -1 }),
  sigma: dim({ kg: 1, s: -3, K: -4 }), Stefan_Boltzmann: dim({ kg: 1, s: -3, K: -4 }),
  Wien: dim({ m: 1, K: 1 }), Rydberg: dim({ m: -1 }),

  m_e: MASS, electron_mass: MASS, m_p: MASS, proton_mass: MASS,
  m_n: MASS, neutron_mass: MASS, m_u: MASS, u: MASS, atomic_mass: MASS,

  zero_Celsius: dim({ K: 1 }),
  // An angle is a ratio of lengths, so radians carry no dimension. The factor
  // still matters numerically, which is why `degree` is in the value table.
  degree: NONE, arcmin: NONE, arcsec: NONE,

  minute: TIME, hour: TIME, day: TIME, week: TIME,
  year: TIME, Julian_year: TIME,

  inch: LEN, foot: LEN, yard: LEN, mile: LEN, mil: LEN, point: LEN, pt: LEN,
  micron: LEN, angstrom: LEN, au: LEN, astronomical_unit: LEN,
  light_year: LEN, parsec: LEN,

  gram: MASS, metric_ton: MASS, pound: MASS, lb: MASS,
  ounce: MASS, oz: MASS, stone: MASS,

  atm: P, atmosphere: P, bar: P, torr: P, mmHg: P, psi: P,

  hectare: dim({ m: 2 }), acre: dim({ m: 2 }),
  liter: dim({ m: 3 }), litre: dim({ m: 3 }), gallon: dim({ m: 3 }),

  kmh: SPEED, mph: SPEED, mach: SPEED, speed_of_sound: SPEED, knot: SPEED,

  eV: J, electron_volt: J, calorie: J, calorie_th: J, calorie_IT: J,
  erg: J, Btu: J, ton_TNT: J,

  hp: dim({ kg: 1, m: 2, s: -3 }), horsepower: dim({ kg: 1, m: 2, s: -3 }),

  dyn: N, dyne: N, lbf: N, pound_force: N, kgf: N, kilogram_force: N,

  yotta: NONE, zetta: NONE, exa: NONE, peta: NONE, tera: NONE, giga: NONE,
  mega: NONE, kilo: NONE, hecto: NONE, deka: NONE, deci: NONE, centi: NONE,
  milli: NONE, micro: NONE, nano: NONE, pico: NONE, femto: NONE,
  atto: NONE, zepto: NONE, yocto: NONE,
  kibi: NONE, mebi: NONE, gibi: NONE, tebi: NONE
};

// ------------------------------------------------------- units written down

// Symbols that may be written in a unit comment. Only multiplicative units are
// here: °C and °F are offsets as well as scales, so `T_c + 10` is meaningful
// while `T_c * 2` is not, and nothing good comes of pretending otherwise.
const SYMBOLS = {
  // the base seven
  m: dim({ m: 1 }), g: MASS, s: TIME, A: dim({ A: 1 }), K: dim({ K: 1 }),
  mol: dim({ mol: 1 }), cd: dim({ cd: 1 }),

  // named derived units
  Hz: dim({ s: -1 }), N: N, Pa: P, J: J, W: dim({ kg: 1, m: 2, s: -3 }),
  C: dim({ A: 1, s: 1 }), V: dim({ kg: 1, m: 2, s: -3, A: -1 }),
  F: dim({ kg: -1, m: -2, s: 4, A: 2 }),
  ohm: dim({ kg: 1, m: 2, s: -3, A: -2 }), 'Ω': dim({ kg: 1, m: 2, s: -3, A: -2 }),
  S: dim({ kg: -1, m: -2, s: 3, A: 2 }), Wb: dim({ kg: 1, m: 2, s: -2, A: -1 }),
  T: dim({ kg: 1, s: -2, A: -1 }), H: dim({ kg: 1, m: 2, s: -2, A: -2 }),
  Bq: dim({ s: -1 }), Gy: dim({ m: 2, s: -2 }), Sv: dim({ m: 2, s: -2 }),
  kat: dim({ mol: 1, s: -1 }),

  // the everyday ones
  L: dim({ m: 3 }), l: dim({ m: 3 }), min: TIME, h: TIME, hr: TIME, d: TIME,
  bar: P, atm: P, torr: P, psi: P, eV: J, cal: J, Wh: J, t: MASS,
  'Å': dim({ m: 1 }), tonne: MASS, ton: MASS,

  // ratios, which are dimensionless but worth being able to write
  rad: NONE, sr: NONE, '%': NONE, ppm: NONE, ppb: NONE, deg: NONE
};

// Prefixes never change a dimension, only a magnitude, so they are stripped
// and discarded. `da` is checked before `d` so that dag is not deci-ag.
const PREFIXES = ['da', 'Y', 'Z', 'E', 'P', 'T', 'G', 'M', 'k', 'h', 'd', 'c',
  'm', 'u', 'µ', 'μ', 'n', 'p', 'f', 'a', 'z', 'y'];

function symbolDims(word) {
  if (Object.prototype.hasOwnProperty.call(SYMBOLS, word)) return SYMBOLS[word];
  for (let i = 0; i < PREFIXES.length; i++) {
    const p = PREFIXES[i];
    if (word.length > p.length && word.slice(0, p.length) === p) {
      const rest = word.slice(p.length);
      if (Object.prototype.hasOwnProperty.call(SYMBOLS, rest)) return SYMBOLS[rest];
    }
  }
  return null;
}

// Reads "kg*m/s^2", "J/(mol K)", "m3" and the like. Returns null on anything it
// does not fully understand, so a comment that is prose stays prose.
function parseUnit(text) {
  const src = String(text).trim();
  if (!src) return null;
  let i = 0;

  const ws = function () { while (i < src.length && src[i] === ' ') i++; };

  const factor = function () {
    ws();
    if (src[i] === '(') {
      i++;
      const inner = product();
      ws();
      if (src[i] !== ')') return null;
      i++;
      return inner === null ? null : exponent(inner);
    }
    if (/^\d/.test(src.slice(i))) {
      // A bare 1, as in "1/s".
      const n = /^\d+/.exec(src.slice(i))[0];
      i += n.length;
      if (n !== '1') return null;
      return NONE;
    }
    const word = /^[A-Za-zΩÅµμ%]+/.exec(src.slice(i));
    if (!word) return null;
    i += word[0].length;
    const dims = symbolDims(word[0]);
    if (dims === null) return null;
    return exponent(dims);
  };

  const exponent = function (dims) {
    let n = null;
    if (src.slice(i, i + 2) === '**') { i += 2; n = signedNumber(); }
    else if (src[i] === '^') { i += 1; n = signedNumber(); }
    else {
      // "m3" and "s-1", written without a marker.
      const bare = /^-?\d+/.exec(src.slice(i));
      if (bare) { i += bare[0].length; n = Number(bare[0]); }
    }
    if (n === null) return dims;
    if (!Number.isFinite(n)) return null;
    return pow(dims, n);
  };

  const signedNumber = function () {
    const m = /^[-+]?\d+(?:\.\d+)?/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };

  const product = function () {
    let acc = factor();
    if (acc === null) return null;
    for (;;) {
      // Whether a space was crossed matters here -- it is what separates two
      // multiplied symbols -- so it is noted before being skipped.
      const before = i;
      ws();
      const spaced = i > before;
      const ch = src[i];
      if (ch === '*' || ch === '.' || ch === '·') {
        i++;
        const next = factor();
        if (next === null) return null;
        acc = mul(acc, next);
        continue;
      }
      if (ch === '/') {
        i++;
        const next = factor();
        if (next === null) return null;
        acc = div(acc, next);
        continue;
      }
      // A space between two symbols multiplies them: "J/(mol K)".
      if (spaced && ch !== undefined && /[A-Za-zΩÅµμ(1]/.test(ch)) {
        const save = i;
        const next = factor();
        if (next === null) { i = save; return acc; }
        acc = mul(acc, next);
        continue;
      }
      if (spaced) i = before;
      return acc;
    }
  };

  const result = product();
  ws();
  return i === src.length ? result : null;
}

// The unit a trailing comment declares, if it declares one.
//
// Two spellings are accepted, and nothing else. In brackets -- `# [J/(mol K)]`
// -- anything that parses counts. Without brackets the comment has to be a
// single run of characters, so `# K` and `# kg/s` are units while `# in K` and
// `# temperature in kelvin` are what they look like: prose.
function unitComment(line, flavor) {
  const marker = (flavor && flavor.lineComment) || '#';
  const at = String(line).indexOf(marker);
  if (at < 0) return null;
  const body = String(line).slice(at + marker.length).trim();
  if (!body) return null;

  const bracketed = /^[[(]\s*(.+?)\s*[\])]$/.exec(body);
  if (bracketed) return parseUnit(bracketed[1]);
  if (/\s/.test(body)) return null;
  if (body.length > 24) return null;
  return parseUnit(body);
}

// math and numpy offer numbers, not quantities.
const PLAIN_MODULES = new Set(['math', 'cmath', 'numpy']);

const MODULE_UNITS = {
  'scipy.constants': SCIPY_UNITS
};

// ------------------------------------------------------------- the functions

// Functions whose argument is a pure number by definition: an exponent, an
// angle in radians, the argument of a logarithm. Passing a quantity to one of
// these is a dimensional error however plausible the arithmetic looks.
const NEEDS_PLAIN = new Set([
  'exp', 'expm1', 'exp2', 'log', 'ln', 'log1p', 'log2', 'log10',
  'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh',
  'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
  'asinh', 'acosh', 'atanh', 'degrees', 'radians', 'erf', 'erfc', 'gamma'
]);
// ... and which return a pure number.
const RETURNS_PLAIN = new Set([
  'exp', 'expm1', 'exp2', 'log', 'ln', 'log1p', 'log2', 'log10',
  'sin', 'cos', 'tan', 'sinh', 'cosh', 'tanh',
  'asin', 'acos', 'atan', 'arcsin', 'arccos', 'arctan',
  'asinh', 'acosh', 'atanh', 'atan2', 'degrees', 'radians',
  'erf', 'erfc', 'gamma', 'sign', 'signum'
]);
// Functions that pass their argument's units straight through.
const KEEPS = new Set([
  'abs', 'fabs', 'floor', 'ceil', 'round', 'trunc', 'min', 'max',
  'sum', 'mean', 'average', 'median', 'std', 'amin', 'amax', 'fmin', 'fmax'
]);
// Functions whose arguments must agree with one another.
const AGREES = new Set(['min', 'max', 'fmin', 'fmax', 'hypot', 'atan2', 'fmod', 'copysign']);

// ------------------------------------------------------------------ the walk

// The result of inferring one node: `dims` is null when nothing is known, which
// is not an error and never reported.
function unknown() { return null; }

function makeChecker(env, modules, strip) {
  const problems = [];
  // Whether anything in this expression had units on the record. `2 * 3.5` is
  // dimensionless as an expression but says nothing about what the number is
  // for, so a name assigned from it stays unknown; `P / cn.bar` is a genuine
  // ratio and is dimensionless for a reason.
  const state = { touched: false };

  function report(node, message) {
    if (!node) return;
    problems.push({
      rule: 'units',
      message: message,
      s: typeof node.s === 'number' ? node.s : 0,
      e: typeof node.e === 'number' ? node.e : 0
    });
  }

  // What a dotted name is worth dimensionally: cn.bar through the alias table,
  // and math.pi as a plain number.
  function fromModule(dotted) {
    const parts = dotted.split('.');
    if (parts.length < 2) return undefined;
    const attr = parts[parts.length - 1];
    const alias = parts.slice(0, -1).join('.');
    const module = modules[alias] || (strip.has(alias) ? alias : null);
    if (!module) return undefined;
    if (PLAIN_MODULES.has(module)) return NONE;
    const table = MODULE_UNITS[module];
    if (table && Object.prototype.hasOwnProperty.call(table, attr)) return table[attr];
    return undefined;
  }

  function lookup(name) {
    if (Object.prototype.hasOwnProperty.call(env, name)) {
      state.touched = true;
      return env[name];
    }
    const viaModule = fromModule(name);
    if (viaModule !== undefined) {
      state.touched = true;
      return viaModule;
    }
    return undefined;
  }

  function go(node) {
    if (!node || typeof node !== 'object') return unknown();
    switch (node.type) {
      case 'Num':
        return NONE;
      case 'Str':
        return unknown();
      case 'Ident': {
        const d = lookup(node.name);
        return d === undefined ? unknown() : d;
      }
      case 'Member': {
        const dotted = dottedName(node);
        if (dotted === null) { go(node.obj); return unknown(); }
        const d = lookup(dotted);
        return d === undefined ? unknown() : d;
      }
      case 'Unary':
        return node.op === '-' || node.op === '+' ? go(node.arg) : (go(node.arg), unknown());
      case 'Binary':
        return binary(node);
      case 'Ternary': {
        const a = go(node.then);
        const b = node.other ? go(node.other) : null;
        go(node.cond);
        if (a && b && !same(a, b)) {
          report(node, 'The two results of this choice have different units: ' +
            describe(a) + ' and ' + describe(b) + '.');
          return unknown();
        }
        return a || b || unknown();
      }
      case 'Call':
        return call(node);
      case 'Assign': {
        const r = go(node.r);
        return r;
      }
      case 'Index': {
        // An element of an array has the units of the array.
        node.args.forEach(go);
        return go(node.obj);
      }
      default: {
        // Walk on so that anything reportable deeper down is still found.
        Object.keys(node).forEach(function (key) {
          if (key === 'type' || key === 's' || key === 'e') return;
          const child = node[key];
          if (Array.isArray(child)) child.forEach(go);
          else if (child && typeof child === 'object') go(child);
        });
        return unknown();
      }
    }
  }

  function binary(node) {
    const op = node.op;
    const l = go(node.l);
    const r = go(node.r);

    if (op === '+' || op === '-') {
      // `P + 101325` is someone writing a pressure as a bare number, which is
      // ordinary and not worth a remark. `P + ratio` is a named quantity that
      // genuinely has no units, and that is worth one.
      if (l && r && !same(l, r)) {
        if (isNone(r) && literalOnly(node.r)) return l;
        if (isNone(l) && literalOnly(node.l)) return r;
      }
      if (l && r && !same(l, r)) {
        report(node, 'This ' + (op === '+' ? 'adds' : 'subtracts') + ' ' +
          describe(l) + ' and ' + describe(r) + ', which are different kinds of quantity.');
        return unknown();
      }
      return l || r || unknown();
    }

    if (op === '*' || op === '.*') return l && r ? mul(l, r) : unknown();
    if (op === '/' || op === './' || op === '//') return l && r ? div(l, r) : unknown();

    if (op === '%') return l || unknown();

    if (op === '**' || op === '^' || op === '.^') {
      if (r && !isNone(r)) {
        report(node.r, 'An exponent has to be a plain number, but this one is in ' +
          describe(r) + '.');
        return unknown();
      }
      if (!l || isNone(l)) return l;
      const n = literalNumber(node.r);
      if (n === null) {
        // A quantity raised to a power nobody can pin down has no dimension we
        // can carry forward, but it is not in itself a mistake.
        return unknown();
      }
      return pow(l, n);
    }

    if (op === '==' || op === '!=' || op === '===' || op === '!==' ||
        op === '<' || op === '>' || op === '<=' || op === '>=') {
      if (l && r && !same(l, r)) {
        report(node, 'This compares ' + describe(l) + ' with ' + describe(r) +
          ', which are different kinds of quantity.');
      }
      return NONE;
    }

    if (op === '&&' || op === '||' || op === 'and' || op === 'or') return NONE;

    // Shifts and bitwise work on bit patterns; units are meaningless there.
    return unknown();
  }

  // Arithmetic over nothing but numbers written in the line itself.
  function literalOnly(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'Num') return true;
    if (node.type === 'Unary') return literalOnly(node.arg);
    if (node.type === 'Binary') return literalOnly(node.l) && literalOnly(node.r);
    return false;
  }

  function literalNumber(node) {
    if (!node) return null;
    if (node.type === 'Num') {
      const n = Number(String(node.v).replace(/_/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    if (node.type === 'Unary' && node.op === '-') {
      const inner = literalNumber(node.arg);
      return inner === null ? null : -inner;
    }
    // A half from `x ** (1/2)`, which is how a root is often written.
    if (node.type === 'Binary' && node.op === '/') {
      const a = literalNumber(node.l);
      const b = literalNumber(node.r);
      return a === null || b === null || b === 0 ? null : a / b;
    }
    return null;
  }

  function call(node) {
    const dotted = dottedName(node.callee);
    const name = dotted ? dotted.split('.').pop() : null;
    const args = node.args.filter(function (a) {
      return a && a.type !== 'KeyVal' && a.type !== 'Spread';
    });
    const dims = args.map(go);

    if (!name) return unknown();

    if (name === 'sqrt') {
      return dims[0] ? pow(dims[0], 0.5) : unknown();
    }
    if (name === 'cbrt') {
      return dims[0] ? pow(dims[0], 1 / 3) : unknown();
    }

    if (NEEDS_PLAIN.has(name) && dims[0] && !isNone(dims[0])) {
      report(args[0], name + ' needs a plain number, but this is in ' +
        describe(dims[0]) + '.');
    }

    if (AGREES.has(name) && dims.length > 1) {
      for (let i = 1; i < dims.length; i++) {
        if (dims[0] && dims[i] && !same(dims[0], dims[i])) {
          report(node, name + ' is given ' + describe(dims[0]) + ' and ' +
            describe(dims[i]) + ', which are different kinds of quantity.');
          break;
        }
      }
    }

    if (RETURNS_PLAIN.has(name)) return NONE;
    if (name === 'hypot') return dims[0] || unknown();
    if (KEEPS.has(name)) return dims[0] || unknown();
    return unknown();
  }

  return { go: go, problems: problems, state: state };
}

// Checks one parsed statement. `env` maps a name to its dimension vector.
function checkUnits(ast, context) {
  const ctx = context || {};
  // Nothing is caught here: the caller decides whether a failed check should
  // be silence or a failed test, and there is only one such decision to make.
  const checker = makeChecker(ctx.env || {}, ctx.modules || {}, new Set(ctx.stripNamespaces || []));
  checker.go(ast);
  return checker.problems;
}

// --------------------------------------------------------------- the scanner

const ASSIGN = /^([A-Za-z_$À-￿][\w$.À-￿]*)\s*(?::\s*[^=]+?\s*)?(=|\+=|-=|\*=|\/=|\*\*=|:=)\s*(.+)$/;

// Reads the file above the cursor for what each name is a quantity of.
//
// Unlike the value scanner this one is happy with a name defined in terms of
// itself: `v = v - g*dt` has no single value, but its dimensions are fixed and
// are exactly what we want to know. What it will not do is let a name's units
// change halfway down the file -- that is either a mistake or a reuse we cannot
// reason about, so the name is forgotten.
function collectUnits(text, languageId, config) {
  const cfg = config || {};
  const flavor = flavorFor(languageId, cfg);
  const strip = new Set(cfg.stripNamespaces || []);
  const modules = importModules(text);
  const env = {};
  const banned = Object.create(null);

  const lines = String(text).split('\n');
  const start = Math.max(0, lines.length - (cfg.valueScanLines || 500));

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.indexOf('=') === -1) continue;

    let line;
    try {
      line = flatten(stripComments(fromDocument(raw, 0), flavor));
      line = stripScaffolding(line).text;
    } catch (err) {
      continue;
    }
    const m = ASSIGN.exec(line);
    if (!m) continue;
    const name = m[1];
    const rhs = m[3];
    if (/^=/.test(rhs)) continue;

    // A unit written in a comment is not a guess, it is a statement, and it
    // beats anything inferred from the arithmetic.
    const declared = unitComment(raw, flavor);
    if (declared) {
      if (Object.prototype.hasOwnProperty.call(env, name) && !same(env[name], declared)) {
        banned[name] = true;
      }
      if (!banned[name]) env[name] = declared;
      continue;
    }

    let dims = null;
    let touched = false;
    try {
      const ast = parse(rhs, flavor);
      // Problems found while scanning are not reported: they belong to lines
      // the cursor is not on, and the panel only speaks about what it is
      // showing. The dimension is still worth keeping.
      const checker = makeChecker(env, modules, strip);
      dims = checker.go(ast);
      touched = checker.state.touched;
    } catch (err) {
      dims = null;
    }

    // `T = 300` tells us nothing: the number could be kelvin, seconds or a
    // count, and assuming it is a pure number would make `P + T` look like an
    // error when the only real error is that nobody wrote the unit down.
    // Nothing on the record means nothing is claimed.
    if (dims === null || !touched) {
      delete env[name];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(env, name) && !same(env[name], dims)) {
      banned[name] = true;
      delete env[name];
      continue;
    }
    if (banned[name]) continue;
    env[name] = dims;

    const parts = name.split('.');
    if (parts.length > 1 && strip.has(parts[0])) env[parts[parts.length - 1]] = dims;
  }

  return env;
}

module.exports = {
  checkUnits: checkUnits,
  collectUnits: collectUnits,
  parseUnit: parseUnit,
  unitComment: unitComment,
  describe: describe,
  dim: dim,
  same: same,
  SCIPY_UNITS: SCIPY_UNITS,
  BASE: BASE
};
