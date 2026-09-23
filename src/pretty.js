'use strict';

const { flavorFor } = require('./flavors');
const { statementsAt } = require('./prep');
const { parse, precedenceFor, dottedName } = require('./parser');
const { makeRenderer, treeText, esc } = require('./render');
const { toLatex } = require('./latex');

// Parses and renders one already-cleaned statement.
function renderChunk(chunk, flavor, config) {
  const mapOffset = function (i) {
    const m = chunk.map;
    const k = Math.max(0, Math.min(i, m.length - 1));
    return m[k];
  };

  const result = {
    source: chunk.text,
    docStart: mapOffset(0),
    docEnd: mapOffset(chunk.text.length),
    html: '',
    latex: '',
    tree: '',
    error: null
  };

  let ast;
  try {
    ast = parse(chunk.text, flavor);
  } catch (err) {
    const pos = typeof err.pos === 'number' ? err.pos : 0;
    const deep = /call stack/i.test(err.message || '');
    result.error = {
      message: deep
        ? 'This expression nests too deeply to read. Select a smaller part of it.'
        : (err.message || String(err)),
      pos: pos,
      docPos: mapOffset(pos),
      snippet: esc(chunk.text),
      caret: ' '.repeat(Math.max(0, pos)) + '^'
    };
    return result;
  }

  const opts = {
    map: mapOffset,
    prec: precedenceFor(flavor),
    chainsComparisons: flavor.chainsComparisons,
    values: config.values || null,
    multiplication: config.multiplication,
    indexAsSubscript: config.indexAsSubscript,
    greek: config.greekLetters,
    expandIdentities: config.expandIdentities,
    derivativeSymbol: config.derivativeSymbol,
    stripNamespaces: config.stripNamespaces
  };

  try {
    result.html = makeRenderer(opts)(ast);
  } catch (err) {
    const deep = /call stack/i.test(err.message || '');
    result.error = {
      message: deep
        ? 'This expression nests too deeply to draw. Select a smaller part of it.'
        : 'Could not draw this expression: ' + (err.message || err),
      pos: 0,
      docPos: result.docStart,
      snippet: esc(chunk.text),
      caret: ''
    };
    return result;
  }

  try {
    result.latex = toLatex(ast, opts);
  } catch (err) {
    result.latex = '';
  }
  try {
    result.tree = treeText(ast, '');
  } catch (err) {
    result.tree = '';
  }

  result.names = readableNames(ast, config.stripNamespaces || []);

  return result;
}

// Every name whose value would be worth asking a debugger about: the ones that
// are read, not the ones being defined or bound here.
function readableNames(ast, stripNamespaces) {
  const strip = new Set(stripNamespaces);
  const names = [];
  const seen = Object.create(null);

  const add = function (name) {
    if (!name || seen[name]) return;
    seen[name] = true;
    names.push(name);
  };

  // Names the expression binds itself shadow anything of that name outside it.
  const shadowed = Object.create(null);
  const idents = function (node, into) {
    if (!node || typeof node !== 'object') return into;
    if (node.type === 'Ident') { into.push(node.name); return into; }
    Object.keys(node).forEach(function (k) {
      if (k === 'type' || k === 's' || k === 'e') return;
      const child = node[k];
      if (Array.isArray(child)) child.forEach(function (c) { idents(c, into); });
      else if (child && typeof child === 'object') idents(child, into);
    });
    return into;
  };
  const shadow = function (names, fn) {
    names.forEach(function (n) { shadowed[n] = (shadowed[n] || 0) + 1; });
    try {
      fn();
    } finally {
      names.forEach(function (n) {
        shadowed[n] -= 1;
        if (!shadowed[n]) delete shadowed[n];
      });
    }
  };

  const walk = function (node, bound) {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'Ident':
        if (!bound && !shadowed[node.name]) add(node.name);
        return;
      case 'Member': {
        const dotted = dottedName(node);
        if (dotted !== null) {
          if (!bound) {
            add(dotted);
            const parts = dotted.split('.');
            if (parts.length > 1 && strip.has(parts[0])) add(parts[parts.length - 1]);
          }
          return;
        }
        walk(node.obj, bound);
        return;
      }
      case 'Assign':
        walk(node.l, true);
        walk(node.r, bound);
        return;
      case 'Lambda':
        shadow(idents({ list: node.params }, []), function () {
          walk(node.body, bound);
        });
        return;
      case 'Comprehension': {
        const targets = [];
        node.clauses.forEach(function (c) {
          c.targets.forEach(function (t) { idents(t, targets); });
        });
        shadow(targets, function () {
          walk(node.body, bound);
          node.clauses.forEach(function (c) {
            walk(c.iter, bound);
            c.conds.forEach(function (x) { walk(x, bound); });
          });
        });
        return;
      }
      case 'Call':
        // The callee is a function name, not a value to substitute.
        node.args.forEach(function (a) { walk(a, bound); });
        return;
      default:
        break;
    }
    Object.keys(node).forEach(function (key) {
      if (key === 'type' || key === 's' || key === 'e') return;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(function (c) { walk(c, bound); });
      else if (child && typeof child === 'object') walk(child, bound);
    });
  };

  walk(ast, false);
  return names;
}

// Everything the panel needs for the current cursor position or selection.
function analyze(text, sel, languageId, config) {
  const cfg = config || {};
  const flavor = flavorFor(languageId, cfg);
  const found = statementsAt(text, sel, flavor, cfg.maxLines || 40, cfg.base || 0);
  const statements = found.statements.map(function (c) {
    return renderChunk(c, flavor, cfg);
  });
  return {
    language: flavor.id,
    caretIsPower: flavor.caretIsPower,
    region: found.region,
    statements: statements
  };
}

module.exports = { analyze: analyze, renderChunk: renderChunk };
