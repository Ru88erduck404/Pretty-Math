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

// Where do bitwise operators sit relative to comparisons? Python and Julia bind
// `&` tighter than `==`, so `flags & 0xFF == 0` compares the masked value. C and
// its descendants do the opposite — `&` is looser, so the same line means
// `flags & (0xFF == 0)`, the classic C bug. Reading this the same way in both
// would make the panel lie about exactly what it exists to reveal.
const BITWISE_BINDS_TIGHTER = new Set([
  'python', 'cython', 'julia', 'ruby', 'nim', 'coffeescript', 'plaintext'
]);

// Languages where `0 < i < n` means what it means in maths. Everywhere else it
// is `(0 < i) < n` — a comparison against a boolean — so the panel must not
// draw it as a chain.
const CHAINS_COMPARISONS = new Set(['python', 'cython', 'julia', 'coffeescript', 'plaintext']);

// `(double) total / count` is a cast in the C family; in Python the same shape
// is a call, so the two must not be confused.
const C_CASTS = new Set([
  'c', 'cpp', 'csharp', 'java', 'objective-c', 'objective-cpp', 'cuda-cpp'
]);
const ARROW_FUNCTIONS = new Set([
  'javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'svelte', 'vue'
]);

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
    bitwiseBindsTighter: BITWISE_BINDS_TIGHTER.has(id),
    chainsComparisons: CHAINS_COMPARISONS.has(id),
    cCasts: C_CASTS.has(id),
    asCasts: id === 'rust' || id === 'csharp' || id === 'kotlin' || id === 'swift',
    arrowFunctions: ARROW_FUNCTIONS.has(id),
    matrixOps: MATRIX_OPS.has(id),
    // In MATLAB/Octave a trailing quote is transpose, not a string.
    transposeQuote: MATRIX_OPS.has(id) && id !== 'julia',
    tildeNot: MATRIX_OPS.has(id) && id !== 'julia'
  };
}

module.exports = { flavorFor };
