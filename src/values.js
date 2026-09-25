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
const { evaluate, formatNumber, MODULE_CONSTANTS } = require('./evaluate');

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
  // What the file called each module, so cn.bar resolves to scipy's bar.
  const modules = importModules(text);

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
      value = evaluate(ast, env, strip, modules);
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

  // A module's constants are worth showing where they appear, not just where
  // they feed an assignment: with values on, `cn.R * T` should read 8.31446 · T
  // rather than R · T. Only the qualified spelling is recorded, so a variable
  // of your own called R is never mistaken for the gas constant.
  Object.keys(modules).forEach(function (alias) {
    const table = MODULE_CONSTANTS[modules[alias]];
    if (!table) return;
    const used = new RegExp('\\b' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\.([A-Za-z_]\\w*)\\b', 'g');
    let m;
    while ((m = used.exec(text)) !== null) {
      const attr = m[1];
      const key = alias + '.' + attr;
      if (!Object.prototype.hasOwnProperty.call(table, attr)) continue;
      // Something the file assigned to that same name wins: the table is only
      // what the module ships with.
      if (Object.prototype.hasOwnProperty.call(out, key)) continue;
      const shown = formatNumber(table[attr], digits);
      if (shown === null) continue;
      out[key] = { num: table[attr], text: shown, constant: true };
    }
  });

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
const IMPORT_LINE = /^\s*(?:from\s+([\w.]+)\s+)?import\s+(.+)$/;

// { alias: "the module it stands for" }, so `from scipy import constants as cn`
// records cn -> scipy.constants and cn.bar can be looked up in that module's
// own table of constants.
function importModules(text) {
  const found = {};
  String(text).split('\n').forEach(function (line) {
    if (line.indexOf('import') === -1) return;
    const m = IMPORT_LINE.exec(line.split('#')[0]);
    if (!m) return;
    const from = m[1] || null;
    m[2].split(',').forEach(function (piece) {
      const as = /^\s*([\w.]+)\s+as\s+([A-Za-z_]\w*)\s*$/.exec(piece);
      if (as) {
        found[as[2]] = from ? from + '.' + as[1] : as[1];
        return;
      }
      // `from scipy import constants` makes `constants` a qualifier, and a
      // plain `import math` makes `math` stand for itself -- otherwise
      // `import numpy as np` would know np.pi while `import numpy` did not.
      const plain = /^\s*([\w.]+)\s*$/.exec(piece);
      if (plain) found[plain[1]] = from ? from + '.' + plain[1] : plain[1];
    });
  });
  return found;
}

function importAliases(text) {
  return Object.keys(importModules(text));
}

module.exports = {
  collectValues: collectValues,
  valuesFromDebugger: valuesFromDebugger,
  importAliases: importAliases,
  importModules: importModules
};
