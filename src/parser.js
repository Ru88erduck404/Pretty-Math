'use strict';

const { tokenize } = require('./lexer');

class ParseError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

// Binding powers. Higher binds tighter. Python-family table: bitwise operators
// bind tighter than comparisons, so `flags & 0xFF == 0` masks then compares.
const PREC = {
  '||': 4, 'or': 4,
  '&&': 6, 'and': 6,
  '==': 10, '!=': 10, '===': 10, '!==': 10, '<': 10, '>': 10, '<=': 10, '>=': 10,
  'in': 10, 'is': 10,
  '|': 12,
  'xor': 14,
  '&': 16,
  '<<': 18, '>>': 18, '>>>': 18,
  '+': 20, '-': 20,
  '*': 22, '/': 22, '%': 22, '//': 22, '@': 22, '.*': 22, './': 22, 'mod': 22, 'div': 22,
  '**': 26, '.^': 26
};
// C-family table: bitwise operators are looser than comparisons, and equality is
// looser than the relational operators. In C, `flags & 0xFF == 0` is
// `flags & (0xFF == 0)`, which is almost never what the author meant.
const PREC_C = Object.assign({}, PREC, {
  '|': 7,
  'xor': 8,
  '&': 9,
  '==': 10, '!=': 10, '===': 10, '!==': 10,
  '<': 11, '>': 11, '<=': 11, '>=': 11, 'in': 11, 'is': 11
});

function precedenceFor(flavor) {
  return (flavor && flavor.bitwiseBindsTighter) ? PREC : PREC_C;
}

const RIGHT_ASSOC = new Set(['**', '.^']);
const COMPARISON = new Set(['==', '!=', '===', '!==', '<', '>', '<=', '>=', 'in', 'is']);
const PREFIX_PREC = 24;
const NOT_PREC = 8;
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '//=', ':=', '<<=', '>>=', '&=', '|=', '^=']);

// Words that can only be a type in a C-style cast, never a variable.
const TYPE_WORDS = new Set([
  'void', 'bool', 'char', 'short', 'int', 'long', 'float', 'double',
  'signed', 'unsigned', 'byte', 'size_t', 'ssize_t', 'ptrdiff_t',
  'Integer', 'Long', 'Short', 'Byte', 'Float', 'Double', 'Number'
]);

function isTypeWord(word) {
  return TYPE_WORDS.has(word) || /^u?int(_fast|_least)?(8|16|32|64|max|ptr)?_t$/.test(word);
}

class Parser {
  constructor(src, flavor) {
    this.src = src;
    this.f = flavor || {};
    this.prec = precedenceFor(this.f);
    this.toks = tokenize(src, this.f);
    this.i = 0;
  }

  peek(k) { return this.toks[this.i + (k || 0)]; }
  next() { return this.toks[this.i++]; }
  at(v) { const t = this.peek(); return (t.t === 'op' || t.t === 'ident') && t.v === v; }
  atOp(v) { const t = this.peek(); return t.t === 'op' && t.v === v; }
  eat(v) { if (this.at(v)) { this.i++; return true; } return false; }
  expect(v) {
    if (!this.eat(v)) {
      const t = this.peek();
      throw new ParseError(
        'Expected ' + JSON.stringify(v) + (t.t === 'end' ? ' but the expression ends here' : ' but found ' + JSON.stringify(t.v)),
        t.s);
    }
  }

  node(type, props, s, e) {
    return Object.assign({ type: type, s: s, e: e }, props);
  }

  // Reads the operator at the cursor as an infix operator, honouring the flavor.
  infix() {
    const t = this.peek();
    if (t.t === 'ident') {
      const w = t.v;
      if (this.f.wordLogic && (w === 'and' || w === 'or' || w === 'in' || w === 'is')) return w;
      if (w === 'mod' || w === 'div') return w;
      return null;
    }
    if (t.t !== 'op') return null;
    let v = t.v;
    if (v === '^') v = this.f.caretIsPower ? '**' : 'xor';
    if (v === '~=') v = '!=';
    if (v === '//' && !this.f.floorDiv) return null;
    if (Object.prototype.hasOwnProperty.call(this.prec, v)) return v;
    return null;
  }

  parseStatement() {
    const left = this.parseExpr(0);
    const t = this.peek();
    if (t.t === 'op' && ASSIGN_OPS.has(t.v)) {
      this.next();
      const right = this.parseStatement();
      return this.node('Assign', { op: t.v, l: left, r: right }, left.s, right.e);
    }
    return left;
  }

  parseExpr(minBp) {
    let left = this.parseUnary();

    for (;;) {
      // Python's conditional expression: value if test else other
      if (this.f.wordLogic && this.peek().t === 'ident' && this.peek().v === 'if' && minBp <= 2) {
        this.next();
        const cond = this.parseExpr(3);
        let other = null;
        if (this.peek().t === 'ident' && this.peek().v === 'else') {
          this.next();
          other = this.parseExpr(2);
        }
        left = this.node('Ternary', { cond: cond, then: left, other: other }, left.s, (other || cond).e);
        continue;
      }

      // JavaScript's arrow function: the parameters were already parsed as a
      // name or a parenthesised list.
      if (this.atOp('=>') && this.f.arrowFunctions && minBp <= 2) {
        this.next();
        const body = this.parseExpr(2);
        const params = left.type === 'List' ? left.items : [left];
        left = this.node('Lambda', { params: params, body: body }, left.s, body.e);
        continue;
      }

      // Rust and friends: `a as f64`
      if (this.f.asCasts && this.peek().t === 'ident' && this.peek().v === 'as' &&
          this.peek(1).t === 'ident' && minBp <= 23) {
        this.next();
        const type = this.next();
        left = this.node('Cast', { name: type.v, arg: left, suffix: true }, left.s, type.e);
        continue;
      }

      if (this.atOp('?') && minBp <= 2) {
        this.next();
        const then = this.parseExpr(0);
        this.expect(':');
        const other = this.parseExpr(2);
        left = this.node('Ternary', { cond: left, then: then, other: other }, left.s, other.e);
        continue;
      }

      const op = this.infix();
      if (op === null) break;
      const bp = this.prec[op];
      if (bp < minBp) break;
      const rightBp = RIGHT_ASSOC.has(op) ? bp : bp + 1;
      this.next();
      const right = this.parseExpr(rightBp);
      left = this.node('Binary', { op: op, l: left, r: right }, left.s, right.e);
    }

    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
      this.next();
      const op = (t.v === '~' && this.f.tildeNot) ? '!' : t.v;
      const arg = this.parseExpr(op === '!' ? NOT_PREC : PREFIX_PREC);
      return this.node('Unary', { op: op, arg: arg }, t.s, arg.e);
    }
    if (t.t === 'ident' && t.v === 'not' && this.f.wordLogic) {
      this.next();
      const arg = this.parseExpr(NOT_PREC);
      return this.node('Unary', { op: '!', arg: arg }, t.s, arg.e);
    }
    return this.parsePostfix(this.parsePrimary());
  }

  parsePostfix(base) {
    for (;;) {
      if (this.atOp('(')) {
        this.next();
        const args = this.parseArgs(')', false);
        const close = this.peek();
        this.expect(')');
        base = this.node('Call', { callee: base, args: args }, base.s, close.e);
      } else if (this.atOp('[')) {
        this.next();
        const args = this.parseArgs(']', true);
        const close = this.peek();
        this.expect(']');
        base = this.node('Index', { obj: base, args: args }, base.s, close.e);
      } else if (this.atOp('.') && this.peek(1).t === 'ident') {
        this.next();
        const name = this.next();
        base = this.node('Member', { obj: base, name: name.v }, base.s, name.e);
      } else if (this.atOp(':') && this.peek(1).t === 'op' && this.peek(1).v === ':' &&
                 this.peek(2).t === 'ident') {
        // C++ and Rust scope resolution. Matched as two colons rather than one
        // `::` token so that Python's arr[::2] still lexes as a slice.
        this.next();
        this.next();
        const name = this.next();
        base = this.node('Member', { obj: base, name: name.v }, base.s, name.e);
      } else if (this.atOp("'")) {
        const q = this.next();
        base = this.node('Transpose', { arg: base }, base.s, q.e);
      } else {
        return base;
      }
    }
  }

  // `x**2 for x in values if x > 0`, once the leading expression is parsed.
  atFor() {
    return this.f.wordLogic && this.peek().t === 'ident' && this.peek().v === 'for';
  }

  parseComprehension(body) {
    const clauses = [];
    let end = body.e;
    while (this.atFor()) {
      this.next();
      const targets = [];
      for (;;) {
        targets.push(this.parsePostfix(this.parsePrimary()));
        if (this.eat(',')) continue;
        break;
      }
      if (!(this.peek().t === 'ident' && this.peek().v === 'in')) {
        throw new ParseError('Expected "in" after the loop variable', this.peek().s);
      }
      this.next();
      // Binding power 3 keeps `if` out of this: a comprehension filter is not
      // the conditional expression `a if c else b`.
      const iter = this.parseExpr(3);
      end = iter.e;
      const conds = [];
      while (this.peek().t === 'ident' && this.peek().v === 'if') {
        this.next();
        const cond = this.parseExpr(3);
        conds.push(cond);
        end = cond.e;
      }
      clauses.push({ targets: targets, iter: iter, conds: conds });
    }
    return this.node('Comprehension', { body: body, clauses: clauses }, body.s, end);
  }

  parseArgs(closer, allowSlice) {
    const args = [];
    if (this.atOp(closer)) return args;
    for (;;) {
      args.push(this.parseArgItem(allowSlice));
      if (args.length === 1 && this.atFor()) {
        args[0] = this.parseComprehension(args[0]);
        break;
      }
      if (this.eat(',')) {
        if (this.atOp(closer)) break; // trailing comma
        continue;
      }
      break;
    }
    return args;
  }

  parseArgItem(allowSlice) {
    if (allowSlice && this.atOp(':')) return this.parseSlice(null, this.peek().s);
    // Python's *args / **kwargs, and JavaScript's ...rest
    if (this.atOp('*') || this.atOp('**')) {
      const star = this.next();
      const arg = this.parseExpr(0);
      return this.node('Spread', { op: star.v, arg: arg }, star.s, arg.e);
    }
    // Keyword argument: name=value (never a comparison, so no ambiguity)
    if (this.peek().t === 'ident' && this.peek(1).t === 'op' && this.peek(1).v === '=' &&
        !(this.peek(2).t === 'op' && this.peek(2).v === '=')) {
      const name = this.next();
      this.next();
      const value = this.parseExpr(0);
      return this.node('KeyVal', { name: name.v, value: value }, name.s, value.e);
    }
    const first = this.parseExpr(0);
    if (allowSlice && this.atOp(':')) return this.parseSlice(first, first.s);
    return first;
  }

  parseSlice(start, s) {
    const parts = [start];
    let end = start ? start.e : s;
    while (this.atOp(':')) {
      end = this.next().e;
      if (this.atOp(':') || this.atOp(']') || this.atOp(',')) { parts.push(null); continue; }
      const p = this.parseExpr(0);
      parts.push(p);
      end = p.e;
    }
    return this.node('Slice', { parts: parts }, s, end);
  }

  // A parenthesised type, as in `(double) total` — only where the language has
  // C-style casts, and only for words that cannot be variable names.
  castTypeAhead() {
    if (!this.f.cCasts || !this.atOp('(')) return 0;
    let k = 1;
    let words = 0;
    for (;;) {
      const t = this.peek(k);
      if (t.t === 'ident' && isTypeWord(t.v)) { words++; k++; continue; }
      if (t.t === 'op' && (t.v === '*' || t.v === '&') && words > 0) { k++; continue; }
      break;
    }
    if (!words) return 0;
    const close = this.peek(k);
    if (!(close.t === 'op' && close.v === ')')) return 0;
    // Something must follow that a cast can apply to.
    const after = this.peek(k + 1);
    const applies = after.t === 'ident' || after.t === 'num' ||
      (after.t === 'op' && ('(-+!~'.indexOf(after.v) >= 0));
    return applies ? k + 1 : 0;
  }

  parsePrimary() {
    const t = this.peek();

    if (t.t === 'num') { this.next(); return this.node('Num', { v: t.v }, t.s, t.e); }
    if (t.t === 'str') { this.next(); return this.node('Str', { v: t.v }, t.s, t.e); }

    if (t.t === 'ident') {
      // Python's lambda: `lambda x, y: x * y`
      if (t.v === 'lambda' && this.f.wordLogic) {
        this.next();
        const params = [];
        while (this.peek().t === 'ident') {
          const p = this.next();
          params.push(this.node('Ident', { name: p.v }, p.s, p.e));
          if (!this.eat(',')) break;
        }
        this.expect(':');
        const body = this.parseExpr(2);
        return this.node('Lambda', { params: params, body: body }, t.s, body.e);
      }
      this.next();
      return this.node('Ident', { name: t.v }, t.s, t.e);
    }

    if (t.t === 'op' && t.v === '(') {
      const skip = this.castTypeAhead();
      if (skip) {
        const words = [];
        for (let k = 1; k < skip - 1; k++) {
          const tok = this.peek(k);
          if (tok.t === 'ident' || tok.v === '*' || tok.v === '&') words.push(tok.v);
        }
        for (let k = 0; k < skip; k++) this.next();
        const arg = this.parseUnary();
        return this.node('Cast', { name: words.join(' '), arg: arg, suffix: false }, t.s, arg.e);
      }
    }

    if (t.t === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) {
      const closer = t.v === '(' ? ')' : t.v === '[' ? ']' : '}';
      this.next();
      const items = this.parseArgs(closer, false);
      const close = this.peek();
      this.expect(closer);
      if (t.v === '(' && items.length === 1 && items[0].type !== 'KeyVal') {
        // Keep the child, but record that parentheses were written around it.
        return Object.assign({}, items[0], { s: t.s, e: close.e, grouped: true });
      }
      return this.node('List', { items: items, kind: t.v }, t.s, close.e);
    }

    if (t.t === 'end') throw new ParseError('The expression ends before it is complete', t.s);
    throw new ParseError('Unexpected ' + JSON.stringify(t.v), t.s);
  }
}

function parse(src, flavor) {
  const p = new Parser(src, flavor);
  const node = p.parseStatement();
  const t = p.peek();
  if (t.t !== 'end') throw new ParseError('Unexpected ' + JSON.stringify(t.v), t.s);
  return node;
}

// "np.linalg.norm" for a Member/Ident chain, otherwise null.
function dottedName(node) {
  if (!node) return null;
  if (node.type === 'Ident') return node.name;
  if (node.type === 'Member') {
    const base = dottedName(node.obj);
    return base === null ? null : base + '.' + node.name;
  }
  return null;
}

module.exports = {
  parse: parse,
  ParseError: ParseError,
  dottedName: dottedName,
  PREC: PREC,
  PREC_C: PREC_C,
  precedenceFor: precedenceFor,
  COMPARISON: COMPARISON
};
