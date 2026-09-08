# Changelog

All notable changes to Pretty Math are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

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
