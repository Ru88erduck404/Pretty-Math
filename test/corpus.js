'use strict';

// A corpus of realistic source lines. Nothing here checks how pretty the output
// is -- that is what run.js does. This checks the properties that must hold for
// every input: it never throws, never takes long, and either draws something or
// reports a parse error, with no half-rendered output in between.
//
// Lines the parser deliberately does not handle live in REFUSES. If support is
// added later, the test fails and the line moves up to RENDERS -- so the list
// doubles as the record of what is not supported yet.

const { analyze } = require('../src/pretty');

const CFG = {
  multiplication: 'implicit', indexAsSubscript: true, greekLetters: true,
  expandIdentities: true, derivativeSymbol: 'auto', maxLines: 40,
  stripNamespaces: ['Math', 'math', 'np', 'numpy', 'scipy', 'sp', 'sympy', 'std', 'self', 'this']
};

const RENDERS = [
  ['python', 'e = 0.5 * m * v**2'],
  ['python', 'total += price * quantity * (1 - discount)'],
  ['python', 'if abs(a - b) < 1e-9:'],
  ['python', 'return (a + b) / 2'],
  ['python', 'rate = base_rate * (1 + inflation) ** years'],
  ['python', 'idx = (i * width + j) % capacity'],
  ['python', 'p = counts[i][j] / totals[i]'],
  ['python', 'ok = 0 <= x < width and 0 <= y < height'],
  ['python', 'result = value if value > threshold else fallback'],
  ['python', 'mean = sum(values) / len(values)'],
  ['python', 'norm = np.linalg.norm(a - b, ord=2)'],
  ['python', 'loss = -(y * np.log(p) + (1 - y) * np.log(1 - p))'],
  ['python', 'theta -= alpha * grad / (1 - beta1 ** t)'],
  ['python', 'f(*args, **kwargs)'],
  ['python', 'n = data[1:5]'],
  ['python', 'x = arr[::2]'],
  ['python', 'flag = not (a and b)'],
  ['python', 'text = "a * b" + str(c)'],
  ['python', 'længde = np.sqrt(bredde**2 + højde**2)'],
  ['python', 'x = 0xDEADBEEF & 0b1010 | 0o777'],
  ['python', 'x = 1_000_000 * 2.5e-8'],
  ['python', 'x = a\t*\tb'],
  ['python', 'x = ((((1))))'],
  ['python', 'dydx = sp.diff(y, x)'],
  ['python', 'area = sp.integrate(f, (x, 0, 1))'],
  ['python', 'eq = sp.Eq(F, m * a)'],
  ['javascript', 'const mid = lo + ((hi - lo) >> 1);'],
  ['javascript', 'const area = Math.PI * r ** 2;'],
  ['javascript', 'let ok = (a & mask) !== 0 && b > 0;'],
  ['typescript', 'const v: number = a / b;'],
  ['cpp', 'double e = 0.5 * m * v * v;'],
  ['cpp', 'float d = std::sqrt(dx*dx + dy*dy);'],
  ['cpp', 'int i = arr[n - 1] << 2;'],
  ['c', 'y = (a + b) / 2.0f;'],
  ['matlab', 'y = (a.^2 + b.^2).^0.5;'],
  ['matlab', "z = A' * B;"],
  ['julia', 'y = sqrt(a^2 + b^2)'],
  ['r', 'y <- mean(x) / sd(x)']
];

// Known gaps, kept explicit rather than silently failing.
const REFUSES = [
  ['python', 'total = sum(x**2 for x in values)'],   // comprehensions
  ['python', 'coords = [x * 2 for x in points]'],
  ['python', 'g = lambda x: x**2 + 1'],              // lambda
  ['python', 'label = f"value is {x:.2f}"'],         // f-strings
  ['python', 'd = {"a": 1, "b": 2}'],                // dict literals
  ['python', 'def area(r: float) -> float:'],        // signatures
  ['python', 'a, b = b, a + b'],                     // tuple assignment
  ['python', 'if (n := len(values)) > 10:'],         // walrus inside parens
  ['javascript', 'const f = (x) => x * 2;'],         // arrow functions
  ['java', 'double avg = (double) sum / count;'],    // C-style casts
  ['rust', 'let x = (a as f64) / (b as f64);'],      // `as` casts
  ['python', 'x = '],                                // genuinely incomplete
  ['python', 'x = 1 +'],
  ['python', 'x = )bad(']
];

// Neither drawn nor an error: there is simply nothing there.
const EMPTY = [
  ['python', ''],
  ['python', '   '],
  ['python', '# just a comment']
];

let pass = 0;
let fail = 0;
function report(name, detail) {
  fail++;
  console.log('FAIL  ' + name);
  if (detail) console.log('      ' + detail);
}

function run(lang, src) {
  const at = Math.min(2, src.length);
  const started = Date.now();
  const out = analyze(src + '\n', { start: at, end: at }, lang, CFG);
  return { out: out, ms: Date.now() - started };
}

RENDERS.forEach(function (pair) {
  const label = '[' + pair[0] + '] ' + pair[1];
  let r;
  try {
    r = run(pair[0], pair[1]);
  } catch (err) {
    report('threw: ' + label, err.message);
    return;
  }
  const st = r.out.statements[0];
  if (!st) { report('nothing rendered: ' + label); return; }
  if (st.error) { report('should render: ' + label, st.error.message); return; }
  if (!st.html) { report('empty html: ' + label); return; }
  if (/undefined|NaN|\[object/.test(st.html)) { report('broken html: ' + label, st.html.slice(0, 120)); return; }
  if (!/data-s="\d+" data-e="\d+"/.test(st.html)) { report('no source offsets: ' + label); return; }
  if (r.ms > 250) { report('too slow (' + r.ms + 'ms): ' + label); return; }
  pass++;
});

REFUSES.forEach(function (pair) {
  const label = '[' + pair[0] + '] ' + pair[1];
  let r;
  try {
    r = run(pair[0], pair[1]);
  } catch (err) {
    report('threw instead of reporting: ' + label, err.message);
    return;
  }
  const st = r.out.statements[0];
  if (!st) { pass++; return; }          // nothing extracted is also acceptable
  if (!st.error) {
    report('now renders -- move it to RENDERS: ' + label);
    return;
  }
  if (!st.error.message || typeof st.error.docPos !== 'number') {
    report('error lacks a message or position: ' + label);
    return;
  }
  pass++;
});

EMPTY.forEach(function (pair) {
  let r;
  try {
    r = run(pair[0], pair[1]);
  } catch (err) {
    report('threw on empty input: ' + JSON.stringify(pair[1]), err.message);
    return;
  }
  if (r.out.statements.length !== 0) {
    report('expected nothing for ' + JSON.stringify(pair[1]),
      JSON.stringify(r.out.statements[0].source));
    return;
  }
  pass++;
});

// Pathological shapes must degrade into an error, never a crash or a hang.
const HARSH = [
  ['deep nesting', 'y = ' + '('.repeat(5000) + 'a' + ')'.repeat(5000)],
  ['long sum', 'y = ' + Array.from({ length: 2000 }, function (_, i) { return 'x' + i; }).join(' + ')],
  ['long product', 'y = ' + Array.from({ length: 500 }, function (_, i) { return 'a' + i; }).join(' * ')],
  ['unterminated string', 'x = "abc'],
  ['stray operators', 'x = a + + + b']
];

HARSH.forEach(function (pair) {
  const started = Date.now();
  try {
    const out = analyze(pair[1] + '\n', { start: 2, end: 2 }, 'python', CFG);
    const st = out.statements[0];
    if (st && !st.error && !st.html) { report('no output at all: ' + pair[0]); return; }
    if (Date.now() - started > 2000) { report('took over 2s: ' + pair[0]); return; }
    pass++;
  } catch (err) {
    report('threw on ' + pair[0], err.message);
  }
});

// A large file must stay cheap, because this runs on every cursor move.
const big = Array.from({ length: 4000 }, function (_, i) {
  return 'value_' + i + ' = alpha_' + i + ' * beta / (gamma + ' + i + ')';
}).join('\n');
const t0 = Date.now();
const bigOut = analyze(big, { start: big.length - 20, end: big.length - 20 }, 'python', CFG);
const bigMs = Date.now() - t0;
if (!bigOut.statements.length || bigOut.statements[0].error) {
  report('4000-line file did not render', bigOut.statements[0] && bigOut.statements[0].error.message);
} else if (bigMs > 200) {
  report('4000-line file too slow', bigMs + 'ms');
} else {
  pass++;
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed  (' +
  RENDERS.length + ' render, ' + REFUSES.length + ' refuse, ' +
  EMPTY.length + ' empty, ' + HARSH.length + ' harsh, 1 large file)');
process.exit(fail ? 1 : 0);
