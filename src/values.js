'use strict';

// Finds what the variables in a formula are worth, by reading assignments that
// appear earlier in the file. Nothing is executed: each right-hand side is
// parsed and handed to the closed evaluator, so only arithmetic over literals
// and previously-seen names produces a value.
//
// This is a static approximation and says so: the last assignment before the
// cursor wins, whether or not it is inside a branch or a loop the code never
// takes. Values from a paused debug session, when there is one, are better and
// override these.

const { flavorFor } = require('./flavors');
const { parse } = require('./parser');
const { stripComments, stripScaffolding, flatten, fromDocument } = require('./prep');
const { evaluate, formatNumber } = require('./evaluate');

// `name = rest`, allowing a type annotation and an augmented operator.
const ASSIGN = /^([A-Za-z_$À-￿][\w$.À-￿]*)\s*(?::\s*[^=]+?\s*)?(=|\+=|-=|\*=|\/=|\*\*=|:=)\s*(.+)$/;

// Does this right-hand side refer to `name`? Word-boundary matching is enough:
// a false positive only costs us a value we would rather not trust anyway.
function mentions(rhs, name, flavor) {
  const bare = name.split('.').pop();
  const pattern = new RegExp('(^|[^\\w$.])' + bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  return pattern.test(rhs);
}

function cleanLine(raw, flavor) {
  const chunk = flatten(stripComments(fromDocument(raw, 0), flavor));
  return stripScaffolding(chunk).text;
}

// Scans `text` and returns { name: { num, text } } for every name it can pin
// down to a number.
function collectValues(text, languageId, config) {
  const cfg = config || {};
  const flavor = flavorFor(languageId, cfg);
  const strip = new Set(cfg.stripNamespaces || []);
  const digits = cfg.valueDigits || 6;
  const env = {};
  const out = {};

  const lines = String(text).split('\n');
  const start = Math.max(0, lines.length - (cfg.valueScanLines || 500));

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    // Cheap rejection first: most lines are not assignments.
    if (raw.indexOf('=') === -1) continue;

    let line;
    try {
      line = cleanLine(raw, flavor);
    } catch (err) {
      continue;
    }
    const m = ASSIGN.exec(line);
    if (!m) continue;

    const name = m[1];
    const op = m[2];
    const rhs = m[3];
    // A comparison, not an assignment.
    if (/^=/.test(rhs)) continue;

    // A name defined in terms of itself is a running total or a loop update:
    // `velocity = velocity - g * dt` has a different value on every pass, so
    // folding one iteration would produce a number that is precise and false.
    // The same goes for `total += x`, which is self-referential by definition.
    if (op !== '=' && op !== ':=') {
      delete env[name];
      delete out[name];
      continue;
    }
    if (mentions(rhs, name, flavor)) {
      delete env[name];
      delete out[name];
      continue;
    }

    let value = null;
    try {
      const ast = parse(rhs, flavor);
      value = evaluate(ast, env, strip);
    } catch (err) {
      value = null;
    }

    if (value === null) {
      // The name has been reassigned to something we cannot follow, so what we
      // knew about it is now wrong. Forgetting beats being confidently stale.
      delete env[name];
      delete out[name];
      continue;
    }

    const shown = formatNumber(value, digits);
    if (shown === null) continue;

    env[name] = value;
    out[name] = { num: value, text: shown };

    // self.mass is drawn as `mass`, so record it under that name too.
    const parts = name.split('.');
    if (parts.length > 1 && strip.has(parts[0])) {
      const short = parts[parts.length - 1];
      env[short] = value;
      out[short] = { num: value, text: shown };
    }
  }

  return out;
}

// Turns whatever a debug adapter reports into the same shape, keeping only
// values that are genuinely numeric -- an array or an object would wreck the
// layout and tell you nothing you could read at a glance.
function valuesFromDebugger(raw, digits) {
  const out = {};
  Object.keys(raw || {}).forEach(function (name) {
    const text = String(raw[name]).trim();
    if (!text || text.length > 24) return;
    const cleaned = text.replace(/^np\.float\d*\(|\)$/g, '').replace(/_/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return;
    const num = Number(cleaned);
    if (!Number.isFinite(num)) return;
    const shown = formatNumber(num, digits || 6);
    if (shown !== null) out[name] = { num: num, text: shown, live: true };
  });
  return out;
}

// Module aliases declared in the file. `import sympy as sp` and
// `from scipy import constants as cn` make sp and cn qualifiers, so cn.R should
// be drawn as R -- the same treatment np and math get by default, but learned
// from the file rather than configured.
const IMPORT_AS = /^\s*(?:from\s+[\w.]+\s+)?import\s+(.+)$/;

function importAliases(text) {
  const found = [];
  String(text).split('\n').forEach(function (line) {
    if (line.indexOf('import') === -1) return;
    const m = IMPORT_AS.exec(line.split('#')[0]);
    if (!m) return;
    m[1].split(',').forEach(function (piece) {
      const as = /^\s*([\w.]+)\s+as\s+([A-Za-z_]\w*)\s*$/.exec(piece);
      if (as) {
        if (found.indexOf(as[2]) === -1) found.push(as[2]);
        return;
      }
      // `from scipy import constants` makes `constants` a qualifier too.
      const plain = /^\s*([A-Za-z_]\w*)\s*$/.exec(piece);
      if (plain && /^\s*from\s/.test(line) && found.indexOf(plain[1]) === -1) {
        found.push(plain[1]);
      }
    });
  });
  return found;
}

module.exports = {
  collectValues: collectValues,
  valuesFromDebugger: valuesFromDebugger,
  importAliases: importAliases
};
