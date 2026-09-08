'use strict';

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', eps: 'ε', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', lam: 'λ', lmbda: 'λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
  Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  nabla: '∇', partial: '∂', infty: '∞'
};

const GREEK_TEX = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta',
  'ε': 'epsilon', 'ζ': 'zeta', 'η': 'eta', 'θ': 'theta',
  'ϑ': 'vartheta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda',
  'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ρ': 'rho',
  'σ': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'φ': 'phi',
  'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
  'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda',
  'Ξ': 'Xi', 'Π': 'Pi', 'Σ': 'Sigma', 'Υ': 'Upsilon',
  'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
  '∇': 'nabla', '∂': 'partial', '∞': 'infty'
};

// Names that stand for a constant rather than a variable. `e` and `E` are left
// alone on purpose: in real code they are far more often energy or a matrix.
const CONSTANTS = {
  pi: 'π', PI: 'π', M_PI: 'π', Pi: 'π',
  tau: 'τ', TAU: 'τ',
  inf: '∞', Inf: '∞', INF: '∞', infinity: '∞',
  Infinity: '∞', INFINITY: '∞', oo: '∞',
  M_E: '𝘦'
};

// How a call is drawn. `kind` picks the layout in render.js.
const FUNCTIONS = {
  sqrt: { kind: 'sqrt' },
  Sqrt: { kind: 'sqrt' },
  cbrt: { kind: 'sqrt', index: '3' },
  abs: { kind: 'fence', open: '|', close: '|' },
  fabs: { kind: 'fence', open: '|', close: '|' },
  norm: { kind: 'fence', open: '‖', close: '‖' },
  magnitude: { kind: 'fence', open: '‖', close: '‖' },
  floor: { kind: 'fence', open: '⌊', close: '⌋' },
  ceil: { kind: 'fence', open: '⌈', close: '⌉' },
  ceiling: { kind: 'fence', open: '⌈', close: '⌉' },
  round: { kind: 'fence', open: '⌊', close: '⌉' },
  pow: { kind: 'pow' },
  power: { kind: 'pow' },
  exp: { kind: 'exp' },
  expm1: { kind: 'expm1' },
  log1p: { kind: 'log1p' },
  hypot: { kind: 'hypot' },
  log: { kind: 'log' },
  ln: { kind: 'named', name: 'ln', bare: true },
  log2: { kind: 'named', name: 'log', sub: '2', bare: true },
  log10: { kind: 'named', name: 'log', sub: '10', bare: true },
  logb: { kind: 'log' },
  factorial: { kind: 'factorial' },
  binom: { kind: 'binom' },
  comb: { kind: 'binom' },
  choose: { kind: 'binom' },
  nchoosek: { kind: 'binom' },
  fmod: { kind: 'mod' },
  mod: { kind: 'mod' },
  remainder: { kind: 'mod' },
  dot: { kind: 'infix', glyph: '·' },
  cross: { kind: 'infix', glyph: '×' },
  inv: { kind: 'superscript', sup: '−1' },
  pinv: { kind: 'superscript', sup: '+' },
  transpose: { kind: 'superscript', sup: 'ᵀ' },
  det: { kind: 'named', name: 'det', bare: true },
  trace: { kind: 'named', name: 'tr', bare: true },
  tr: { kind: 'named', name: 'tr', bare: true },
  sign: { kind: 'named', name: 'sgn', bare: true },
  sgn: { kind: 'named', name: 'sgn', bare: true },
  signum: { kind: 'named', name: 'sgn', bare: true },
  sum: { kind: 'bigop', glyph: '∑' },
  prod: { kind: 'bigop', glyph: '∏' },

  // ---- calculus (SymPy, and the numerical stand-ins in NumPy/SciPy) --------
  diff: { kind: 'derivative' },
  Derivative: { kind: 'derivative' },
  derivative: { kind: 'derivative' },
  integrate: { kind: 'integral' },
  Integral: { kind: 'integral' },
  quad: { kind: 'integral', fixedLimits: true },
  trapz: { kind: 'integral', numeric: true },
  trapezoid: { kind: 'integral', numeric: true },
  simps: { kind: 'integral', numeric: true },
  simpson: { kind: 'integral', numeric: true },
  Sum: { kind: 'bigsum', glyph: '∑' },
  summation: { kind: 'bigsum', glyph: '∑' },
  Product: { kind: 'bigsum', glyph: '∏' },
  product: { kind: 'bigsum', glyph: '∏' },
  limit: { kind: 'limit' },
  Limit: { kind: 'limit' },
  gradient: { kind: 'nabla' },
  Eq: { kind: 'relation', glyph: '=' },
  Ne: { kind: 'relation', glyph: '≠' },
  Lt: { kind: 'relation', glyph: '<' },
  Le: { kind: 'relation', glyph: '≤' },
  Gt: { kind: 'relation', glyph: '>' },
  Ge: { kind: 'relation', glyph: '≥' },
  Abs: { kind: 'fence', open: '|', close: '|' },
  Rational: { kind: 'fraction' },
  Pow: { kind: 'pow' },
  binomial: { kind: 'binom' }
};

// numpy.diff is a discrete difference, not a derivative, so it is drawn as one.
const DISCRETE_NAMESPACES = new Set(['np', 'numpy', 'jnp', 'cupy', 'torch', 'pd', 'pandas']);

// Upright function names drawn without parentheses around a simple argument.
const BARE_NAMES = [
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch',
  'asin', 'acos', 'atan', 'acot', 'asec', 'acsc',
  'arcsin', 'arccos', 'arctan', 'arccot',
  'asinh', 'acosh', 'atanh', 'arsinh', 'arcosh', 'artanh',
  'sind', 'cosd', 'tand'
];
BARE_NAMES.forEach(function (n) {
  if (!FUNCTIONS[n]) FUNCTIONS[n] = { kind: 'named', name: n, bare: true };
});

// The trigonometric family accepts sin(x)**2 drawn as sin^2 x.
const POWERABLE = new Set(BARE_NAMES.concat(['ln', 'log', 'log2', 'log10']));

const OPS = {
  '+': { glyph: '+', cls: 'bin' },
  '-': { glyph: '−', cls: 'bin' },
  '*': { glyph: '·', cls: 'bin' },
  '%': { glyph: 'mod', cls: 'word' },
  'mod': { glyph: 'mod', cls: 'word' },
  'div': { glyph: 'div', cls: 'word' },
  '@': { glyph: '·', cls: 'bin' },
  '.*': { glyph: '⊙', cls: 'bin' },
  './': { glyph: '⊘', cls: 'bin' },
  '==': { glyph: '=', cls: 'rel' },
  '===': { glyph: '=', cls: 'rel' },
  '!=': { glyph: '≠', cls: 'rel' },
  '!==': { glyph: '≠', cls: 'rel' },
  '<': { glyph: '<', cls: 'rel' },
  '>': { glyph: '>', cls: 'rel' },
  '<=': { glyph: '≤', cls: 'rel' },
  '>=': { glyph: '≥', cls: 'rel' },
  'in': { glyph: '∈', cls: 'rel' },
  'is': { glyph: 'is', cls: 'word' },
  '&&': { glyph: '∧', cls: 'logic' },
  'and': { glyph: '∧', cls: 'logic' },
  '||': { glyph: '∨', cls: 'logic' },
  'or': { glyph: '∨', cls: 'logic' },
  '&': { glyph: '&', cls: 'bitwise' },
  '|': { glyph: '|', cls: 'bitwise' },
  'xor': { glyph: '⊕', cls: 'bitwise' },
  '<<': { glyph: '≪', cls: 'bitwise' },
  '>>': { glyph: '≫', cls: 'bitwise' },
  '>>>': { glyph: '≫≫', cls: 'bitwise' }
};

const OPS_TEX = {
  '+': '+', '-': '-', '*': '\\cdot', '%': '\\bmod', 'mod': '\\bmod', 'div': '\\operatorname{div}',
  '@': '\\cdot', '.*': '\\odot', './': '\\oslash',
  '==': '=', '===': '=', '!=': '\\neq', '!==': '\\neq', '<': '<', '>': '>',
  '<=': '\\leq', '>=': '\\geq', 'in': '\\in', 'is': '\\ \\mathrm{is}\\ ',
  '&&': '\\wedge', 'and': '\\wedge', '||': '\\vee', 'or': '\\vee',
  '&': '\\mathbin{\\&}', '|': '\\mathbin{|}', 'xor': '\\oplus',
  '<<': '\\ll', '>>': '\\gg', '>>>': '\\ggg'
};

module.exports = {
  GREEK: GREEK,
  GREEK_TEX: GREEK_TEX,
  CONSTANTS: CONSTANTS,
  FUNCTIONS: FUNCTIONS,
  DISCRETE_NAMESPACES: DISCRETE_NAMESPACES,
  POWERABLE: POWERABLE,
  OPS: OPS,
  OPS_TEX: OPS_TEX
};
