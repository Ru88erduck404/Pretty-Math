'use strict';

// Values from a running Jupyter kernel.
//
// A statically read file can only tell you what an assignment spells out:
// `a0 = cn.value("Bohr radius")` is a library lookup, so there is nothing to
// fold and the name stays a name. A live kernel already knows the answer, and
// asking it is the same thing the Variables view does.
//
// Everything here is best effort. The Jupyter extension may be absent, its API
// may differ, there may be no kernel, or it may be busy: each of those simply
// means no live values, never an error in the panel.

const PROBE_PREFIX = '__pretty_math_probe__';

// A name is only ever a plain identifier. Nothing else may reach the source
// that gets sent to a kernel: this is the one place where text from a file
// becomes code somewhere else, so it refuses anything unexpected itself rather
// than trusting its caller to have filtered.
// Python 3 identifiers may be any Unicode letter, so `længde` has to be
// allowed; what must not get through is a quote, a backslash, a newline, a dot
// or anything else that could end the string and start being code.
const SAFE_NAME = /^[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}_]*$/u;

function safeNames(names) {
  return (names || []).filter(function (n) {
    return typeof n === 'string' && n.length <= 80 && SAFE_NAME.test(n);
  });
}

// One statement, no imports left behind, no `_` history disturbed: builds a
// dict of the names that currently hold a finite real number and prints it as
// JSON. Names it cannot resolve are simply missing from the result.
function probeSource(names) {
  const clean = safeNames(names);
  if (!clean.length) return null;
  const list = clean.map(function (n) { return JSON.stringify(n); }).join(', ');
  return 'print(__import__("json").dumps({k: float(v) for k, v in ' +
    '((n, globals().get(n)) for n in [' + list + ']) ' +
    'if isinstance(v, __import__("numbers").Real) and not isinstance(v, bool) ' +
    'and __import__("math").isfinite(float(v))}))';
}

function decodeOutputs(outputs) {
  const text = [];
  (outputs || []).forEach(function (output) {
    (output.items || []).forEach(function (item) {
      if (!item || !item.data) return;
      const mime = item.mime || '';
      if (mime.indexOf('stdout') === -1 && mime !== 'text/plain') return;
      try {
        text.push(Buffer.from(item.data).toString('utf8'));
      } catch (err) {
        // an item shaped differently than expected: ignore it
      }
    });
  });
  return text.join('');
}

// Pulls the JSON object out of whatever the kernel printed.
function parseProbe(text) {
  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch (err) {
    return null;
  }
}

// `api` is the Jupyter extension's exports; `notebookUri` the notebook to ask.
// Resolves to { name: number } or null.
async function readKernelValues(api, notebookUri, names, options) {
  const opts = options || {};
  if (!api || !api.kernels || typeof api.kernels.getKernel !== 'function') return null;
  const source = probeSource(names);
  if (!source) return null;

  const kernel = await api.kernels.getKernel(notebookUri);
  if (!kernel || typeof kernel.executeCode !== 'function') return null;
  // An idle kernel answers at once; a busy one would queue behind the user's
  // own work, which is not worth waiting for.
  if (kernel.status && kernel.status !== 'idle') return null;

  const outputs = [];
  const iterator = kernel.executeCode(source, opts.token);
  for await (const output of iterator) {
    outputs.push(output);
    if (outputs.length > 20) break;
  }

  const parsed = parseProbe(decodeOutputs(outputs));
  if (!parsed) return null;

  const clean = {};
  Object.keys(parsed).forEach(function (k) {
    const v = parsed[k];
    if (typeof v === 'number' && isFinite(v)) clean[k] = v;
  });
  return Object.keys(clean).length ? clean : null;
}

module.exports = {
  readKernelValues: readKernelValues,
  probeSource: probeSource,
  safeNames: safeNames,
  parseProbe: parseProbe,
  decodeOutputs: decodeOutputs,
  PROBE_PREFIX: PROBE_PREFIX
};
