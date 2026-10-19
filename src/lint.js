'use strict';

// A short list of formula mistakes that are certain rather than suspected.
//
// Every rule here fires only where the code is wrong, or means something other
// than what it plainly reads as. There is deliberately no rule for "this looks
// odd": a panel that cries wolf is one nobody reads, and the drawing itself is
// already the tool for judgement calls.

const { dottedName, COMPARISON } = require('./parser');

const TRIG = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'sinh', 'cosh', 'tanh'
]);
const INVERSE_TRIG = new Set([
  'asin', 'acos', 'atan', 'atan2', 'arcsin', 'arccos', 'arctan'
]);

// A name that says out loud it is in degrees.
const DEGREES = /(^|[_.])(deg|degs|degree|degrees)$/i;
const RADIANS = /(^|[_.])(rad|rads|radian|radians)$/i;

// Languages where `/` between two integers throws the remainder away. Python 3,
// JavaScript, MATLAB, Julia and R all return a real number instead.
const TRUNCATES = new Set([
  'c', 'cpp', 'csharp', 'java', 'objective-c', 'objective-cpp', 'cuda-cpp',
  'go', 'rust', 'kotlin', 'scala'
]);

const BITWISE = new Set(['&', '|', 'xor']);

function nameOf(node) {
  if (!node) return null;
  const dotted = dottedName(node);
  return dotted === null ? null : dotted.split('.').pop();
}

// The text a name was written with, for a message that quotes the user's own
// spelling rather than a normalised one.
function spelling(node) {
  const dotted = dottedName(node);
  return dotted === null ? null : dotted;
}

function isIntegerLiteral(node) {
  return !!node && node.type === 'Num' && /^[0-9]+$/.test(String(node.v).replace(/_/g, ''));
}

function isFloatLiteral(node) {
  if (!node || node.type !== 'Num') return false;
  const text = String(node.v).replace(/_/g, '');
  if (/^0[xXbBoO]/.test(text)) return false;
  return /[.eE]/.test(text) && !/^\d+[eE]\+?\d+$/.test(text);
}

// Walks every node, letting a rule look at each one in turn.
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  Object.keys(node).forEach(function (key) {
    if (key === 'type' || key === 's' || key === 'e') return;
    const child = node[key];
    if (Array.isArray(child)) child.forEach(function (c) { walk(c, visit); });
    else if (child && typeof child === 'object') walk(child, visit);
  });
}

function lint(ast, flavor, options) {
  const out = [];
  const opts = options || {};
  const lang = (flavor && flavor.id) || 'plaintext';

  const add = function (rule, node, message) {
    out.push({
      rule: rule,
      message: message,
      s: node && typeof node.s === 'number' ? node.s : 0,
      e: node && typeof node.e === 'number' ? node.e : 0
    });
  };

  walk(ast, function (node) {
    // ---- a trig function given degrees ------------------------------------
    // sin wants radians in every language here. A name that says degrees is
    // the one case where the intent is written down plainly enough to act on.
    if (node.type === 'Call') {
      const fn = nameOf(node.callee);
      const arg = node.args && node.args[0];
      if (fn && TRIG.has(fn) && arg) {
        const written = spelling(arg);
        if (written && DEGREES.test(written)) {
          add('degrees', arg, fn + ' works in radians, and ' + written +
            ' is in degrees. Convert it first, with radians(' + written + ').');
        }
      }
      // ... and the mirror image: an inverse trig result stored as degrees.
      if (fn && INVERSE_TRIG.has(fn) && opts.assignedTo && DEGREES.test(opts.assignedTo)) {
        add('degrees', node, fn + ' returns radians, but the result is being kept as ' +
          opts.assignedTo + '. Wrap it in degrees(...).');
      }
      if (fn && TRIG.has(fn) && arg) {
        const written = spelling(arg);
        if (written && RADIANS.test(written)) return; // explicitly fine
      }
    }

    // ---- equality between floating-point numbers --------------------------
    if (node.type === 'Binary' && (node.op === '==' || node.op === '!=' ||
        node.op === '===' || node.op === '!==')) {
      if (isFloatLiteral(node.l) || isFloatLiteral(node.r)) {
        add('float-equality', node,
          'Floating-point arithmetic rarely lands on an exact value, so this ' +
          'comparison can be false when the numbers are to all intents equal. ' +
          'Compare the difference against a tolerance instead.');
      }
    }

    // ---- a minus sign outside a power -------------------------------------
    // -x**2 is -(x**2) in Python, C, and everywhere else that has both. With a
    // variable base both readings are ordinary and the drawing already shows
    // which one you wrote, so only the literal case is worth a remark: -2**2
    // is -4, and nobody writes it meaning that.
    if (node.type === 'Unary' && node.op === '-' && node.arg &&
        node.arg.type === 'Binary' && (node.arg.op === '**' || node.arg.op === '^') &&
        !node.arg.grouped && node.arg.l && node.arg.l.type === 'Num') {
      add('minus-power', node,
        'The minus applies to the whole power, not to the base, so this is ' +
        '−(' + node.arg.l.v + '^exponent) and comes out negative. Write ' +
        '(−' + node.arg.l.v + ')^exponent if that is what you meant.');
    }

    // ---- integer division that throws the remainder away ------------------
    if (node.type === 'Binary' && node.op === '/' && TRUNCATES.has(lang) &&
        isIntegerLiteral(node.l) && isIntegerLiteral(node.r)) {
      add('integer-division', node,
        'Both sides are whole numbers, so this division truncates: the ' +
        'remainder is thrown away before anything else happens. Make one of ' +
        'them a real number.');
    }

    // ---- a comparison chain in a language that has none -------------------
    if (node.type === 'Binary' && COMPARISON.has(node.op) && !flavor.chainsComparisons) {
      const inner = node.l;
      if (inner && inner.type === 'Binary' && COMPARISON.has(inner.op) && !inner.grouped) {
        add('comparison-chain', node,
          'This reads as a chain but is not one here: the first comparison ' +
          'produces true or false, and that is what the second compares. ' +
          'Join them with and/&&.');
      }
    }

    // ---- a mask compared before it is applied -----------------------------
    // In C and its descendants & is looser than ==, so `flags & MASK == 0`
    // compares the mask and then ands the result in. Python binds the other
    // way round and is fine.
    if (node.type === 'Binary' && BITWISE.has(node.op) && !flavor.bitwiseBindsTighter) {
      const side = [node.l, node.r].find(function (x) {
        return x && x.type === 'Binary' && COMPARISON.has(x.op) && !x.grouped;
      });
      if (side) {
        add('mask-precedence', node,
          'Here ' + node.op + ' binds looser than the comparison, so the ' +
          'comparison happens first and its true/false result is what gets ' +
          'combined. Put the mask in brackets.');
      }
    }
  });

  return out;
}

module.exports = { lint: lint };
