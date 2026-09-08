'use strict';

const S = require('./symbols');
const { PREC, dottedName } = require('./parser');

const ATOM = 100;
const POWER = 26;
const MUL = 22;
const UNARY = 24;
const ASSOCIATIVE = new Set(['+', '*', '&&', '||', 'and', 'or', '&', '|', 'xor']);

// Mirrors render.js: draw the grouping wherever the precedence is easy to misread.
const MURKY = new Set(['&&', '||', 'and', 'or', '&', '|', 'xor', '<<', '>>', '>>>']);
const SHIFTS = new Set(['<<', '>>', '>>>']);
const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '//', '**']);
const BITWISE = new Set(['&', '|', 'xor', '<<', '>>', '>>>']);
const COMPARE = new Set(['==', '!=', '===', '!==', '<', '>', '<=', '>=']);

function murkyMix(parentOp, child, chains) {
  if (!child || child.type !== 'Binary') return false;
  const c = child.op;
  if (BITWISE.has(parentOp) && COMPARE.has(c)) return true;
  if (COMPARE.has(parentOp) && BITWISE.has(c)) return true;
  if (COMPARE.has(parentOp) && COMPARE.has(c)) return !chains;
  if (!MURKY.has(parentOp)) return false;
  if (MURKY.has(c) && c !== parentOp) return true;
  return SHIFTS.has(parentOp) && ARITHMETIC.has(c);
}

function isHalf(n) {
  if (n.type === 'Num') return n.v === '0.5' || n.v === '.5';
  return n.type === 'Binary' && n.op === '/' && n.l.type === 'Num' && n.r.type === 'Num' &&
    n.l.v === '1' && n.r.v === '2';
}

function isThird(n) {
  return n.type === 'Binary' && n.op === '/' && n.l.type === 'Num' && n.r.type === 'Num' &&
    n.l.v === '1' && n.r.v === '3';
}

// Names LaTeX already defines as operators.
const BUILTIN_OPS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'coth',
  'arcsin', 'arccos', 'arctan', 'log', 'ln', 'lg', 'exp', 'det', 'dim', 'ker',
  'deg', 'gcd', 'max', 'min', 'sup', 'inf', 'lim', 'arg', 'Pr'
]);

function opName(name) {
  return BUILTIN_OPS.has(name)
    ? '\\' + name
    : '\\operatorname{' + name.replace(/_/g, '\\_') + '}';
}

function toLatex(node, opts) {
  const o = opts || {};
  const strip = new Set(o.stripNamespaces || []);
  const greek = o.greek !== false;

  function resolveName(n) {
    const dotted = dottedName(n);
    if (dotted === null) return null;
    const parts = dotted.split('.');
    if (parts.length > 1 && strip.has(parts[0])) return parts[parts.length - 1];
    return dotted;
  }

  function word(w) {
    if (Object.prototype.hasOwnProperty.call(S.CONSTANTS, w)) {
      const ch = S.CONSTANTS[w];
      return S.GREEK_TEX[ch] ? '\\' + S.GREEK_TEX[ch] : ch;
    }
    if (greek && Object.prototype.hasOwnProperty.call(S.GREEK, w)) {
      const ch = S.GREEK[w];
      return S.GREEK_TEX[ch] ? '\\' + S.GREEK_TEX[ch] : ch;
    }
    if (w.length === 1) return w;
    return '\\mathrm{' + w.replace(/([#$%&_{}])/g, '\\$1') + '}';
  }

  function ident(name) {
    let parts = name.split('_').filter(function (p) { return p.length; });
    if (!parts.length) parts = [name];
    let base = parts[0];
    let subs = parts.slice(1);
    if (!subs.length) {
      const m = /^([A-Za-z]{1,2})(\d+)$/.exec(base);
      if (m && !S.FUNCTIONS[base]) { base = m[1]; subs = [m[2]]; }
    }
    let out = word(base);
    if (subs.length) out += '_{' + subs.map(word).join(',') + '}';
    return out;
  }

  function operand(n, minPrec, side, parentOp) {
    const r = go(n);
    const need = r.prec < minPrec ||
      (r.prec === minPrec && side === 'right' && !ASSOCIATIVE.has(parentOp)) ||
      murkyMix(parentOp, n, o.chainsComparisons !== false);
    return need ? '\\left(' + r.tex + '\\right)' : r.tex;
  }

  function res(tex, prec, tall) {
    return { tex: tex, prec: prec === undefined ? ATOM : prec, tall: !!tall };
  }

  // ---- calculus, mirroring render.js ---------------------------------------

  function diffSpecs(items) {
    const out = [];
    items.forEach(function (x) {
      if (x.type === 'List' && x.kind === '(' && x.items.length === 2) {
        out.push({ v: x.items[0], order: x.items[1] });
      } else if (x.type === 'Num' && out.length && !out[out.length - 1].order) {
        out[out.length - 1].order = x;
      } else {
        out.push({ v: x, order: null });
      }
    });
    return out;
  }

  function intSpecs(items) {
    return items.map(function (x) {
      if (x.type === 'List' && x.kind === '(' && x.items.length === 3) {
        return { v: x.items[0], from: x.items[1], to: x.items[2] };
      }
      if (x.type === 'List' && x.kind === '(' && x.items.length === 1) {
        return { v: x.items[0], from: null, to: null };
      }
      return { v: x, from: null, to: null };
    });
  }

  function derivativeTex(positional, owner) {
    const expr = owner || positional[0];
    const rest = owner ? positional : positional.slice(1);
    if (!expr) return null;
    const specs = diffSpecs(rest);
    if (!specs.length) return null;

    const d = specs.length > 1 ? '\\partial' : '\\mathrm{d}';
    let total = 0;
    let symbolic = false;
    specs.forEach(function (s) {
      if (!s.order) { total += 1; return; }
      if (s.order.type === 'Num' && /^\d+$/.test(s.order.v)) total += Number(s.order.v);
      else symbolic = true;
    });
    const orderTex = symbolic ? '^{' + go(specs[0].order).tex + '}' : (total > 1 ? '^{' + total + '}' : '');
    const den = specs.map(function (s) {
      return d + ' ' + go(s.v).tex + (s.order ? '^{' + go(s.order).tex + '}' : '');
    }).join('\\,');

    const inline = expr.type === 'Ident' || expr.type === 'Member' || expr.type === 'Call';
    if (inline && !expr.grouped) {
      return res('\\frac{' + d + orderTex + ' ' + go(expr).tex + '}{' + den + '}');
    }
    return res('\\frac{' + d + orderTex + '}{' + den + '}\\left(' + go(expr).tex + '\\right)', MUL);
  }

  function integralTex(spec, positional, owner) {
    const expr = owner || positional[0];
    const rest = owner ? positional : positional.slice(1);
    if (!expr) return null;

    let signs;
    let differentials = '';
    if (spec.fixedLimits) {
      if (rest.length < 2) return null;
      signs = ['\\int_{' + go(rest[0]).tex + '}^{' + go(rest[1]).tex + '}'];
    } else {
      const vars = intSpecs(rest);
      if (!vars.length || vars.some(function (v) { return !v.v; })) return null;
      signs = vars.map(function (v) {
        return v.from ? '\\int_{' + go(v.from).tex + '}^{' + go(v.to).tex + '}' : '\\int';
      });
      differentials = vars.map(function (v) { return '\\,\\mathrm{d}' + go(v.v).tex; }).join('');
    }
    return res(signs.join('') + ' ' + operand(expr, MUL, 'right', '*') + differentials, 20);
  }

  function bigSumTex(spec, positional) {
    const expr = positional[0];
    if (!expr) return null;
    const vars = intSpecs(positional.slice(1)).filter(function (v) { return v.v; });
    const glyph = spec.glyph === '∑' ? '\\sum' : '\\prod';
    const heads = vars.map(function (v) {
      if (!v.from) return glyph + '_{' + go(v.v).tex + '}';
      return glyph + '_{' + go(v.v).tex + ' = ' + go(v.from).tex + '}^{' + go(v.to).tex + '}';
    }).join('');
    return res((heads || glyph) + ' ' + operand(expr, MUL, 'right', '*'), MUL);
  }

  function limitTex(positional) {
    if (positional.length < 3) return null;
    let to = go(positional[2]).tex;
    if (positional[3] && positional[3].type === 'Str') {
      const side = positional[3].v.replace(/['"`]/g, '');
      if (side === '+' || side === '-') to += '^{' + side + '}';
    }
    return res('\\lim_{' + go(positional[1]).tex + ' \\to ' + to + '} ' +
      operand(positional[0], MUL, 'right', '*'), MUL);
  }

  function callTex(n) {
    const dotted = dottedName(n.callee);
    const name = resolveName(n.callee);
    const last = name ? name.split('.').pop() : null;
    const spec = last ? S.FUNCTIONS[last] : null;
    const a = n.args;
    const argTex = function (i) { return go(a[i]).tex; };
    const positional = a.filter(function (x) { return x.type !== 'KeyVal'; });
    const kwargs = a.filter(function (x) { return x.type === 'KeyVal'; });
    const qualifier = dotted && dotted.indexOf('.') > 0 ? dotted.split('.')[0] : null;
    const owner = (n.callee.type === 'Member' && name !== null && name.indexOf('.') >= 0)
      ? n.callee.obj : null;

    if (spec) {
      let built = null;
      switch (spec.kind) {
        case 'derivative':
          if (qualifier && S.DISCRETE_NAMESPACES.has(qualifier)) {
            if (!positional.length) break;
            let order = positional[1] || null;
            kwargs.forEach(function (k) { if (k.name === 'n') order = k.value; });
            const power = order && !(order.type === 'Num' && order.v === '1')
              ? '^{' + go(order).tex + '}' : '';
            built = res('\\Delta' + power + ' ' + operand(positional[0], UNARY, 'right', 'u-'), UNARY);
          } else {
            built = derivativeTex(positional, owner);
          }
          break;
        case 'integral': built = integralTex(spec, positional, owner); break;
        case 'bigsum': built = bigSumTex(spec, positional); break;
        case 'limit': built = limitTex(positional); break;
        case 'relation':
          if (positional.length === 2) {
            const glyphTex = { '=': '=', '≠': '\\neq', '<': '<', '≤': '\\leq', '>': '>', '≥': '\\geq' };
            built = res(operand(positional[0], 10, 'left', '==') + ' ' +
              (glyphTex[spec.glyph] || '=') + ' ' +
              operand(positional[1], 10, 'right', '=='), 10);
          }
          break;
        case 'nabla':
          if (positional.length === 1) {
            built = res('\\nabla ' + operand(positional[0], UNARY, 'right', 'u-'), UNARY);
          }
          break;
        case 'fraction':
          if (positional.length === 2) {
            built = res('\\frac{' + go(positional[0]).tex + '}{' + go(positional[1]).tex + '}');
          }
          break;
      }
      if (built) return built;
    }

    if (spec) {
      switch (spec.kind) {
        case 'sqrt':
          if (a.length === 1) {
            return res(spec.index ? '\\sqrt[' + spec.index + ']{' + argTex(0) + '}' : '\\sqrt{' + argTex(0) + '}');
          }
          break;
        case 'fence':
          if (a.length === 1) {
            const map = { '|': '|', '‖': '\\|', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil' };
            return res('\\left' + (map[spec.open] || spec.open) + argTex(0) +
              '\\right' + (map[spec.close] || spec.close));
          }
          break;
        case 'pow':
          if (a.length === 2) return res(operand(a[0], POWER, 'left', '**') + '^{' + argTex(1) + '}', POWER);
          break;
        case 'exp':
          if (a.length === 1) return res('e^{' + argTex(0) + '}', POWER);
          break;
        case 'expm1':
          if (a.length === 1) return res('e^{' + argTex(0) + '} - 1', 20);
          break;
        case 'log1p':
          if (a.length === 1) return res('\\ln\\left(1 + ' + argTex(0) + '\\right)');
          break;
        case 'hypot':
          if (a.length === 2) {
            return res('\\sqrt{' + operand(a[0], POWER, 'left', '**') + '^{2} + ' +
              operand(a[1], POWER, 'left', '**') + '^{2}}');
          }
          break;
        case 'log':
          if (a.length === 2) return res('\\log_{' + argTex(1) + '}\\left(' + argTex(0) + '\\right)');
          return res('\\log\\left(' + a.map(function (_, i) { return argTex(i); }).join(', ') + '\\right)');
        case 'named': {
          const nm = opName(spec.name) + (spec.sub ? '_{' + spec.sub + '}' : '');
          return res(nm + '\\left(' + a.map(function (_, i) { return argTex(i); }).join(', ') + '\\right)');
        }
        case 'mod':
          if (a.length === 2) return res(operand(a[0], MUL, 'left', '%') + ' \\bmod ' + operand(a[1], MUL, 'right', '%'), MUL);
          break;
        case 'infix':
          if (a.length === 2) {
            const g = spec.glyph === '·' ? '\\cdot' : '\\times';
            return res(operand(a[0], MUL, 'left', '*') + ' ' + g + ' ' + operand(a[1], MUL, 'right', '*'), MUL);
          }
          break;
        case 'superscript':
          if (a.length === 1) {
            const sup = spec.sup === '−1' ? '-1' : spec.sup === 'ᵀ' ? '\\mathsf{T}' : spec.sup;
            return res(operand(a[0], ATOM, 'left', '') + '^{' + sup + '}', POWER);
          }
          break;
        case 'factorial':
          if (a.length === 1) return res(operand(a[0], ATOM, 'left', '') + '!');
          break;
        case 'binom':
          if (a.length === 2) return res('\\binom{' + argTex(0) + '}{' + argTex(1) + '}');
          break;
        case 'bigop':
          if (a.length === 1) {
            return res((spec.glyph === '∑' ? '\\sum ' : '\\prod ') + operand(a[0], MUL, 'right', '*'), MUL);
          }
          break;
      }
    }

    const fn = last ? opName(last) : go(n.callee).tex;
    return res(fn + '\\left(' + n.args.map(function (x) { return go(x).tex; }).join(', ') + '\\right)');
  }

  function go(n) {
    switch (n.type) {
      case 'Num': {
        // A trailing letter in 0xFF is part of the number, not a C suffix.
        const based = /^0[xXbBoO]/.test(n.v);
        const t = based ? n.v.replace(/_/g, '')
          : n.v.replace(/_/g, '').replace(/[fFlLuUdD]$/, '');
        if (based) return res('\\mathtt{' + t + '}');
        const m = /^([0-9.]+)[eE]([+-]?\d+)$/.exec(t);
        if (m) return res(m[1] + ' \\times 10^{' + m[2].replace(/^\+/, '') + '}', MUL);
        return res(t);
      }
      case 'Str':
        return res('\\text{' + n.v.replace(/[{}]/g, '') + '}');
      case 'Ident':
        return res(ident(n.name));
      case 'Member': {
        const nm = resolveName(n);
        if (nm !== null && nm.indexOf('.') === -1) return res(ident(nm));
        if (n.name === 'T') return res(go(n.obj).tex + '^{\\mathsf{T}}', POWER);
        if (n.name.length <= 2) return res(go(n.obj).tex + '_{\\mathrm{' + n.name + '}}');
        return res(go(n.obj).tex + '.\\mathrm{' + n.name + '}');
      }
      case 'Index': {
        const inner = n.args.map(function (x) { return go(x).tex; }).join(',');
        // A slice is not a subscript; keep the brackets, as the panel does.
        const sliced = n.args.some(function (x) { return x.type === 'Slice'; });
        if (sliced) return res(go(n.obj).tex + '\\left[' + inner + '\\right]');
        return res(go(n.obj).tex + '_{' + inner + '}');
      }
      case 'Spread':
        return res('{' + n.op.replace(/\*/g, '\\ast ') + '}' + go(n.arg).tex);
      case 'Slice':
        return res(n.parts.map(function (p) { return p ? go(p).tex : ''; }).join(':'));
      case 'Call':
        return callTex(n);
      case 'Transpose':
        return res(operand(n.arg, ATOM, 'left', '') + '^{\\mathsf{T}}', POWER);
      case 'Unary': {
        const g = n.op === '!' ? '\\lnot ' : n.op === '~' ? '\\sim ' : n.op;
        const prec = n.op === '!' ? 8 : UNARY;
        return res(g + operand(n.arg, prec, 'right', 'u' + n.op), prec);
      }
      case 'Binary': {
        if (n.op === '/' || n.op === './') {
          return res('\\frac{' + go(n.l).tex + '}{' + go(n.r).tex + '}');
        }
        if (n.op === '//') {
          return res('\\left\\lfloor \\frac{' + go(n.l).tex + '}{' + go(n.r).tex + '} \\right\\rfloor');
        }
        if (n.op === '**' || n.op === '.^') {
          // Keep the LaTeX in step with the drawing: x**0.5 is a square root there.
          if (o.expandIdentities !== false) {
            if (isHalf(n.r)) return res('\\sqrt{' + go(n.l).tex + '}');
            if (isThird(n.r)) return res('\\sqrt[3]{' + go(n.l).tex + '}');
          }
          // sin(x)**2 becomes \sin^{2}(x), as it would be written by hand.
          if (n.l.type === 'Call' && !n.l.grouped && n.l.args.length === 1) {
            const nm = resolveName(n.l.callee);
            const fname = nm ? nm.split('.').pop() : null;
            if (fname && S.POWERABLE.has(fname)) {
              const spec = S.FUNCTIONS[fname];
              const printed = spec && spec.name ? spec.name : fname;
              return res(opName(printed) + '^{' + go(n.r).tex + '}' +
                (spec && spec.sub ? '_{' + spec.sub + '}' : '') +
                '\\left(' + go(n.l.args[0]).tex + '\\right)');
            }
          }
          const base = go(n.l);
          const needs = base.prec < POWER || n.l.type === 'Binary' && (n.l.op === '/' || n.l.op === '//');
          const b = needs ? '\\left(' + base.tex + '\\right)' : base.tex;
          return res(b + '^{' + go(n.r).tex + '}', POWER);
        }
        const prec = (o.prec || PREC)[n.op];
        const l = operand(n.l, prec, 'left', n.op);
        const r = operand(n.r, prec, 'right', n.op);
        if (n.op === '*' || n.op === '@') return res(l + ' \\cdot ' + r, prec);
        return res(l + ' ' + (S.OPS_TEX[n.op] || n.op) + ' ' + r, prec);
      }
      case 'Ternary': {
        let rows = go(n.then).tex + ' & \\text{if } ' + go(n.cond).tex;
        if (n.other) rows += ' \\\\ ' + go(n.other).tex + ' & \\text{otherwise}';
        return res('\\begin{cases} ' + rows + ' \\end{cases}');
      }
      case 'Assign':
        return res(go(n.l).tex + ' ' + (n.op === '=' || n.op === ':=' ? '=' : '\\mathbin{' + n.op + '}') +
          ' ' + go(n.r).tex, 1);
      case 'KeyVal':
        return res('\\mathrm{' + n.name + '} = ' + go(n.value).tex, 1);
      case 'List': {
        const inner = n.items.map(function (x) { return go(x).tex; }).join(', ');
        const open = n.kind === '(' ? '(' : n.kind === '[' ? '[' : '\\{';
        const close = n.kind === '(' ? ')' : n.kind === '[' ? ']' : '\\}';
        return res('\\left' + open + inner + '\\right' + close);
      }
      default:
        return res('');
    }
  }

  return go(node).tex;
}

module.exports = { toLatex: toLatex };
