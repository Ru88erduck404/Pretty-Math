'use strict';

const { flavorFor } = require('./flavors');
const { statementsAt } = require('./prep');
const { parse, precedenceFor } = require('./parser');
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
    result.error = {
      message: err.message || String(err),
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
    result.error = { message: 'Could not draw this expression: ' + (err.message || err), pos: 0, docPos: result.docStart, snippet: esc(chunk.text), caret: '' };
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

  return result;
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
