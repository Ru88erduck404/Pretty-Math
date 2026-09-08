'use strict';

const { tokenize } = require('./lexer');

class ParseError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

// Binding powers. Higher binds tighter. Mirrors Python/C precedence, which the
// mainstream languages agree on for everything that matters here.
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
const RIGHT_ASSOC = new Set(['**', '.^']);
const COMPARISON = new Set(['==', '!=', '===', '!==', '<', '>', '<=', '>=', 'in', 'is']);
const PREFIX_PREC = 24;
const NOT_PREC = 8;
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '//=', ':=', '<<=', '>>=', '&=', '|=', '^=']);

class Parser {
  constructor(src, flavor) {
    this.src = src;
    this.f = flavor || {};
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
    if (Object.prototype.hasOwnProperty.call(PREC, v)) return v;
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
      const bp = PREC[op];
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
      } else if (this.atOp("'")) {
        const q = this.next();
        base = this.node('Transpose', { arg: base }, base.s, q.e);
      } else {
        return base;
      }
    }
  }

  parseArgs(closer, allowSlice) {
    const args = [];
    if (this.atOp(closer)) return args;
    for (;;) {
      args.push(this.parseArgItem(allowSlice));
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

  parsePrimary() {
    const t = this.peek();

    if (t.t === 'num') { this.next(); return this.node('Num', { v: t.v }, t.s, t.e); }
    if (t.t === 'str') { this.next(); return this.node('Str', { v: t.v }, t.s, t.e); }

    if (t.t === 'ident') {
      this.next();
      return this.node('Ident', { name: t.v }, t.s, t.e);
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
  COMPARISON: COMPARISON
};
