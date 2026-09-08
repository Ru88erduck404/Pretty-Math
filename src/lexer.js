'use strict';

// Longest-match first.
const OPS = [
  '>>>=', '<<=', '>>=', '===', '!==', '**=', '>>>', '//=',
  '**', '//', '<<', '>>', '<=', '>=', '==', '!=', '~=', '&&', '||', '=>', '->',
  '.*', './', '.^', '.\\', ':=', '+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=',
  '+', '-', '*', '/', '%', '^', '&', '|', '~', '!', '<', '>', '=', '?', ':',
  '.', ',', '(', ')', '[', ']', '{', '}', '@', '\\', ';', '$'
];

// Any Unicode letter, so identifiers like `længde`, `Ströme` or `Δt` lex the
// same as ASCII ones.
const ID_START = /[\p{L}\p{Nl}_$]/u;
const ID_PART = /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}_$]/u;

class LexError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

// `src` is the cleaned expression text; every token carries its offset in it.
function tokenize(src, flavor) {
  const f = flavor || {};
  const out = [];
  let i = 0;
  const n = src.length;

  const prev = () => (out.length ? out[out.length - 1] : null);
  // A quote directly after a value is MATLAB's transpose, not the start of a string.
  const afterValue = () => {
    const p = prev();
    if (!p) return false;
    if (p.t === 'num' || p.t === 'ident' || p.t === 'str') return true;
    return p.t === 'op' && (p.v === ')' || p.v === ']' || p.v === "'");
  };

  while (i < n) {
    const c = src[i];

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }

    if (c === "'" && f.transposeQuote && afterValue()) {
      out.push({ t: 'op', v: "'", s: i, e: i + 1 });
      i++;
      continue;
    }

    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i = Math.min(i + 1, n);
      out.push({ t: 'str', v: src.slice(start, i), s: start, e: i });
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const start = i;
      if (c === '0' && /[xXbBoO]/.test(src[i + 1] || '')) {
        i += 2;
        while (i < n && /[0-9a-fA-F_]/.test(src[i])) i++;
      } else {
        while (i < n && /[0-9_]/.test(src[i])) i++;
        if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) {
          i++;
          while (i < n && /[0-9_]/.test(src[i])) i++;
        } else if (src[i] === '.' && !ID_START.test(src[i + 1] || '')) {
          i++; // trailing "2." as in C / MATLAB
        }
        if (/[eE]/.test(src[i] || '') && /[0-9+-]/.test(src[i + 1] || '')) {
          i += 2;
          while (i < n && /[0-9_]/.test(src[i])) i++;
        }
      }
      while (i < n && /[jJfFlLuUdD]/.test(src[i]) && !ID_PART.test(src[i + 1] || '')) i++;
      out.push({ t: 'num', v: src.slice(start, i), s: start, e: i });
      continue;
    }

    if (ID_START.test(c)) {
      const start = i;
      while (i < n && ID_PART.test(src[i])) i++;
      out.push({ t: 'ident', v: src.slice(start, i), s: start, e: i });
      continue;
    }

    let matched = null;
    for (const op of OPS) {
      if (src.startsWith(op, i)) { matched = op; break; }
    }
    if (matched) {
      out.push({ t: 'op', v: matched, s: i, e: i + matched.length });
      i += matched.length;
      continue;
    }

    throw new LexError('Unexpected character ' + JSON.stringify(c), i);
  }

  out.push({ t: 'end', v: '', s: n, e: n });
  return out;
}

module.exports = { tokenize, LexError };
