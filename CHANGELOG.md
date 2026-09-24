# Changelog

All notable changes to Pretty Math are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [0.1.5] — 2026-09-24

### Added

- Notebook support for values. A cell is its own document, so the variables a
  formula refers to were defined in earlier cells; those are now read as well,
  which is what makes values work at all in a notebook.
- Values from a running Jupyter kernel, shown as **Values · kernel**. This is
  what lets `a0 = cn.value("Bohr radius")` show a number: no reading of the file
  can resolve a library lookup, but the kernel already knows. One short
  statement is sent, it defines nothing, and a busy kernel is left alone.
  Turn it off with `prettyMath.jupyterValues`.

### Fixed

- The panel no longer empties itself when no editor is focused. Clicking a
  toolbar button moves focus out of the editor, and with a notebook cell that
  can leave `activeTextEditor` undefined — so toggling Values replaced the
  drawing with the "open a file" hint, which looked like a crash. The editor the
  last drawing came from is used until another one takes over.
- Module aliases are picked up from earlier notebook cells too, so an `import`
  in the first cell applies in the tenth.

## [0.1.4] — 2026-09-23

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

## [0.1.3] — 2026-09-23

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
