'use strict';

// Per-language reading rules. The important one is `^`: in C-like languages and
// Python it is bitwise XOR, and silently drawing it as a power would invent a bug
// instead of exposing one.
const POWER_CARET = new Set([
  'matlab', 'octave', 'julia', 'r', 'lua', 'fortran', 'fortran-free-form',
  'FortranFreeForm', 'wolfram', 'mathematica', 'gnuplot', 'vb', 'basic',
  'powershell', 'sql', 'latex', 'tex', 'markdown', 'plaintext'
]);

const HASH_COMMENT = new Set([
  'python', 'r', 'julia', 'ruby', 'perl', 'shellscript', 'powershell', 'yaml',
  'toml', 'makefile', 'cmake', 'coffeescript', 'elixir', 'nim'
]);
const PERCENT_COMMENT = new Set(['matlab', 'octave', 'latex', 'tex', 'erlang', 'prolog']);
const DASH_COMMENT = new Set(['lua', 'haskell', 'sql', 'ada', 'elm', 'vhdl']);
const EXCL_COMMENT = new Set(['fortran', 'fortran-free-form', 'FortranFreeForm']);

const WORD_LOGIC = new Set(['python', 'ruby', 'coffeescript', 'nim', 'elixir', 'sql', 'plaintext']);
const MATRIX_OPS = new Set(['matlab', 'octave', 'julia']);

function flavorFor(languageId, config) {
  const id = String(languageId || 'plaintext');
  const caretCfg = (config && config.caretMeansPower) || 'auto';
  const caretIsPower =
    caretCfg === 'always' ? true :
    caretCfg === 'never' ? false :
    POWER_CARET.has(id);

  return {
    id,
    caretIsPower,
    // `//` is floor division in Python-likes, a line comment nearly everywhere else.
    floorDiv: id === 'python' || id === 'nim' || id === 'cython',
    lineComment:
      HASH_COMMENT.has(id) ? '#' :
      PERCENT_COMMENT.has(id) ? '%' :
      DASH_COMMENT.has(id) ? '--' :
      EXCL_COMMENT.has(id) ? '!' : '//',
    blockComment: !HASH_COMMENT.has(id) && !PERCENT_COMMENT.has(id),
    wordLogic: WORD_LOGIC.has(id),
    matrixOps: MATRIX_OPS.has(id),
    // In MATLAB/Octave a trailing quote is transpose, not a string.
    transposeQuote: MATRIX_OPS.has(id) && id !== 'julia',
    tildeNot: MATRIX_OPS.has(id) && id !== 'julia'
  };
}

module.exports = { flavorFor };
