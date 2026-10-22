'use strict';

// Typing maths the way Maple lets you type it: names become symbols as you
// write them, and a line of ordinary input becomes typeset maths on command.
//
// Nothing here parses. Maple's input syntax is rewritten into the form the
// existing parser already reads, and the result is handed to the LaTeX writer
// that already exists or to the one new thing this file does add: a renderer
// that lays an expression out in plain Unicode, for the places where LaTeX
// would only be read as literal backslashes.

const S = require('./symbols');
const { parse, PREC, dottedName } = require('./parser');
const { toLatex } = require('./latex');

// ----------------------------------------------------------------- symbols

// What `\name` stands for. The Greek table is the one the renderer already
// uses, so a letter can never mean one thing while typing and another once
// drawn.
const SYMBOLS = Object.assign(Object.create(null), S.GREEK, {
  // relations
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  approx: '≈', sim: '∼', equiv: '≡', propto: '∝',
  ll: '≪', gg: '≫', cong: '≅',

  // arrows
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←',
  Rightarrow: '⇒', Leftarrow: '⇐', iff: '⇔', Leftrightarrow: '⇔',
  mapsto: '↦', uparrow: '↑', downarrow: '↓',

  // arithmetic and operators
  pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷', ast: '∗',
  star: '⋆', circ: '∘', bullet: '∙', oplus: '⊕', otimes: '⊗',
  sqrt: '√', cbrt: '∛', sum: '∑', prod: '∏', coprod: '∐',
  int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  nabla: '∇', partial: '∂', Delta: 'Δ', laplacian: '∆',
  degree: '°', deg: '°', prime: '′', angle: '∠', perp: '⊥',
  parallel: '∥', dagger: '†', hbar: 'ℏ', ell: 'ℓ',

  // sets and logic
  infty: '∞', infinity: '∞', emptyset: '∅', varnothing: '∅',
  'in': '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆',
  supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
  forall: '∀', exists: '∃', nexists: '∄', land: '∧', lor: '∨',
  lnot: '¬', neg: '¬', therefore: '∴', because: '∵',
  // the number sets, which are what a domain is usually written with
  R: 'ℝ', reals: 'ℝ', C: 'ℂ', complexes: 'ℂ', N: 'ℕ', naturals: 'ℕ',
  Z: 'ℤ', integers: 'ℤ', Q: 'ℚ', rationals: 'ℚ',

  // dots and spacing
  ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',

  // a few whole words that are easier to type than to find
  checkmark: '✓', cross: '✗', micro: 'µ', angstrom: 'Å', permil: '‰'
});

// Longest first, so `\leq` is never read as `\le` with a q after it.
const SYMBOL_NAMES = Object.keys(SYMBOLS).sort(function (a, b) {
  return b.length - a.length || a.localeCompare(b);
});

// --------------------------------------------------------- typing symbols

// `\alpha` becomes α once the name is complete and what follows cannot be part
// of it. The backslash is what keeps this safe to leave switched on: no word
// anyone writes in prose or in code begins with one, so nothing is ever
// rewritten by surprise.
const PENDING = /\\([A-Za-z]+)$/;

// Given the text of a line and where the cursor is, what -- if anything -- to
// replace. Returns null when the cursor is not sitting just after a complete
// name, which is the common case and must stay cheap.
function expandAt(line, column) {
  const before = String(line).slice(0, column);
  if (before.charCodeAt(before.length - 1) === 92) return null;  // bare backslash
  const m = PENDING.exec(before);
  if (!m) return null;
  const name = m[1];
  if (!Object.prototype.hasOwnProperty.call(SYMBOLS, name)) return null;
  return {
    start: column - name.length - 1,
    end: column,
    text: SYMBOLS[name]
  };
}

// Every name that could still grow into something, for completion while typing.
function completionsFor(prefix) {
  const want = String(prefix || '');
  const out = [];
  for (let i = 0; i < SYMBOL_NAMES.length; i++) {
    const name = SYMBOL_NAMES[i];
    if (name.indexOf(want) === 0) out.push({ name: name, symbol: SYMBOLS[name] });
  }
  return out.sort(function (a, b) { return a.name.length - b.name.length; });
}

// ------------------------------------------------------- the Maple dialect

// Maple writes a range as `x = a .. b` and spells a few things its own way.
// Rewriting those into the shapes the parser already understands is far less
// work than teaching it a second syntax, and keeps one grammar to maintain.
//
// Only the calls that have a layout of their own are rewritten; everything
// else is already ordinary expression syntax and passes through untouched.
const RANGED = { int: 'integrate', Int: 'integrate', sum: 'Sum', Sum: 'Sum',
  add: 'Sum', product: 'Product', Product: 'Product', mul: 'Product' };

// The closing bracket matching the one at `open`, or -1 when there is none.
// Quoted text is skipped, so a bracket inside a string cannot unbalance it.
function matchBracket(text, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (pairs[c]) depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

// Rewrites Maple's call forms into the ones the parser reads.
//
// This walks the text and matches brackets rather than pattern-matching it,
// because a pattern cannot tell where one call ends and the next begins: a
// greedy one swallowed `int(f, x = 0 .. 1) + int(g, x = 0 .. 2)` whole, and a
// lazy one would stop at the first bracket inside the arguments. Arguments are
// rewritten before the call around them, so nesting works at any depth.
function mapleToSource(text) {
  const source = String(text);
  let out = '';
  let i = 0;

  while (i < source.length) {
    const ahead = /^([A-Za-z_]\w*)\s*\(/.exec(source.slice(i));
    // A name directly after another name-character is the tail of a longer
    // name: `myint(...)` is not `int(...)`.
    const joined = i > 0 && /[\w$.]/.test(source[i - 1]);
    if (!ahead || joined) { out += source[i]; i++; continue; }

    const open = i + ahead[0].length - 1;
    const close = matchBracket(source, open);
    if (close < 0) { out += source[i]; i++; continue; }

    const inside = mapleToSource(source.slice(open + 1, close));
    out += rewriteCall(ahead[1], inside);
    i = close + 1;
  }

  // Maple spells these with a capital, and in full.
  return out.replace(/\bPi\b/g, 'pi').replace(/\binfinity\b/g, 'oo');
}

// One call, with its arguments already rewritten.
function rewriteCall(fn, inside) {
  const plain = fn + '(' + inside + ')';
  const args = splitArgs(inside);

  if (Object.prototype.hasOwnProperty.call(RANGED, fn)) {
    if (args.length !== 2) return plain;
    const ranged = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+?)\s*\.\.\s*([\s\S]+)$/.exec(args[1]);
    if (ranged) {
      return RANGED[fn] + '(' + args[0] + ', (' + ranged[1] + ', ' +
        ranged[2] + ', ' + ranged[3] + '))';
    }
    // int(f, x) is an indefinite integral, which the renderer knows as
    // integrate(f, x); a sum without a range has no layout of its own.
    if (fn === 'int' || fn === 'Int') return 'integrate(' + args[0] + ', ' + args[1] + ')';
    return plain;
  }

  if (fn === 'limit' || fn === 'Limit') {
    if (args.length !== 2) return plain;
    const at = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(args[1]);
    return at ? 'limit(' + args[0] + ', ' + at[1] + ', ' + at[2] + ')' : plain;
  }

  return plain;
}

// Splits on the commas that are at the top level, so a nested call keeps its
// own arguments.
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(last, i).trim()); last = i + 1; }
  }
  out.push(text.slice(last).trim());
  return out.filter(function (a) { return a.length > 0; });
}

// ------------------------------------------------------- Unicode rendering

const SUPER = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶',
  '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼',
  '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ',
  'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ',
  'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ', 't': 'ᵗ',
  'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ', '.': '·'
};
const SUB = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆',
  '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌',
  '(': '₍', ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
  'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ',
  's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ', 'v': 'ᵥ', 'x': 'ₓ'
};

// Anything already sitting above the line. Two raised runs written next to
// each other merge into one: √v₀²  cubed must not come out as √v₀²³, which
// reads as an exponent of twenty-three.
const RAISED = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃᵇᶜᵈᵉᶠᵍʰʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻ·]$/;

// A single thing, which a radical sign can sit in front of without a bar to
// say where it ends: a name, a number, or either with a subscript.
const SIMPLE = /^[A-Za-zΑ-Ωα-ωϑ∞π0-9._₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ]+$/;

// Unicode has no superscript q, and no subscript for half the alphabet, so a
// raised form is all-or-nothing: either every character has one or the whole
// thing stays on the line. Half-raised text reads as a typo.
function raise(text, table) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!Object.prototype.hasOwnProperty.call(table, ch)) return null;
    out += table[ch];
  }
  return out;
}

const ATOM = 100;

// Lays an expression out in plain Unicode. One line, no stacking: a fraction
// keeps its slash and gets brackets where it needs them, because a plain-text
// fraction that loses its grouping is worse than one that keeps its slash.
function toUnicode(node, options) {
  const o = options || {};

  function go(n) {
    if (!n || typeof n !== 'object') return { text: '', prec: ATOM };
    switch (n.type) {
      case 'Num':
        return { text: String(n.v).replace(/_/g, ''), prec: ATOM };
      case 'Str':
        return { text: String(n.v), prec: ATOM };
      case 'Ident':
        return { text: name(n.name), prec: ATOM };
      case 'Member': {
        const dotted = dottedName(n);
        if (dotted === null) return { text: go(n.obj).text + '.' + n.name, prec: ATOM };
        const parts = dotted.split('.');
        // np.pi and math.pi are the constant, not a lookup.
        return { text: name(parts[parts.length - 1]), prec: ATOM };
      }
      case 'Unary': {
        const glyph = n.op === '-' ? '−' : n.op === '!' ? '¬' : n.op;
        return { text: glyph + operand(n.arg, 24), prec: 24 };
      }
      case 'Binary':
        return binary(n);
      case 'Assign':
        return { text: go(n.l).text + ' ' + (n.op === '=' || n.op === ':=' ? '=' : n.op) +
          ' ' + go(n.r).text, prec: 1 };
      case 'Index': {
        const inner = n.args.map(function (a) { return go(a).text; }).join(',');
        const low = raise(inner, SUB);
        return low
          ? { text: go(n.obj).text + low, prec: ATOM }
          : { text: go(n.obj).text + '[' + inner + ']', prec: ATOM };
      }
      case 'List': {
        const inner = n.items.map(function (i) { return go(i).text; }).join(', ');
        if (n.kind === ',') return { text: inner, prec: 2 };
        const open = n.kind === '(' ? '(' : n.kind === '[' ? '[' : '{';
        const close = n.kind === '(' ? ')' : n.kind === '[' ? ']' : '}';
        return { text: open + inner + close, prec: ATOM };
      }
      case 'Pair':
        return { text: go(n.key).text + ': ' + go(n.value).text, prec: 1 };
      case 'KeyVal':
        return { text: n.name + '=' + go(n.value).text, prec: 1 };
      case 'Call':
        return call(n);
      case 'Ternary':
        return { text: go(n.then).text + ' if ' + go(n.cond).text +
          (n.other ? ' else ' + go(n.other).text : ''), prec: 1 };
      default:
        return { text: '', prec: ATOM };
    }
  }

  function name(word) {
    if (Object.prototype.hasOwnProperty.call(S.CONSTANTS, word)) return S.CONSTANTS[word];
    if (Object.prototype.hasOwnProperty.call(S.GREEK, word)) return S.GREEK[word];
    // theta_max, v_0: the tail becomes a subscript when every character has one.
    const split = /^([A-Za-z]+)_(\w+)$/.exec(word);
    if (split) {
      const head = Object.prototype.hasOwnProperty.call(S.GREEK, split[1])
        ? S.GREEK[split[1]] : split[1];
      const low = raise(split[2], SUB);
      if (low) return head + low;
    }
    return word;
  }

  function operand(n, minPrec, side, parentOp) {
    const r = go(n);
    const need = r.prec < minPrec ||
      (r.prec === minPrec && side === 'right' && parentOp !== '+' && parentOp !== '*');
    return need ? '(' + r.text + ')' : r.text;
  }

  function binary(n) {
    const op = n.op;
    const prec = PREC[op] || 10;

    if (op === '**' || op === '^') {
      const base = operand(n.l, ATOM);
      // A raised exponent has no room for spaces: x^(n + 1) is xⁿ⁺¹, not
      // xⁿ ⁺ ¹, which no font would set well even if the spaces existed.
      const exp = go(n.r).text;
      const up = raise(exp.replace(/\s+/g, ''), SUPER);
      if (!up) return { text: base + '^(' + exp + ')', prec: ATOM };
      // A base that already ends above the line gets brackets, or the two
      // raised runs would be read as one number. So does one that opens with a
      // radical: without a bar to close it, √x² says (√x)² and √(x²) equally
      // well, and only one of them is meant.
      const guard = RAISED.test(base) || /^[√∛]/.test(base);
      return { text: (guard ? '(' + base + ')' : base) + up, prec: ATOM };
    }

    const glyph = op === '*' ? '·' : op === '-' ? ' − ' : op === '+' ? ' + ' :
      op === '/' ? '/' : op === '//' ? ' div ' : op === '%' ? ' mod ' :
      op === '==' ? ' = ' : op === '!=' ? ' ≠ ' : op === '<=' ? ' ≤ ' :
      op === '>=' ? ' ≥ ' : op === '<' ? ' < ' : op === '>' ? ' > ' :
      op === 'and' ? ' ∧ ' : op === 'or' ? ' ∨ ' : op === 'in' ? ' ∈ ' :
      ' ' + op + ' ';

    const l = operand(n.l, prec, 'left', op);
    const r = operand(n.r, prec, 'right', op);
    return { text: l + glyph + r, prec: prec };
  }

  function call(n) {
    const dotted = dottedName(n.callee);
    const fn = dotted ? dotted.split('.').pop() : null;
    const args = n.args.filter(function (a) { return a && a.type !== 'KeyVal'; });
    const spec = fn ? S.FUNCTIONS[fn] : null;
    const text = function (i) { return args[i] ? go(args[i]).text : ''; };

    // A layout only applies when the arguments it needs are actually there.
    // `limit(f, x = 0) + limit(g, x = 1)` arrives with the range as a keyword
    // argument rather than a positional one, and drawing it as `lim(→) f`
    // would quietly throw away the variable and the point -- a formula
    // replaced by a different, wrong formula. Falling back to the plain call
    // keeps every part of it.
    if (spec) {
      switch (spec.kind) {
        case 'sqrt': {
          if (!args[0]) break;
          // On paper the bar says where the root ends. Without one, only a
          // single name or number can follow the sign unbracketed: √v₀² would
          // otherwise be read as (√v₀)² just as readily as √(v₀²).
          const inner = go(args[0]).text;
          const sign = spec.index === '3' ? '∛' : '√';
          return { text: sign + (SIMPLE.test(inner) ? inner : '(' + inner + ')'), prec: ATOM };
        }
        case 'fence':
          if (!args[0]) break;
          return { text: spec.open + text(0) + spec.close, prec: ATOM };
        case 'exp': {
          if (!args[0]) break;
          const up = raise(text(0).replace(/\s+/g, ''), SUPER);
          return up ? { text: 'e' + up, prec: ATOM }
            : { text: 'e^(' + text(0) + ')', prec: ATOM };
        }
        case 'integral':
          if (!args[0]) break;
          return { text: integral(args), prec: 2 };
        case 'bigsum':
          if (!args[0] || !limits(args[1])) break;
          return { text: bigop(spec.glyph, args), prec: 2 };
        case 'derivative':
          if (!args[0] || !args[1]) break;
          return { text: derivative(args), prec: 2 };
        case 'limit':
          if (args.length < 3) break;
          return { text: 'lim(' + text(1) + '→' + text(2) + ') ' + text(0), prec: 2 };
        default:
          break;
      }
    }

    const inner = n.args.map(function (a) { return go(a).text; }).join(', ');
    return { text: (fn ? name(fn) : go(n.callee).text) + '(' + inner + ')', prec: ATOM };
  }

  // A range arrives as the tuple the dialect rewrote it into.
  function limits(node) {
    if (!node || node.type !== 'List' || node.items.length < 3) return null;
    return {
      variable: go(node.items[0]).text,
      from: go(node.items[1]).text,
      to: go(node.items[2]).text
    };
  }

  function integral(args) {
    const range = limits(args[1]);
    if (range) {
      // ∞ and anything else without a raised form keep the limits on the line,
      // where they are still read as limits rather than as a stray bracket.
      const lo = raise(range.from, SUB);
      const hi = raise(range.to, SUPER);
      const marks = lo && hi ? lo + hi : '(' + range.from + '→' + range.to + ')';
      return '∫' + marks + ' ' + go(args[0]).text + ' d' + range.variable;
    }
    return '∫ ' + go(args[0]).text + (args[1] ? ' d' + go(args[1]).text : '');
  }

  function bigop(glyph, args) {
    const range = limits(args[1]);
    if (!range) return glyph + ' ' + go(args[0]).text;
    const lo = raise(range.variable + '=' + range.from, SUB);
    const hi = raise(range.to, SUPER);
    const marks = lo && hi ? lo + hi
      : '(' + range.variable + '=' + range.from + '→' + range.to + ')';
    return glyph + marks + ' ' + go(args[0]).text;
  }

  function derivative(args) {
    const f = go(args[0]).text;
    const v = args[1] ? go(args[1]).text : 'x';
    const order = args[2] && args[2].type === 'Num' ? String(args[2].v) : null;
    if (order && order !== '1') {
      const up = raise(order, SUPER) || ('^' + order);
      return 'd' + up + f + '/d' + v + up;
    }
    return 'd' + f + '/d' + v;
  }

  return go(node).text;
}

// ------------------------------------------------------------- the command

// Formats one line of Maple-ish input. `target` is 'latex' where the result
// will be rendered as maths -- a notebook's markdown cell, a .md file -- and
// 'unicode' everywhere else, where backslashes would only ever be read as
// backslashes.
//
// Returns null when the text does not parse, so that the caller can leave it
// alone rather than replacing it with something worse.
function formatAsMath(text, target, options) {
  const o = options || {};
  const source = mapleToSource(text);
  let ast;
  try {
    ast = parse(source, { caretIsPower: true, id: 'maple' });
  } catch (err) {
    return null;
  }

  if (target === 'latex') {
    let tex;
    try {
      tex = toLatex(ast, Object.assign({ prec: PREC }, o));
    } catch (err) {
      return null;
    }
    if (!tex) return null;
    const fence = o.display ? '$$' : '$';
    return fence + (o.display ? '\n' + tex + '\n' : tex) + fence;
  }

  const out = toUnicode(ast, o);
  return out || null;
}

module.exports = {
  SYMBOLS: SYMBOLS,
  expandAt: expandAt,
  completionsFor: completionsFor,
  mapleToSource: mapleToSource,
  toUnicode: toUnicode,
  formatAsMath: formatAsMath,
  splitArgs: splitArgs
};
