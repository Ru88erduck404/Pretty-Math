# Changelog

All notable changes to Pretty Math are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Fixed

- A module's constants are drawn where they appear, not only where they feed an
  assignment. `cn.R * T` was drawn as `R · T` even with values on, which is the
  one place the number is wanted; it now reads `8.31446 · T`. Only the qualified
  spelling is recorded, so a variable of your own called `R` keeps its own
  value, and anything the file assigns to that name wins over the table.
- A plain import makes the module stand for itself, so `import numpy` knows
  `numpy.pi` exactly as `import numpy as np` knew `np.pi`.

## [0.1.3] — 2026-09-24

Everything since 0.1.2. The numbers in between were local builds that were never
released, so their notes are collected here.

### Added

- A **Values** button that draws what the variables are worth in place of their
  names, and turns it off again. Off by default; the state lives in
  `prettyMath.substituteValues`, and *Pretty Math: Toggle Variable Values* does
  the same from the command palette.
- Values come from a paused debug session when there is one — evaluated in the
  frame you are stopped in, redrawn as you step, and marked with a dotted
  underline — and otherwise from assignments above the cursor. Those are parsed
  and constant-folded by a closed evaluator; no code from the file is ever run.
- In a notebook, the cells above the current one are read as well, since a cell
  is its own document and that is where the variables were defined.
- Values from a running Jupyter kernel, shown as **Values · kernel**, which is
  what lets a name assigned from a library lookup show a number. **Off by
  default** (`prettyMath.jupyterValues`): it needs permission to execute code
  against kernels, a broad permission for a narrow use. What gets sent is one
  statement that prints the names currently holding a finite real number and
  defines nothing. A busy kernel is left alone, answers are reused for two
  seconds, and the kernel is disturbed at most once every ¾ second.
- Constants a module owns, looked up through whatever the file called it: after
  `from scipy import constants as cn`, `cn.bar` is 10⁵ and `cn.R` is the gas
  constant. An unknown anywhere in a chain of assignments makes everything after
  it unknown, so one such lookup was enough to leave a whole notebook blank.
- Comprehensions: `sum(x**2 for x in values)` is drawn as Σ with `x ∈ values`
  underneath, and the same for `prod`, `max`, `min`, `all` (∀) and `any` (∃). A
  bare comprehension is drawn in set-builder form.
- Lambdas and arrow functions as `x ↦ …`, and casts — C-style and Rust's `as` —
  with the type kept as a quiet annotation.
- **Alt+P** opens the panel, alongside Ctrl+Alt+M.
- Identifiers may use any Unicode letter, so `længde` works; C++ and Rust scope
  resolution (`std::sqrt`); `*args` and `**kwargs`.
- Names that are assigned, bound by a comprehension or a lambda, or that are the
  variable of a derivative or integral are left as names, since a value would be
  wrong there. So are non-numeric values, and names defined in terms of
  themselves — a loop update folded once would be precise and false.

### Fixed

- Bitwise operators are read per language. Python and Julia bind `&` tighter
  than `==`; C and its descendants bind it looser, so `flags & 0xFF == 0` means
  different things in each. Both were drawn the Python way. Comparisons chain
  only where the language chains them, so `0 <= i < n` is drawn as `(0 <= i) < n`
  in C and JavaScript.
- Hexadecimal, binary and octal literals were truncated: `0xFF` drew as `0xF`.
- `import`, `from`, `def` and `class` lines are ignored rather than reported as
  parse errors, and string contents are kept — `value("Bohr radius")` was drawn
  as `value("")`.
- Tuple assignment parses, so `x, y = sp.symbols("x y")` is drawn.
- `log(x)**2` drew the function as the literal word "undefined".
- A qualifier that was not configured away is kept on a call, so
  `pd.read_csv(path)` is no longer drawn as `read_csv(path)`.
- `valueDigits` is honoured in exponential form; it was capped at five
  significant digits.
- The panel no longer empties itself when no editor is focused, which made
  pressing a toolbar button in a notebook look like a crash.
- A substituted value counts as a number when spacing a product, so
  `0.5 * m * v**2` does not run its three numbers together.

### Internal

- Five test suites beyond the original two: a corpus of real source lines,
  every library claim the README makes, hostile input, and seeded fuzzing that
  draws half its cases with values plugged in. All six run in CI on Linux,
  macOS and Windows.

<!-- The notes below were never released; they are kept for the record. -->

## [0.1.7 — unreleased]

### Fixed

- `log(x)**2` drew the function as the literal word "undefined". `log` is
  described in the function table by its kind alone, with no printable name, so
  the powered form had nothing to print; the name it was called by is now the
  fallback, and a test walks every powerable name to be sure none of the others
  can do it.
- A qualifier that was not configured away is kept on a call:
  `pd.read_csv(path)` was drawn as `read_csv(path)`, silently losing which
  object it came from. Configured ones — `np`, `math`, `self` — are still
  dropped.
- `valueDigits` is honoured in exponential form. It was capped at five
  significant digits, so `1.380649e-23` printed as `1.3806e-23` whatever the
  setting said.
- The code sent to a kernel now refuses anything that is not a plain identifier
  itself, rather than relying on its caller to have filtered. Unicode names such
  as `længde` are allowed, as Python allows them.

### Added

- `test/libraries.js`, which asserts every library claim the README makes, so
  the documentation cannot drift away from the behaviour.
- `test/hostile.js`: prototype-shaped variable names, arithmetic with no
  sensible answer, malformed kernel and debugger replies, files built to be
  awkward, and attempts to get something other than a name into the kernel
  probe.
- The fuzzer now draws half its cases with values plugged in, which is what
  found the `log(x)**2` bug.

## [0.1.6 — unreleased]

### Added

- **Alt+P** opens the panel, alongside Ctrl+Alt+M.
- Constants a module owns are known to the value scanner, looked up through
  whatever the file called the module: after `from scipy import constants as cn`,
  `cn.bar` is 10⁵ and `cn.R` is the CODATA gas constant. This matters more than
  it sounds — an unknown anywhere in a chain of assignments makes everything
  downstream unknown, so a single `P = 1.013*cn.bar` was enough to leave `G`,
  `Gm` and `A` with no values at all.

## [0.1.5 — unreleased]

### Added

- Notebook support for values. A cell is its own document, so the variables a
  formula refers to were defined in earlier cells; those are now read as well,
  which is what makes values work at all in a notebook.
- Values from a running Jupyter kernel, shown as **Values · kernel**. This is
  what lets `a0 = cn.value("Bohr radius")` show a number: no reading of the file
  can resolve a library lookup, but the kernel already knows. One short
  statement is sent, it defines nothing, and a busy kernel is left alone.
  **Off by default** (`prettyMath.jupyterValues`): granting it means granting
  the extension permission to execute code against kernels, which is a broad
  permission for a narrow use, so it is opt-in.
- Kernel answers are reused for two seconds and the kernel is disturbed at most
  once every ¾ second, so moving the cursor around a notebook cannot turn into
  a stream of kernel executions.

### Fixed

- The panel no longer empties itself when no editor is focused. Clicking a
  toolbar button moves focus out of the editor, and with a notebook cell that
  can leave `activeTextEditor` undefined — so toggling Values replaced the
  drawing with the "open a file" hint, which looked like a crash. The editor the
  last drawing came from is used until another one takes over.
- Module aliases are picked up from earlier notebook cells too, so an `import`
  in the first cell applies in the tenth.

## [0.1.4 — unreleased]

### Fixed

- `import` and `from` lines, and other statements that are not expressions
  (`def`, `class`, `#include`, `export function`), are ignored instead of being
  reported as parse errors. There was never any maths on those lines.
- String contents are kept. `cn.value("Bohr radius")` was drawn as `value("")`,
  because the text inside quotes was blanked while comments were stripped.
- Tuple assignment parses, so `x, y = sp.symbols("x y")` is drawn rather than
  refused.

### Added

- Module aliases declared by the file become qualifiers, so after
  `from scipy import constants as cn` the term `cn.R` is drawn as `R`, the way
  `np.` and `math.` are dropped by default.
- Live value lookups are cached against the debug frame and time out after
  1.5 seconds, so a slow or stuck debug adapter is not re-queried on every
  cursor move, nor waited on indefinitely.

## [0.1.3 — unreleased, superseded above]

### Added

- A **Values** button that draws what the variables are worth in place of their
  names, and turns it off again. Off by default; the state lives in
  `prettyMath.substituteValues`, and *Pretty Math: Toggle Variable Values* does
  the same from the command palette.
- Values come from a paused debug session when there is one — evaluated in the
  frame you are stopped in, redrawn as you step, and marked with a dotted
  underline — and otherwise from assignments above the cursor. Those are parsed
  and constant-folded by a closed evaluator; no code from the file is ever run.
- Names that are being assigned, bound by a comprehension or a lambda, or that
  are the variable of a derivative or integral are left as names, since a value
  would be wrong or meaningless there. Non-numeric values are left alone too.
- A name defined in terms of itself — a loop update or a running total — gets no
  value from the file, because one folded iteration would be precise and false.
  The debugger still shows its real value.
- `docs/values.py`, a runnable file for trying both modes.

### Fixed

- A substituted value is treated as a number when spacing a product, so
  `0.5 * m * v**2` with m = 3 and v = 12 is drawn as `0.5 · 3 · 12²` rather than
  running the three numbers together.

## [0.1.2] — 2026-09-08

### Added

- Comprehensions. `sum(x**2 for x in values)` is drawn as a Σ with `x ∈ values`
  underneath, and the same for `prod`, `max`, `min`, `all` (∀) and `any` (∃).
  A bare comprehension is drawn in set-builder form, `[x² ∣ x ∈ points]`.
- Lambdas and arrow functions: `lambda x: x**2` and `(x) => x * 2` both become
  `x ↦ …`.
- Casts. `(double) sum / count` and Rust's `a as f64` parse, with the type kept
  as a quiet annotation rather than dropped — the cast is usually the point.
- Identifiers may use any Unicode letter, so `længde` or `Ströme` work.
- C++ and Rust scope resolution: `std::sqrt(x)` is drawn as a root.
- `*args` and `**kwargs` in call arguments.

### Fixed

- Over-deep nesting is reported in words instead of as a stack-overflow message.

## [0.1.1] — 2026-09-08

### Fixed

- Bitwise operators are now read per language. Python and Julia bind `&` tighter
  than `==`, so `flags & 0xFF == 0` masks then compares; C and its descendants
  bind it looser, making the same line `flags & (0xFF == 0)`. Both were
  previously drawn the Python way, which misrepresented C in exactly the case
  the panel exists to expose. In C, equality is also drawn as looser than the
  relational operators.
- Comparisons only chain where the language chains them. `0 <= i < n` stays a
  chain in Python and Julia but is drawn as `(0 <= i) < n` in C, JavaScript and
  the rest, because that is what those languages compute.
- A comparison beside a bitwise operator is always bracketed, in either
  direction, since that grouping is the one that differs between languages.
- Hexadecimal, binary and octal literals are no longer truncated: `0xFF` was
  drawn as `0xF`, because the C numeric-suffix stripper ate the final digit.
- Repository, issues and homepage links point at the real repository name, so
  the Marketplace listing resolves them correctly.

## [0.1.0] — 2026-09-08

First release.

### Added

- A panel view that draws the expression under the cursor as two-dimensional
  math: stacked fractions, raised exponents, stretched radicals and fences, and
  ternaries as a two-row piecewise brace.
- Statement detection around the cursor, joining lines that wrap and stripping
  comments, `return`, `if (...)`, and C-style type declarations.
- Per-language reading of operators, so `^` is bitwise XOR in C, Python and
  JavaScript but a power in MATLAB, Julia and R, and `//` is floor division only
  where the language says so.
- Grouping drawn wherever precedence is easy to misread — `a and b or c`,
  `a + b << c`, `a ^ b | c & d` — even though the language does not need the
  parentheses.
- Hover a sub-expression to highlight its source range, click to select it; the
  sub-expression containing the cursor is outlined.
- Calculus notation for SymPy and its numerical counterparts: `diff` as a
  derivative fraction or a `d/dx` operator, `∂` for mixed partials, `integrate`
  with limits on the sign, `Sum`/`Product` with limits above and below, `limit`,
  and `Eq`/`Ne`/`Lt`/`Le`/`Gt`/`Ge` as relations. `numpy.diff` is drawn as a
  discrete difference `Δa`, which is what it computes.
- Identity expansion for `hypot`, `log1p`, `expm1`, `exp` and fractional powers.
- Greek names, subscripts, index-as-subscript, and namespace stripping so
  `np.sqrt(x)` and `self.mass` read as plain math.
- Copy the current expression as LaTeX, pin the panel, and adjust the size.
- Parse failures reported with a caret under the offending character.
