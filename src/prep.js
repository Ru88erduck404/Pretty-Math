'use strict';

// Turns raw editor text into expressions we can parse, while keeping every
// surviving character's offset in the original document so the panel can map
// a rendered sub-expression back to the source range it came from.

// A piece of source: `text` is the cleaned string, `map[i]` is the document
// offset of `text[i]`, and `map[text.length]` is the offset just past the end.
function chunk(text, map) {
  return { text: text, map: map };
}

function fromDocument(text, baseOffset) {
  const map = new Array(text.length + 1);
  for (let i = 0; i <= text.length; i++) map[i] = baseOffset + i;
  return chunk(text, map);
}

function slice(c, from, to) {
  return chunk(c.text.slice(from, to), c.map.slice(from, to + 1));
}

function trim(c) {
  let a = 0;
  let b = c.text.length;
  while (a < b && /\s/.test(c.text[a])) a++;
  while (b > a && /\s/.test(c.text[b - 1])) b--;
  return slice(c, a, b);
}

// Drops comments; keeps string literals (the lexer needs them) but replaces the
// inside with spaces so brackets inside strings never confuse the scanner.
function stripComments(c, flavor) {
  const src = c.text;
  const out = [];
  const map = [];
  const lc = flavor.lineComment;
  let i = 0;

  const keep = function (ch, at) { out.push(ch); map.push(c.map[at]); };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '"' || ch === "'" || ch === '`') {
      // MATLAB transpose: a quote right after a value is an operator, not a string.
      const before = out.length ? out[out.length - 1] : '';
      if (ch === "'" && flavor.transposeQuote && /[A-Za-z0-9_)\]']/.test(before)) {
        keep(ch, i);
        i++;
        continue;
      }
      const q = ch;
      keep(ch, i);
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < src.length) { keep(' ', i); i++; }
        keep(src[i] === '\n' ? '\n' : ' ', i);
        i++;
      }
      if (i < src.length) { keep(q, i); i++; }
      continue;
    }

    if (src.startsWith(lc, i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (flavor.blockComment && src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') keep('\n', k);
      i = stop;
      continue;
    }

    keep(ch, i);
    i++;
  }

  map.push(c.map[c.map.length - 1]);
  return chunk(out.join(''), map);
}

const OPENERS = '([{';
const CLOSERS = ')]}';

// Bracket depth of a line, ignoring anything inside string literals.
function depthDelta(line) {
  let d = 0;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (OPENERS.indexOf(ch) >= 0) d++;
    else if (CLOSERS.indexOf(ch) >= 0) d--;
  }
  return d;
}

const CONTINUES = /[+\-*/,%=<>&|^~?:\\([{.]$/;

function continues(line) {
  const t = line.replace(/\s+$/, '');
  if (!t) return false;
  return CONTINUES.test(t) || /\b(and|or|not|if|else)$/.test(t);
}

// The whole logical statement around `offset`: joins wrapped lines the way the
// language does, so a formula split over five lines is still shown as one.
function logicalRange(text, offset, flavor, maxLines) {
  const limit = maxLines || 60;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineEnd = function (n) {
    const nl = text.indexOf('\n', lineStarts[n]);
    return nl === -1 ? text.length : nl;
  };

  let cur = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i] <= offset) cur = i;
    else break;
  }

  const bare = function (n) {
    const raw = text.slice(lineStarts[n], lineEnd(n));
    const c = stripComments(fromDocument(raw, 0), flavor);
    return c.text;
  };

  let first = cur;
  let last = cur;

  // Walk up while earlier lines leave brackets open or dangle an operator.
  let guard = limit;
  while (first > 0 && guard-- > 0) {
    let d = 0;
    for (let n = first; n <= last; n++) d += depthDelta(bare(n));
    const prevLine = bare(first - 1);
    let dPrev = 0;
    for (let n = first - 1; n <= last; n++) dPrev += depthDelta(bare(n));
    if (d < 0 || dPrev > 0 || continues(prevLine)) first--;
    else break;
  }

  // Walk down while brackets are still open or this line dangles an operator.
  guard = limit;
  while (last + 1 < lineStarts.length && guard-- > 0) {
    let d = 0;
    for (let n = first; n <= last; n++) d += depthDelta(bare(n));
    if (d > 0 || continues(bare(last))) last++;
    else break;
  }

  return { start: lineStarts[first], end: lineEnd(last) };
}

// Splits a cleaned chunk into statements on top-level `;` and newlines.
function splitStatements(c) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  const push = function (from, to) {
    const s = trim(slice(c, from, to));
    if (s.text.length) parts.push(s);
  };

  for (let i = 0; i < c.text.length; i++) {
    const ch = c.text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (OPENERS.indexOf(ch) >= 0) depth++;
    else if (CLOSERS.indexOf(ch) >= 0) depth--;
    else if (depth <= 0 && (ch === ';' || ch === '\n')) {
      push(start, i);
      start = i + 1;
    }
  }
  push(start, c.text.length);
  return parts;
}

const LEAD_KEYWORDS = /^(return|yield|await|assert|elif|else\s+if|else|if|while|until|switch|case|when|do|throw|raise|print|echo|puts|let|const|var|final|static|public|private|protected|unsigned|signed)\b\s*/;
const TYPE_DECL = /^[A-Za-z_][A-Za-z0-9_:<>\[\]*&.]*\s+([A-Za-z_][A-Za-z0-9_]*\s*(=|\+=|-=|\*=|\/=))/;

// Removes the statement scaffolding around the expression: `return`, `if (...)`,
// a C-style type in a declaration, a trailing `:` or `;`.
function stripScaffolding(c) {
  let out = c;
  for (let pass = 0; pass < 4; pass++) {
    const before = out.text;

    // A block boundary left over from the previous line: `} else if (...) {`
    while (out.text.length && (out.text[0] === '{' || out.text[0] === '}')) {
      out = trim(slice(out, 1, out.text.length));
    }

    const kw = out.text.match(LEAD_KEYWORDS);
    if (kw) out = trim(slice(out, kw[0].length, out.text.length));

    const decl = out.text.match(TYPE_DECL);
    if (decl) {
      const at = out.text.indexOf(decl[1]);
      if (at > 0) out = trim(slice(out, at, out.text.length));
    }

    let t = out.text;
    while (t.length && ':;,\\{'.indexOf(t[t.length - 1]) >= 0) {
      out = trim(slice(out, 0, t.length - 1));
      t = out.text;
    }
    const tail = out.text.match(/\s(then|do)$/);
    if (tail) out = trim(slice(out, 0, out.text.length - tail[0].length));
    // `if (cond)` / `while (cond)` leave a fully wrapped pair behind.
    if (/^\(/.test(out.text) && matchingClose(out.text, 0) === out.text.length - 1) {
      out = trim(slice(out, 1, out.text.length - 1));
    }

    if (out.text === before) break;
  }
  return out;
}

function matchingClose(s, at) {
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    const ch = s[i];
    if (OPENERS.indexOf(ch) >= 0) depth++;
    else if (CLOSERS.indexOf(ch) >= 0) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Collapses the physical newlines of a wrapped statement into single spaces.
function flatten(c) {
  const out = [];
  const map = [];
  let lastWasSpace = false;
  for (let i = 0; i < c.text.length; i++) {
    const ch = c.text[i];
    const isSpace = /\s/.test(ch);
    if (isSpace) {
      if (lastWasSpace || out.length === 0) continue;
      out.push(' ');
      map.push(c.map[i]);
      lastWasSpace = true;
    } else {
      out.push(ch);
      map.push(c.map[i]);
      lastWasSpace = false;
    }
  }
  while (out.length && out[out.length - 1] === ' ') { out.pop(); map.pop(); }
  map.push(c.map[c.map.length - 1]);
  return chunk(out.join(''), map);
}

// Entry point: the statements to render for a document offset or a selection.
// `base` is where `text` starts in the real document, so the offsets we hand
// back address the file itself even when only a window of it was scanned.
function statementsAt(text, sel, flavor, maxStatements, base) {
  const at = base || 0;
  let region;
  if (sel && sel.end > sel.start) {
    region = { start: sel.start, end: sel.end };
  } else {
    region = logicalRange(text, sel ? sel.start : 0, flavor);
  }
  const raw = fromDocument(text.slice(region.start, region.end), region.start + at);
  const cleaned = stripComments(raw, flavor);
  const stmts = splitStatements(cleaned)
    .map(flatten)
    .map(stripScaffolding)
    .filter(function (s) { return s.text.length > 0; });
  return {
    region: { start: region.start + at, end: region.end + at },
    statements: stmts.slice(0, maxStatements || 40)
  };
}

module.exports = {
  statementsAt: statementsAt,
  logicalRange: logicalRange,
  stripComments: stripComments,
  splitStatements: splitStatements,
  stripScaffolding: stripScaffolding,
  fromDocument: fromDocument,
  flatten: flatten,
  trim: trim
};
