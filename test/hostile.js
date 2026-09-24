'use strict';

// Hostile and degenerate input aimed at the parts the other suites do not
// reach: the value scanner, the evaluator, the kernel reply parser, and the one
// place where text from a file becomes code somewhere else.

const { analyze } = require('../src/pretty');
const { collectValues, valuesFromDebugger, importModules } = require('../src/values');
const { formatNumber } = require('../src/evaluate');
const { parseProbe, decodeOutputs, probeSource, safeNames } = require('../src/jupyter');

const CFG = {
  multiplication: 'implicit', indexAsSubscript: true, greekLetters: true,
  expandIdentities: true, derivativeSymbol: 'auto', maxLines: 40, valueDigits: 6,
  valueScanLines: 500, stripNamespaces: ['math', 'np', 'sp', 'cn', 'self']
};

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  console.log('FAIL  ' + name);
  if (detail !== undefined) console.log('      ' + detail);
}
function noThrow(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    fail++;
    console.log('FAIL  threw: ' + name);
    console.log('      ' + err.message);
  }
}

// ---- nothing sent to a kernel may be anything but a name -------------------
// This is the only place where text out of a file turns into code running
// somewhere else, so it gets the hardest look.
const INJECTIONS = [
  'a"], "x": __import__("os").system("calc"), "y": ["b',
  "a'", 'a\\', 'a\nimport os', 'a"});import os;print("', 'np.pi', '',
  'a b', '1abc', 'a;b', 'a#b', 'a b', 'a\u0000b', 'a'.repeat(500)
];
INJECTIONS.forEach(function (name) {
  check('refused as a name: ' + JSON.stringify(name.slice(0, 24)),
    safeNames([name]).length === 0);
});
check('a probe of nothing is not built at all', probeSource(['a"b']) === null);
check('the good names survive a mixed batch',
  safeNames(['good', 'ba"d', 'also_good']).join(',') === 'good,also_good');
check('a unicode identifier is allowed, as Python allows it',
  safeNames(['længde', 'Ströme', 'θ_max']).length === 3);

const probe = probeSource(['T', 'længde']);
check('the probe is a single statement', probe.indexOf('\n') === -1);
check('the probe only prints', /^print\(/.test(probe));
check('the probe assigns nothing', probe.indexOf('=') === -1 || !/[^=!<>]=[^=]/.test(probe));
const inside = /\[([^\]]*)\]/.exec(probe);
check('only plain names reach the probe',
  inside[1].split(',').every(function (p) {
    return /^\s*"[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Nd}_]*"\s*$/u.test(p);
  }), inside[1]);

// ---- names that collide with Object.prototype ------------------------------
const POLLUTE = ['__proto__ = 5', 'constructor = 6', 'toString = 7',
  'valueOf = 8', 'x = 2 * 3', ''].join('\n');
noThrow('scanning prototype-shaped names', function () {
  const vals = collectValues(POLLUTE, 'python', CFG);
  check('the scan still works around them', vals.x && vals.x.text === '6');
});
check('Object.prototype is intact', ({}).toString === Object.prototype.toString);
check('nothing was added to Object.prototype', ({}).x === undefined);

noThrow('drawing with a prototype-shaped values map', function () {
  const nasty = JSON.parse('{"__proto__": {"num": 1, "text": "1"}, "toString": {"num": 2, "text": "2"}}');
  const st = analyze('q = toString + 1', { start: 0, end: 0 }, 'python',
    Object.assign({}, CFG, { values: nasty })).statements[0];
  check('no prototype member leaked into the drawing',
    !/\[object|function \(/.test(st.html), st.html.slice(0, 80));
});

// ---- arithmetic that has no sensible answer --------------------------------
[['1/0', 'division by zero'], ['0/0', 'zero over zero'], ['1e400', 'overflow'],
 ['2**10000', 'huge power'], ['math.log(0)', 'log of zero'],
 ['math.log(-1)', 'log of a negative'], ['math.sqrt(-1)', 'root of a negative'],
 ['5 % 0', 'modulo zero'], ['math.factorial(-1)', 'factorial of a negative'],
 ['math.factorial(500)', 'factorial past the limit']
].forEach(function (pair) {
  const got = collectValues('x = ' + pair[0] + '\n', 'python', CFG).x;
  check('no unreadable value from ' + pair[1],
    !got || !/NaN|Infinity|undefined|null/.test(got.text),
    got && got.text);
});

// ---- formatNumber ----------------------------------------------------------
[NaN, Infinity, -Infinity, 0, -0, 1e-323, 1e308, -1e308, 0.1 + 0.2, 1 / 3,
  Number.MAX_SAFE_INTEGER].forEach(function (n) {
  const out = formatNumber(n, 6);
  check('formatNumber is readable for ' + n,
    out === null || !/undefined|NaN|Infinity/.test(String(out)), String(out));
});
[0, 1, 20, 100].forEach(function (d) {
  noThrow('formatNumber with digits=' + d, function () { formatNumber(1.2345e-30, d); });
});

// ---- whatever a kernel or debugger sends back ------------------------------
['', '{}', 'not json', '{"a": 1', '{"a": NaN}', '{"a": null}', '{"a": "text"}',
 '{"a": [1,2]}', 'Traceback...\nNameError\n', '{"a": 1}{"b": 2}',
 '{"__proto__": {"x": 1}}', '{"a": 1e999}'
].forEach(function (text) {
  noThrow('parseProbe ' + JSON.stringify(text.slice(0, 20)), function () {
    const out = parseProbe(text);
    check('parseProbe returns an object or nothing for ' + JSON.stringify(text.slice(0, 20)),
      out === null || typeof out === 'object');
  });
});

[null, undefined, [], [{}], [{ items: null }], [{ items: [{}] }],
 [{ items: [{ mime: 'text/plain' }] }],
 [{ items: [{ mime: 'text/plain', data: 'not a buffer' }] }]
].forEach(function (o, i) {
  noThrow('decodeOutputs shape ' + i, function () { decodeOutputs(o); });
});

[null, undefined, {}, { a: null }, { a: {} }, { a: [] }, { a: 'inf' },
 { a: 'nan' }, { a: '1e999' }, { a: '0x10' }, { a: 'x'.repeat(1000) }
].forEach(function (raw, i) {
  noThrow('valuesFromDebugger shape ' + i, function () {
    const out = valuesFromDebugger(raw, 6);
    Object.keys(out).forEach(function (k) {
      check('debugger value ' + k + ' is readable',
        out[k] && typeof out[k].text === 'string' &&
        !/NaN|Infinity|undefined/.test(out[k].text));
    });
  });
});

// ---- files built to be awkward ---------------------------------------------
const FILES = [
  'x = ' + 'a'.repeat(50000),
  'x = ' + '('.repeat(2000) + '1' + ')'.repeat(2000),
  ('x = 1\n').repeat(3000),
  'x' + '.y'.repeat(3000) + ' = 1',
  'import ' + 'a'.repeat(20000) + ' as b',
  'x = "' + 'q'.repeat(50000) + '"',
  '='.repeat(5000),
  'x = 1 ' + '+ 1 '.repeat(10000),
  'x = 0x' + 'F'.repeat(3000)
];
FILES.forEach(function (text, i) {
  const started = Date.now();
  noThrow('hostile file ' + i, function () { collectValues(text, 'python', CFG); });
  const ms = Date.now() - started;
  check('hostile file ' + i + ' finishes quickly', ms < 3000, ms + 'ms');
});

// ---- import lines that are not really imports ------------------------------
['import', 'from', 'from x import', 'import as', 'import x as',
 'from . import y', 'import a.b.c as d', 'import a, b, c',
 'importantly = 5', 'from_here = 3'
].forEach(function (line) {
  noThrow('import shape: ' + line, function () {
    const mods = importModules(line + '\n');
    Object.keys(mods).forEach(function (k) {
      check('module entry for ' + JSON.stringify(line) + ' is sane',
        !!k && typeof mods[k] === 'string');
    });
  });
});
check('a name that merely starts with import is not one',
  importModules('importantly = 5\n').importantly === undefined);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
