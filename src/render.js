'use strict';

const S = require('./symbols');
const { PREC, dottedName } = require('./parser');

const ATOM = 100;
const POWER = 26;
const MUL = 22;
const ADD = 20;
const UNARY = 24;

// Operators where a same-precedence right operand needs no parentheses.
const ASSOCIATIVE = new Set(['+', '*', '&&', '||', 'and', 'or', '&', '|', 'xor', '.*']);

// Precedence nobody remembers correctly. When these mix, the grouping is drawn
// even though the language does not require the parentheses -- that mix is
// exactly where the bugs live (`a and b or c`, `a + b << c`, `a ^ b | c & d`).
const MURKY = new Set(['&&', '||', 'and', 'or', '&', '|', 'xor', '<<', '>>', '>>>']);
const SHIFTS = new Set(['<<', '>>', '>>>']);
const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '//', '**']);

function murkyMix(parentOp, child) {
  if (!MURKY.has(parentOp) || !child || child.type !== 'Binary') return false;
  if (MURKY.has(child.op) && child.op !== parentOp) return true;
  return SHIFTS.has(parentOp) && ARITHMETIC.has(child.op);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function defaults(opts) {
  const o = opts || {};
  return {
    map: o.map || function (i) { return i; },
    multiplication: o.multiplication || 'implicit',
    indexAsSubscript: o.indexAsSubscript !== false,
    greek: o.greek !== false,
    expandIdentities: o.expandIdentities !== false,
    derivativeSymbol: o.derivativeSymbol || 'auto',
    strip: new Set(o.stripNamespaces || [])
  };
}

function makeRenderer(opts) {
  const o = defaults(opts);

  function attrs(node) {
    return ' data-s="' + o.map(node.s) + '" data-e="' + o.map(node.e) + '"';
  }

  function box(cls, inner, node, prec, tall) {
    return {
      html: '<span class="pm-n ' + cls + '"' + attrs(node) + '>' + inner + '</span>',
      prec: prec === undefined ? ATOM : prec,
      tall: !!tall
    };
  }

  function fence(inner, open, close, tall) {
    const cls = tall ? 'pm-fenced pm-fenced-tall' : 'pm-fenced';
    return '<span class="' + cls + '">' +
      '<span class="pm-fence">' + esc(open) + '</span>' +
      '<span class="pm-body">' + inner + '</span>' +
      '<span class="pm-fence">' + esc(close) + '</span></span>';
  }

  function op(glyph, cls) {
    return '<span class="pm-op pm-op-' + (cls || 'bin') + '">' + esc(glyph) + '</span>';
  }

  // Renders `node` as an operand, adding parentheses only where the printed
  // layout would otherwise change the meaning.
  function operand(node, minPrec, side, parentOp) {
    const r = render(node);
    const same = r.prec === minPrec;
    const need = r.prec < minPrec ||
      (same && side === 'right' && !ASSOCIATIVE.has(parentOp)) ||
      murkyMix(parentOp, node);
    if (!need) return r;
    return { html: fence(r.html, '(', ')', r.tall), prec: ATOM, tall: r.tall };
  }

  // ---------------------------------------------------------------- names

  // Drops a leading library qualifier: np.linalg.norm -> norm, self.mass -> mass.
  function resolveName(node) {
    const dotted = dottedName(node);
    if (dotted === null) return null;
    const parts = dotted.split('.');
    if (parts.length > 1 && o.strip.has(parts[0])) return parts[parts.length - 1];
    return dotted;
  }

  function glyphFor(word) {
    if (Object.prototype.hasOwnProperty.call(S.CONSTANTS, word)) {
      return { text: S.CONSTANTS[word], cls: 'pm-const' };
    }
    if (o.greek && Object.prototype.hasOwnProperty.call(S.GREEK, word)) {
      return { text: S.GREEK[word], cls: 'pm-greek' };
    }
    if (word.length === 1) return { text: word, cls: 'pm-var' };
    return { text: word, cls: 'pm-name' };
  }

  // theta_max -> θ with a "max" subscript; x1 -> x with a "1" subscript.
  function identHtml(name) {
    let parts = name.split('_').filter(function (p) { return p.length > 0; });
    if (parts.length === 0) parts = [name];
    let base = parts[0];
    let subs = parts.slice(1);

    if (subs.length === 0) {
      const m = /^([A-Za-z]{1,2})(\d+)$/.exec(base);
      if (m && !S.FUNCTIONS[base]) { base = m[1]; subs = [m[2]]; }
    }

    const g = glyphFor(base);
    let html = '<span class="' + g.cls + '">' + esc(g.text) + '</span>';
    if (subs.length) {
      const sub = subs.map(function (s) {
        const sg = glyphFor(s);
        return '<span class="' + sg.cls + '">' + esc(sg.text) + '</span>';
      }).join('<span class="pm-punct">,</span>');
      html += '<span class="pm-sub">' + sub + '</span>';
    }
    return html;
  }

  // ---------------------------------------------------------------- pieces

  function frac(numHtml, denHtml, node) {
    return box('pm-frac',
      '<span class="pm-frac-num">' + numHtml + '</span>' +
      '<span class="pm-frac-den">' + denHtml + '</span>',
      node, ATOM, true);
  }

  function sqrt(inner, node, index) {
    const idx = index ? '<span class="pm-root-index">' + esc(index) + '</span>' : '';
    return box('pm-sqrt',
      idx + '<span class="pm-radical">√</span>' +
      '<span class="pm-radicand">' + inner + '</span>',
      node, ATOM, true);
  }

  function power(baseHtml, expHtml, node, tallBase) {
    return box('pm-power',
      '<span class="pm-base">' + baseHtml + '</span>' +
      '<span class="pm-sup">' + expHtml + '</span>',
      node, POWER, tallBase);
  }

  // sin, ln, det ... optionally without parentheses around a simple argument.
  function namedCall(spec, node, args) {
    let name = '<span class="pm-fn">' + esc(spec.name) + '</span>';
    if (spec.sub) name += '<span class="pm-sub">' + esc(spec.sub) + '</span>';
    if (spec.supHtml) name += '<span class="pm-sup">' + spec.supHtml + '</span>';

    const simple = args.length === 1 && spec.bare && isSimple(args[0]);
    if (simple) {
      const inner = render(args[0]);
      return box('pm-call', name + '<span class="pm-thin"></span>' + inner.html, node, ATOM, inner.tall);
    }
    const inner = args.map(function (a) { return render(a).html; })
      .join('<span class="pm-punct">,</span><span class="pm-gap"></span>');
    const tall = args.some(function (a) { return render(a).tall; });
    return box('pm-call', name + fence(inner, '(', ')', tall), node, ATOM, tall);
  }

  function isSimple(node) {
    if (!node) return false;
    if (node.grouped) return false;
    return node.type === 'Ident' || node.type === 'Num' ||
      (node.type === 'Member' && dottedName(node) !== null) ||
      (node.type === 'Index' && o.indexAsSubscript);
  }

  function isHalf(node) {
    if (node.type === 'Num') return node.v === '0.5' || node.v === '.5';
    if (node.type === 'Binary' && node.op === '/' && node.l.type === 'Num' && node.r.type === 'Num') {
      return node.l.v === '1' && node.r.v === '2';
    }
    return false;
  }

  function isThird(node) {
    return node.type === 'Binary' && node.op === '/' &&
      node.l.type === 'Num' && node.r.type === 'Num' &&
      node.l.v === '1' && node.r.v === '3';
  }

  // ------------------------------------------------------------- calculus

  function upright(text) {
    return '<span class="pm-dd">' + esc(text) + '</span>';
  }
  function sup(html) { return '<span class="pm-sup">' + html + '</span>'; }

  // SymPy accepts diff(f, x), diff(f, x, 2) and diff(f, (x, 2)) alike.
  function diffSpecs(items) {
    const out = [];
    items.forEach(function (a) {
      if (a.type === 'List' && a.kind === '(' && a.items.length === 2) {
        out.push({ v: a.items[0], order: a.items[1] });
      } else if (a.type === 'Num' && out.length && !out[out.length - 1].order) {
        out[out.length - 1].order = a;
      } else {
        out.push({ v: a, order: null });
      }
    });
    return out;
  }

  // integrate(f, x) or integrate(f, (x, a, b)), repeated for multiple integrals.
  function intSpecs(items) {
    return items.map(function (a) {
      if (a.type === 'List' && a.kind === '(' && a.items.length === 3) {
        return { v: a.items[0], from: a.items[1], to: a.items[2] };
      }
      if (a.type === 'List' && a.kind === '(' && a.items.length === 1) {
        return { v: a.items[0], from: null, to: null };
      }
      return { v: a, from: null, to: null };
    });
  }

  function totalOrder(specs) {
    if (specs.length === 1 && specs[0].order) return render(specs[0].order).html;
    let n = 0;
    for (let i = 0; i < specs.length; i++) {
      const ord = specs[i].order;
      if (!ord) { n += 1; continue; }
      if (ord.type !== 'Num' || !/^\d+$/.test(ord.v)) return null;
      n += Number(ord.v);
    }
    return n > 1 ? '<span class="pm-num-lit">' + n + '</span>' : null;
  }

  function derivativeGlyph(specs) {
    if (o.derivativeSymbol === 'd') return 'd';
    if (o.derivativeSymbol === 'partial') return '∂';
    return specs.length > 1 ? '∂' : 'd';   // several variables means partials
  }

  function renderDerivative(node, positional, kwargs, owner) {
    const expr = owner || positional[0];
    const rest = owner ? positional : positional.slice(1);
    if (!expr) return null;
    const specs = diffSpecs(rest);
    // A bare number where a variable belongs means this is something else --
    // pandas' df.diff(1), say -- so leave it as a plain call.
    if (!specs.length || specs.some(function (s) { return s.v.type === 'Num'; })) return null;

    const glyph = derivativeGlyph(specs);
    const order = totalOrder(specs);
    const den = specs.map(function (s) {
      return upright(glyph) + render(s.v).html + (s.order ? sup(render(s.order).html) : '');
    }).join('<span class="pm-thin"></span>');

    const target = render(expr);
    // df/dx when the target is a plain name or call, d/dx(...) when it is not.
    const inline = !target.tall && (isSimple(expr) || expr.type === 'Call') && !expr.grouped;
    if (inline) {
      return frac(upright(glyph) + (order ? sup(order) : '') +
        '<span class="pm-thin"></span>' + target.html, den, node);
    }
    const bar = frac(upright(glyph) + (order ? sup(order) : ''), den, node);
    // d/dx (x² sin x): the operator's reach has to be unmistakable.
    const body = operand(expr, ATOM, 'right', '');
    return box('pm-expr', bar.html + '<span class="pm-thin"></span>' + body.html, node, MUL, true);
  }

  // numpy.diff is a discrete difference; drawing it as d/dx would be a lie.
  function renderDelta(node, positional, kwargs) {
    if (!positional.length) return null;
    let order = positional[1] || null;
    kwargs.forEach(function (k) { if (k.name === 'n') order = k.value; });
    const arg = operand(positional[0], UNARY, 'right', 'u-');
    const n = order && !(order.type === 'Num' && order.v === '1') ? sup(render(order).html) : '';
    return box('pm-expr',
      '<span class="pm-op pm-prefix">Δ</span>' + n + arg.html, node, UNARY, arg.tall);
  }

  function limitColumn(from, to) {
    if (!from && !to) return '';
    return '<span class="pm-limits">' +
      '<span class="pm-lim-up">' + (to ? render(to).html : '') + '</span>' +
      '<span class="pm-lim-lo">' + (from ? render(from).html : '') + '</span></span>';
  }

  function renderIntegral(node, spec, positional, owner) {
    const expr = owner || positional[0];
    const rest = owner ? positional : positional.slice(1);
    if (!expr) return null;

    let signs;
    let differentials;
    if (spec.fixedLimits) {
      // scipy's quad(f, a, b): the limits are plain arguments and there is no dx.
      if (rest.length < 2) return null;
      signs = [limitColumn(rest[0], rest[1])];
      differentials = '';
    } else {
      const vars = intSpecs(rest);
      if (!vars.length || vars.some(function (v) { return !v.v || v.v.type === 'Num'; })) return null;
      signs = vars.map(function (v) { return limitColumn(v.from, v.to); });
      differentials = vars.map(function (v) {
        return '<span class="pm-gap"></span>' + upright('d') + render(v.v).html;
      }).join('');
    }

    const glyphs = signs.map(function (limits) {
      return '<span class="pm-int">' +
        '<span class="pm-int-glyph">∫</span>' + limits + '</span>';
    }).join('');

    // A sum under the sign is bracketed, so it is clear the dx closes it.
    const body = operand(expr, MUL, 'right', '*');
    return box('pm-integral',
      glyphs + '<span class="pm-int-body">' + body.html + differentials + '</span>',
      node, ADD, true);
  }

  function renderBigSum(node, spec, positional) {
    const expr = positional[0];
    if (!expr) return null;
    const vars = intSpecs(positional.slice(1)).filter(function (v) { return v.v; });

    const stacks = vars.map(function (v) {
      const under = v.from
        ? render(v.v).html + '<span class="pm-op pm-op-rel">=</span>' + render(v.from).html
        : render(v.v).html;
      return '<span class="pm-bigstack">' +
        '<span class="pm-lim-over">' + (v.to ? render(v.to).html : '') + '</span>' +
        '<span class="pm-bigop-glyph">' + esc(spec.glyph) + '</span>' +
        '<span class="pm-lim-under">' + under + '</span></span>';
    }).join('');

    const body = operand(expr, MUL, 'right', '*');
    if (!stacks) {
      return box('pm-bigop',
        '<span class="pm-bigop-glyph">' + esc(spec.glyph) + '</span>' +
        '<span class="pm-thin"></span>' + body.html, node, MUL, body.tall);
    }
    return box('pm-expr', stacks + '<span class="pm-thin"></span>' + body.html, node, MUL, true);
  }

  function renderLimit(node, positional) {
    if (positional.length < 3) return null;
    const expr = positional[0];
    let approach = render(positional[1]).html + '<span class="pm-op">→</span>' +
      render(positional[2]).html;
    if (positional[3] && positional[3].type === 'Str') {
      const side = positional[3].v.replace(/['"`]/g, '');
      if (side === '+' || side === '-') approach += sup(esc(side === '-' ? '−' : '+'));
    }
    const body = operand(expr, MUL, 'right', '*');
    return box('pm-expr',
      '<span class="pm-limop"><span class="pm-fn">lim</span>' +
      '<span class="pm-lim-under">' + approach + '</span></span>' +
      '<span class="pm-thin"></span>' + body.html, node, MUL, true);
  }

  function renderRelation(node, spec, positional) {
    if (positional.length !== 2) return null;
    const l = operand(positional[0], 10, 'left', '==');
    const r = operand(positional[1], 10, 'right', '==');
    return box('pm-expr', l.html + op(spec.glyph, 'rel') + r.html, node, 10, l.tall || r.tall);
  }

  // ---------------------------------------------------------------- calls

  function renderCall(node) {
    const dotted = dottedName(node.callee);
    const name = resolveName(node.callee);
    const last = name ? name.split('.').pop() : null;
    const spec = last ? S.FUNCTIONS[last] : null;
    const args = node.args;
    const positional = args.filter(function (a) { return a.type !== 'KeyVal'; });
    const kwargs = args.filter(function (a) { return a.type === 'KeyVal'; });
    const qualifier = dotted && dotted.indexOf('.') > 0 ? dotted.split('.')[0] : null;
    // expr.diff(x) / y.integrate(x): the receiver is the expression itself.
    const owner = (node.callee.type === 'Member' && name !== null && name.indexOf('.') >= 0)
      ? node.callee.obj : null;

    if (spec) {
      let built = null;
      switch (spec.kind) {
        case 'derivative':
          built = (qualifier && S.DISCRETE_NAMESPACES.has(qualifier))
            ? renderDelta(node, positional, kwargs)
            : renderDerivative(node, positional, kwargs, owner);
          break;
        case 'integral':
          built = renderIntegral(node, spec, positional, owner);
          break;
        case 'bigsum':
          built = renderBigSum(node, spec, positional);
          break;
        case 'limit':
          built = renderLimit(node, positional);
          break;
        case 'relation':
          built = renderRelation(node, spec, positional);
          break;
        case 'nabla':
          if (positional.length === 1) {
            const g = operand(positional[0], UNARY, 'right', 'u-');
            built = box('pm-expr',
              '<span class="pm-op pm-prefix">∇</span>' + g.html, node, UNARY, g.tall);
          }
          break;
        case 'fraction':
          if (positional.length === 2) {
            built = frac(render(positional[0]).html, render(positional[1]).html, node);
          }
          break;
      }
      if (built) return built;
    }

    if (spec && positional.length === args.length) {
      switch (spec.kind) {
        case 'sqrt':
          if (args.length === 1) return sqrt(render(args[0]).html, node, spec.index);
          break;
        case 'fence':
          if (args.length === 1) {
            const r = render(args[0]);
            return box('pm-fencecall', fence(r.html, spec.open, spec.close, r.tall), node, ATOM, r.tall);
          }
          break;
        case 'pow':
          if (args.length === 2) return renderPower(args[0], args[1], node);
          break;
        case 'exp':
          if (args.length === 1 && o.expandIdentities) {
            return power('<span class="pm-const">e</span>', render(args[0]).html, node, false);
          }
          break;
        case 'expm1':
          if (args.length === 1 && o.expandIdentities) {
            const x = render(args[0]).html;
            return box('pm-expr',
              '<span class="pm-const">e</span><span class="pm-sup">' + x + '</span>' +
              op('−') + '<span class="pm-num-lit">1</span>', node, ADD, false);
          }
          break;
        case 'log1p':
          if (args.length === 1 && o.expandIdentities) {
            const inner = '<span class="pm-num-lit">1</span>' + op('+') + render(args[0]).html;
            return box('pm-call',
              '<span class="pm-fn">ln</span>' + fence(inner, '(', ')', false), node, ATOM, false);
          }
          break;
        case 'hypot':
          if (args.length === 2 && o.expandIdentities) {
            const a = operand(args[0], POWER, 'left', '**');
            const b = operand(args[1], POWER, 'left', '**');
            const inner = a.html + '<span class="pm-sup"><span class="pm-num-lit">2</span></span>' +
              op('+') + b.html + '<span class="pm-sup"><span class="pm-num-lit">2</span></span>';
            return sqrt(inner, node);
          }
          break;
        case 'log':
          // log(x, b) is the base-b logarithm in Python and MATLAB alike.
          if (args.length === 2) {
            const base = '<span class="pm-sub">' + render(args[1]).html + '</span>';
            const name = '<span class="pm-fn">log</span>' + base;
            const arg = render(args[0]);
            const body = isSimple(args[0])
              ? '<span class="pm-thin"></span>' + arg.html
              : fence(arg.html, '(', ')', arg.tall);
            return box('pm-call', name + body, node, ATOM, arg.tall);
          }
          return namedCall({ name: 'log', bare: true }, node, args);
        case 'named':
          return namedCall(spec, node, args);
        case 'mod':
          if (args.length === 2) {
            return box('pm-expr',
              operand(args[0], MUL, 'left', '%').html + op('mod', 'word') +
              operand(args[1], MUL, 'right', '%').html, node, MUL, false);
          }
          break;
        case 'infix':
          if (args.length === 2) {
            return box('pm-expr',
              operand(args[0], MUL, 'left', '*').html + op(spec.glyph) +
              operand(args[1], MUL, 'right', '*').html, node, MUL, false);
          }
          break;
        case 'superscript':
          if (args.length === 1) {
            const r = operand(args[0], ATOM, 'left', '');
            return box('pm-power',
              '<span class="pm-base">' + r.html + '</span>' +
              '<span class="pm-sup">' + esc(spec.sup) + '</span>', node, POWER, r.tall);
          }
          break;
        case 'factorial':
          if (args.length === 1) {
            const r = operand(args[0], ATOM, 'left', '');
            return box('pm-expr', r.html + '<span class="pm-op">!</span>', node, ATOM, r.tall);
          }
          break;
        case 'binom':
          if (args.length === 2) {
            const stack = '<span class="pm-stack">' +
              '<span>' + render(args[0]).html + '</span>' +
              '<span>' + render(args[1]).html + '</span></span>';
            return box('pm-binom', fence(stack, '(', ')', true), node, ATOM, true);
          }
          break;
        case 'bigop':
          if (args.length === 1) {
            const r = render(args[0]);
            return box('pm-bigop',
              '<span class="pm-bigop-glyph">' + esc(spec.glyph) + '</span>' +
              '<span class="pm-thin"></span>' + r.html, node, MUL, r.tall);
          }
          break;
      }
    }

    // Anything else: upright name (or a rendered callee) with its arguments.
    const calleeHtml = name !== null
      ? '<span class="pm-fn">' + esc(name.split('.').pop()) + '</span>'
      : render(node.callee).html;
    const parts = args.map(function (a) { return render(a); });
    const tall = parts.some(function (p) { return p.tall; });
    const inner = parts.map(function (p) { return p.html; })
      .join('<span class="pm-punct">,</span><span class="pm-gap"></span>');
    return box('pm-call', calleeHtml + fence(inner, '(', ')', tall), node, ATOM, tall);
  }

  // ---------------------------------------------------------------- powers

  function renderPower(baseNode, expNode, node) {
    if (o.expandIdentities && isHalf(expNode)) return sqrt(render(baseNode).html, node);
    if (o.expandIdentities && isThird(expNode)) return sqrt(render(baseNode).html, node, '3');

    // sin(x)**2 is drawn the way it is written on paper: sin^2 x
    if (baseNode.type === 'Call' && !baseNode.grouped) {
      const nm = resolveName(baseNode.callee);
      const last = nm ? nm.split('.').pop() : null;
      if (last && S.POWERABLE.has(last) && baseNode.args.length === 1) {
        const spec = S.FUNCTIONS[last] || { name: last, bare: true };
        const withSup = Object.assign({}, spec, { supHtml: render(expNode).html });
        const r = namedCall(withSup, node, baseNode.args);
        return { html: r.html, prec: ATOM, tall: r.tall };
      }
    }

    const base = render(baseNode);
    // A stacked base (fraction, root, cases) has to be fenced or the exponent
    // would look like it belongs to the bottom row only.
    const needParens = base.prec < POWER || base.tall || baseNode.type === 'Unary';
    const baseHtml = needParens ? fence(base.html, '(', ')', base.tall) : base.html;
    return power(baseHtml, render(expNode).html, node, base.tall && !needParens);
  }

  // ---------------------------------------------------------------- binary

  // The glyph that ends the left factor and the one that starts the right factor
  // decide this: `2x` and `m v²` read fine, `mass speed` and `a2` do not.
  function edgeLeaf(node, side) {
    let n = node;
    for (let guard = 0; guard < 40 && n; guard++) {
      if (n.grouped) return null;                     // a parenthesis separates
      switch (n.type) {
        case 'Binary':
          if (n.op === '/' || n.op === '//') return null;  // a fraction separates
          n = side === 'right' ? n.r : n.l;
          break;
        case 'Unary':
          if (side === 'left') return n;
          n = n.arg;
          break;
        case 'Member': {
          // self.mass prints as plain "mass", so it counts as that name here.
          const flat = resolveName(n);
          if (flat !== null && flat.indexOf('.') === -1) return { type: 'Ident', name: flat };
          if (side === 'right') return null;
          n = n.obj;
          break;
        }
        case 'Index':
          if (side === 'right') return null;          // ends in a subscript
          n = n.obj;
          break;
        case 'Call':
          return side === 'right' ? null : n;         // ends in a parenthesis
        default:
          return n;
      }
    }
    return null;
  }

  function multiLetter(n) {
    return n && n.type === 'Ident' &&
      n.name.split('_')[0].length > 1 &&
      !S.GREEK[n.name.split('_')[0]] &&
      !S.CONSTANTS[n.name.split('_')[0]];
  }

  function isFraction(n) {
    return n && n.type === 'Binary' && (n.op === '/' || n.op === '//') && !n.grouped;
  }

  function needsDot(lNode, rNode) {
    if (o.multiplication === 'dot' || o.multiplication === 'cross') return true;
    // A factor next to a fraction is the one place a reader most needs to see
    // where the division stops, so it always gets an explicit dot.
    if (isFraction(lNode) || isFraction(rNode)) return true;
    const left = edgeLeaf(lNode, 'right');
    const right = edgeLeaf(rNode, 'left');
    if (right && (right.type === 'Num' || right.type === 'Unary')) return true;
    if (multiLetter(left) && multiLetter(right)) return true;
    // t*t would otherwise print as "t t" and read like one doubled symbol.
    return !!(left && right && left.type === 'Ident' && right.type === 'Ident' &&
      left.name === right.name);
  }

  function renderBinary(node) {
    const opv = node.op;

    if (opv === '/' || opv === './') {
      return frac(render(node.l).html, render(node.r).html, node);
    }
    if (opv === '//') {
      const inner = frac(render(node.l).html, render(node.r).html, node).html;
      return box('pm-fencecall', fence(inner, '⌊', '⌋', true), node, ATOM, true);
    }
    if (opv === '**' || opv === '.^') {
      return renderPower(node.l, node.r, node);
    }

    const prec = PREC[opv];
    const l = operand(node.l, prec, 'left', opv);
    const r = operand(node.r, prec, 'right', opv);

    if (opv === '*' || opv === '@') {
      const glyph = o.multiplication === 'cross' ? '×' : '·';
      const joiner = needsDot(node.l, node.r)
        ? op(glyph)
        : '<span class="pm-thin"></span>';
      return box('pm-expr', l.html + joiner + r.html, node, prec, l.tall || r.tall);
    }

    const info = S.OPS[opv] || { glyph: opv, cls: 'bin' };
    return box('pm-expr', l.html + op(info.glyph, info.cls) + r.html, node, prec, l.tall || r.tall);
  }

  // ---------------------------------------------------------------- main

  function render(node) {
    switch (node.type) {
      case 'Num': {
        let text = node.v.replace(/_/g, '').replace(/[fFlLuUdD]$/, '');
        text = text.replace(/[eE]([+-]?\d+)$/, function (_, exp) {
          return '×10^{' + exp + '}';
        });
        if (text.indexOf('×10^{') >= 0) {
          const bits = text.split('×10^{');
          const mant = bits[0];
          const exp = bits[1].replace('}', '').replace(/^\+/, '').replace(/^-/, '−');
          return box('pm-numlit',
            '<span class="pm-num-lit">' + esc(mant) + '</span>' + op('×') +
            '<span class="pm-num-lit">10</span><span class="pm-sup">' + esc(exp) + '</span>',
            node, ATOM, false);
        }
        return box('pm-numlit', '<span class="pm-num-lit">' + esc(text) + '</span>', node, ATOM, false);
      }

      case 'Str':
        return box('pm-str', '<span class="pm-string">' + esc(node.v) + '</span>', node, ATOM, false);

      case 'Ident':
        return box('pm-ident', identHtml(node.name), node, ATOM, false);

      case 'Member': {
        const name = resolveName(node);
        if (name !== null && name.indexOf('.') === -1) {
          return box('pm-ident', identHtml(name), node, ATOM, false);
        }
        const prop = node.name;
        const obj = render(node.obj);
        if (prop.length <= 2 && /^[A-Za-z]/.test(prop)) {
          if (prop === 'T') {
            return box('pm-power',
              '<span class="pm-base">' + obj.html + '</span><span class="pm-sup">T</span>',
              node, POWER, obj.tall);
          }
          return box('pm-ident',
            obj.html + '<span class="pm-sub"><span class="pm-name">' + esc(prop) + '</span></span>',
            node, ATOM, obj.tall);
        }
        return box('pm-ident',
          obj.html + '<span class="pm-punct">.</span><span class="pm-name">' + esc(prop) + '</span>',
          node, ATOM, obj.tall);
      }

      case 'Index': {
        const obj = render(node.obj);
        const simple = o.indexAsSubscript &&
          node.args.every(function (a) { return a.type !== 'Slice' && a.type !== 'KeyVal'; });
        const inner = node.args.map(function (a) { return render(a).html; })
          .join('<span class="pm-punct">,</span><span class="pm-gap"></span>');
        if (simple) {
          return box('pm-ident', obj.html + '<span class="pm-sub">' + inner + '</span>', node, ATOM, obj.tall);
        }
        return box('pm-ident', obj.html + fence(inner, '[', ']', false), node, ATOM, obj.tall);
      }

      case 'Slice': {
        const parts = node.parts.map(function (p) { return p ? render(p).html : ''; });
        return box('pm-slice', parts.join('<span class="pm-punct">:</span>'), node, ATOM, false);
      }

      case 'Call':
        return renderCall(node);

      case 'Transpose': {
        const r = operand(node.arg, ATOM, 'left', '');
        return box('pm-power',
          '<span class="pm-base">' + r.html + '</span><span class="pm-sup">T</span>',
          node, POWER, r.tall);
      }

      case 'Unary': {
        const info = node.op === '!' ? { glyph: '¬', cls: 'logic' }
          : node.op === '~' ? { glyph: '~', cls: 'bitwise' }
          : node.op === '-' ? { glyph: '−', cls: 'bin' }
          : { glyph: '+', cls: 'bin' };
        const prec = node.op === '!' ? 8 : UNARY;
        const arg = operand(node.arg, prec, 'right', 'u' + node.op);
        return box('pm-expr',
          '<span class="pm-op pm-op-' + info.cls + ' pm-prefix">' + esc(info.glyph) + '</span>' + arg.html,
          node, prec, arg.tall);
      }

      case 'Binary':
        return renderBinary(node);

      case 'Ternary': {
        const then = render(node.then);
        const other = node.other ? render(node.other) : null;
        const cond = render(node.cond);
        let rows =
          '<span class="pm-case-val">' + then.html + '</span>' +
          '<span class="pm-case-cond"><span class="pm-word">if</span> ' + cond.html + '</span>';
        if (other) {
          rows += '<span class="pm-case-val">' + other.html + '</span>' +
            '<span class="pm-case-cond"><span class="pm-word">otherwise</span></span>';
        }
        return box('pm-cases',
          '<span class="pm-fence pm-brace">{</span><span class="pm-cases-grid">' + rows + '</span>',
          node, ATOM, true);
      }

      case 'Assign': {
        const l = render(node.l);
        const r = render(node.r);
        const glyph = node.op === '=' || node.op === ':=' ? '=' : node.op;
        return box('pm-assign',
          l.html + op(glyph, 'rel') + r.html, node, 1, l.tall || r.tall);
      }

      case 'KeyVal': {
        const v = render(node.value);
        return box('pm-keyval',
          '<span class="pm-name">' + esc(node.name) + '</span>' + op('=', 'rel') + v.html,
          node, 1, v.tall);
      }

      case 'List': {
        const parts = node.items.map(function (i) { return render(i); });
        const tall = parts.some(function (p) { return p.tall; });
        const inner = parts.map(function (p) { return p.html; })
          .join('<span class="pm-punct">,</span><span class="pm-gap"></span>');
        const open = node.kind === '(' ? '(' : node.kind === '[' ? '[' : '{';
        const close = node.kind === '(' ? ')' : node.kind === '[' ? ']' : '}';
        return box('pm-list', fence(inner, open, close, tall), node, ATOM, tall);
      }

      default:
        return box('pm-unknown', esc(node.type), node, ATOM, false);
    }
  }

  return function (node) { return render(node).html; };
}

// An indented view of the parse, for when the picture alone is not conclusive.
function treeText(node, indent) {
  const pad = indent || '';
  if (!node) return pad + '·\n';
  const kids = [];
  let label = node.type;

  switch (node.type) {
    case 'Num': label = 'number ' + node.v; break;
    case 'Str': label = 'string ' + node.v; break;
    case 'Ident': label = 'variable ' + node.name; break;
    case 'Binary': label = 'operator ' + node.op; kids.push(node.l, node.r); break;
    case 'Unary': label = 'unary ' + node.op; kids.push(node.arg); break;
    case 'Assign': label = 'assign ' + node.op; kids.push(node.l, node.r); break;
    case 'Call': label = 'call'; kids.push(node.callee); node.args.forEach(function (a) { kids.push(a); }); break;
    case 'Index': label = 'index'; kids.push(node.obj); node.args.forEach(function (a) { kids.push(a); }); break;
    case 'Member': label = 'field .' + node.name; kids.push(node.obj); break;
    case 'Ternary': label = 'conditional'; kids.push(node.cond, node.then, node.other); break;
    case 'List': label = 'list ' + node.kind; node.items.forEach(function (a) { kids.push(a); }); break;
    case 'KeyVal': label = 'argument ' + node.name; kids.push(node.value); break;
    case 'Transpose': label = 'transpose'; kids.push(node.arg); break;
    case 'Slice': label = 'slice'; node.parts.forEach(function (p) { kids.push(p); }); break;
  }

  let out = pad + label + '\n';
  kids.filter(Boolean).forEach(function (k) { out += treeText(k, pad + '  '); });
  return out;
}

module.exports = { makeRenderer: makeRenderer, treeText: treeText, esc: esc };
