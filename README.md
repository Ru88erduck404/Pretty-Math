# Pretty Math

A panel that draws the expression under your cursor the way you would write it
on paper — fractions stacked, exponents raised, roots under a radical — so the
structure of a long one-liner is visible at a glance.

```
w[i] = w[i] - eta * grad[i] / (math.sqrt(v[i]) + eps)
```

```
                η · grad_i
w_i  =  w_i  −  ──────────
                 √(v_i) + ε
```
The point is not decoration. `a / b * c` draws only `b` under the bar, so the
classic precedence slip is visible instead of inferred.
<img width="414" height="253" alt="image" src="https://github.com/user-attachments/assets/ca725d68-bf9a-4254-b3b0-961c2f3bc98d" />

More complex equations will be easier to overview.
<img width="810" height="337" alt="image" src="https://github.com/user-attachments/assets/87c14f14-9edd-4572-9802-89c422476418" />

## Using it

- Open the panel: **Alt+P** or **Ctrl+Alt+M** (`Cmd+Alt+M` on macOS), or *Pretty Math: Show
  Panel* from the command palette. It docks next to Terminal and Problems.
- Put the cursor anywhere on a line. The whole statement is picked up, including
  one that wraps over several lines, with comments and `return` / `if` / a C type
  declaration stripped off.
- Select several lines to draw them all at once.
- **Hover** a piece of the drawing to highlight where it came from in the editor;
  **click** it to select that range. The sub-expression your cursor sits in is
  outlined in the panel.
- **Values** swaps variable names for what they are worth; press it again to go
  back to the symbols. See *Plugging in the values* below.
- **Pin** freezes the panel on the current expression while you edit elsewhere.
- **Copy LaTeX** puts the same expression on the clipboard as LaTeX.

## What it understands

The parser follows the precedence of the language you are actually in, which is
where most of the value is:

| Written | Drawn as | Notes |
| --- | --- | --- |
| `a / b * c` | (a over b) · c | left to right, as the language runs it |
| `x ** 0.5`, `x ** (1/3)` | √x, ∛x | |
| `math.hypot(dx, dy)` | √(dx² + dy²) | the identity behind the call |
| `math.sin(t) ** 2` | sin² t | |
| `a ^ b` | a ⊕ b in C/Python/JS, aᵇ in MATLAB/Julia/R | `^` is XOR in most languages |
| `flags & 0xFF == 0` | (flags & 0xFF) = 0 in Python; flags & (0xFF = 0) in C | `&` binds tighter than `==` in Python, looser in C |
| `0 <= i < n` | a chain in Python; (0 ≤ i) < n in C and JS | only some languages chain comparisons |
| `n // 2` | ⌊n/2⌋ in Python; a comment elsewhere | |
| `a and b or c` | (a ∧ b) ∨ c | grouping drawn where precedence is easy to misread |
| `a + b << c` | (a + b) ≪ c | same |
| `x if x > 0 else -x` | a two-row piecewise | also `cond ? a : b` |
| `theta_max`, `x1`, `v_0` | θ_max, x₁, v₀ | Greek names and subscripts |
| `np.sqrt`, `self.mass` | √…, mass | configured qualifiers dropped |
| `a[i]`, `A[i][j]` | a_i, A_i,j | |
| `sum(x**2 for x in xs)` | Σ with x ∈ xs underneath | also `prod`, `max`, `min`, `all` (∀), `any` (∃) |
| `[x*2 for x in pts]` | [2x ∣ x ∈ pts] | set-builder form |
| `lambda x: x**2`, `(x) => x*2` | x ↦ x² | |
| `(double) sum / count`, `a as f64` | the cast kept as a quiet annotation | |

Tested against Python, JavaScript/TypeScript, C/C++/C#, Java, Rust, Go, MATLAB,
Octave, Julia and R conventions. Anything it cannot parse is reported with a
caret under the offending character rather than silently dropped.

### Calculus

SymPy's symbolic calls are drawn as the notation they stand for, and so are the
numerical equivalents in NumPy and SciPy:

| Written | Drawn as |
| --- | --- |
| `sp.diff(y, x)` | dy/dx as a stacked fraction |
| `diff(x**2 + 1, x)` | d/dx (x² + 1) — operator form, operand bracketed |
| `diff(f, x, 2)`, `diff(f, (x, 2))` | d²f/dx² |
| `diff(f, x, y)` | ∂²f/∂x∂y — switches to ∂ for several variables |
| `expr.diff(t)` | d(expr)/dt — the method form works too |
| `sp.integrate(f, x)` | ∫ f dx |
| `integrate(x**2, (x, 0, 1))` | ∫ from 0 to 1, limits at the head and foot of the sign |
| `integrate(f, x, y)` | ∫∫ f dx dy |
| `np.trapz(y, x)`, `simpson(y, x)` | ∫ y dx |
| `quad(f, 0, 1)` | ∫ from 0 to 1 of f |
| `sp.Sum(1/n**2, (n, 1, sp.oo))` | Σ with n = 1 below and ∞ above |
| `sp.Product(k, (k, 1, n))` | ∏ with the same limits |
| `sp.limit(f, x, 0)`, `limit(f, x, 0, "+")` | lim with x → 0 underneath, one-sided as 0⁺ |
| `sp.Eq(F, m*a)` | F = m a — also `Ne`, `Lt`, `Le`, `Gt`, `Ge` |
| `sp.Rational(1, 3)` | ⅓ as a fraction |
| `np.diff(a)`, `np.diff(a, n=2)` | Δa, Δ²a |

That last row is the reason the qualifier matters: `numpy.diff` is a discrete
difference, not a derivative, so drawing it as d/dx would invent a meaning that
isn't there. `sympy.diff` and an unqualified `diff` are read as derivatives;
anything from a NumPy-family namespace is read as a difference. `Derivative`,
`Integral`, `Sum`, `Product` and `Limit` — the unevaluated classes — render the
same as their lowercase functions.

## Plugging in the values

The **Values** button in the panel toolbar swaps variable names for what they
are worth, so `0.5 * m * v**2` reads as `0.5 · 3 · 12²`. Press it again to go
back to the symbols. It is off until you turn it on, and the state is the
`prettyMath.substituteValues` setting, so it persists; *Pretty Math: Toggle
Variable Values* does the same from the command palette.

The numbers come from one of three places, and the button says which:

- **Values · live** — a debug session is paused, and each name was evaluated in
  the frame you are stopped in. These are the real values, and they are drawn
  with a dotted underline. Stepping redraws them.
- **Values · kernel** — in a notebook, the running kernel was asked what each
  name holds, the way the Variables view does. This is what makes a line like
  `a0 = cn.value("Bohr radius")` show a number: no amount of reading the file
  can work out a library lookup, but the kernel already knows the answer.
- **Values · file** — no debugger and no kernel, so assignments above the cursor
  were read instead. **Nothing is executed**: each right-hand side is parsed and
  folded by a closed evaluator that knows arithmetic and the usual maths
  functions and nothing else. `n = 60 * 60` gives 3600; `n = fetch()` gives
  nothing.

Constants a module owns are known too, looked up through whatever the file
called the module. After `from scipy import constants as cn`, `cn.bar` is 10⁵
and `cn.R` is the gas constant, both where they are assigned and where they are
used. That matters more than it sounds: an unknown anywhere in a chain makes
everything downstream unknown, so one `P = 1.013*cn.bar` was once enough to
leave every value after it blank.

Only a variable of your own can override a constant: if the file assigns to that
name, the file wins. And only the qualified spelling is recorded, so your own
`R = 5` is never mistaken for the gas constant.

### Which qualifiers get dropped

`np.sqrt(x)` reads better as √x, so the qualifier goes. That is only ever right
for a module whose calls are maths — `math`, `cmath`, `numpy`, `scipy`, `sympy`,
`torch`, `jax`, `cupy`, `mpmath`, `statistics` and their submodules, plus
whatever `prettyMath.stripNamespaces` lists. Everything else keeps its name:
`os.path.getsize(f)` stays `os.path.getsize(f)`, and `pd.read_csv(path)` stays
`pd.read_csv(path)`, because drawing those without the qualifier would
misrepresent where the call came from.

### In notebooks

A notebook cell is its own document, so the variables a formula refers to were
almost always defined in *earlier* cells. Those are read too — the cells above
the current one, in order — which is what makes values work at all in a
notebook.

The kernel can be asked too, but that is **off by default** — set
`prettyMath.jupyterValues` to turn it on. The reason is the permission it needs:
the Jupyter extension will ask you to allow this extension to *execute code
against kernels*, which is arbitrary Python in your session. That is a broad
permission for a narrow use, and nobody should grant it without choosing to.

What actually gets sent is one statement:

```python
print(__import__("json").dumps({k: float(v) for k, v in ((n, globals().get(n)) for n in [...])
      if isinstance(v, __import__("numbers").Real) and not isinstance(v, bool)
      and __import__("math").isfinite(float(v))}))
```

It reads `globals()`, keeps the names holding a finite real number, and prints
them as JSON. It assigns nothing and leaves nothing behind — the comprehension's
variables are scoped to it. A value is never serialised unless it has already
been shown to be a plain number, so a notebook holding gigabyte arrays is
untouched: the array fails a pointer-cheap `isinstance` and its name stays a
name.

It only runs while **Values** is on, only when the kernel is already **idle**,
at most once every ¾ second, and answers are reused for a couple of seconds, so
moving around a notebook does not become a stream of kernel executions. The cost
if something goes wrong — a restarting kernel, a shadowed `print` — is that
values silently come from the cells above instead.

Read values are a static guess: the last assignment before the cursor wins,
whether or not the code would have taken that branch. Live values have no such
problem, which is why they win when both exist.

A name defined in terms of itself — `velocity = velocity - g * dt`, or
`total += x` — gets no value at all. Those change on every pass, so folding one
iteration would produce a number that is precise and false. Under the debugger
they show their real current value, which is the whole point of stepping.

Some things are deliberately never substituted:

- the name being assigned, so `E = 0.5*m*v**2` keeps its `E`;
- names the expression binds itself — a comprehension's loop variable, a
  lambda's parameter — since those shadow anything of the same name in the file;
- the variable of a derivative or an integral, which is a symbol, not a value;
- anything that is not a number. An array or an object would wreck the layout
  and tell you nothing at a glance, so the name stays.

Substituted numbers are drawn in green, so they never read as literals that were
written in the source — those stay blue. Hovering one shows the name it replaced.

**Copy LaTeX always copies the formula, with the names**, whether or not values
are showing. Values are for checking magnitudes on the spot; the algebra is what
you want in a document.

## Typing maths

Two things, both off until you ask for them.

### Names become symbols as you type

**Alt+Shift+M** turns math input on. After that, a backslash name becomes the
symbol it stands for:

```
\alpha   → α        \int    → ∫        \le   → ≤
\omega   → ω        \sum    → ∑        \ne   → ≠
\partial → ∂        \sqrt   → √        \to   → →
\infty   → ∞        \nabla  → ∇        \in   → ∈
\R       → ℝ        \pm     → ±        \cdot → ·
```

The name is replaced once you type something that cannot be part of it, which
is what keeps both `\le` and `\leq` reachable — expanding the moment a name
was complete would swallow the shorter one. A space used only to end a name is
swallowed with it; any other character was meant, and stays. A half-typed name
is left alone, and so is anything without a leading backslash, which is what
makes this safe to leave switched on: no word in prose or in code begins with
a backslash.

Completions appear as you type too, so the list does not have to be memorised.

Greek letters are valid identifiers in Python, so `σ = 0.5` is real code — but
a symbol typed into a `.py` file is a change to that file, so this stays off
by default.

### A line becomes typeset maths

**Alt+M** formats the selection, or the line the cursor is on. It reads the
calculator-style syntax below, and writes whichever form the file can actually
show:

| you type | in a `.py` file | in a markdown cell |
| --- | --- | --- |
| `x^2 + y^2` | `x² + y²` | `$x^{2} + y^{2}$` |
| `sqrt(alpha^2 + beta^2)` | `√(α² + β²)` | `$\sqrt{\alpha^{2} + \beta^{2}}$` |
| `int(x^2, x = 0 .. 1)` | `∫₀¹ x² dx` | `$\int_{0}^{1} x^{2}\,\mathrm{d}x$` |
| `sum(1/i^2, i = 1 .. n)` | `∑ᵢ₌₁ⁿ 1/i²` | `$\sum_{i=1}^{n} \frac{1}{i^{2}}$` |
| `diff(y, x, 2)` | `d²y/dx²` | `$\frac{\mathrm{d}^{2}y}{\mathrm{d}x^{2}}$` |
| `limit(sin(x)/x, x = 0)` | `lim(x→0) sin(x)/x` | `$\lim_{x \to 0} \frac{\sin(x)}{x}$` |
| `v_0*t + g*t^2/2` | `v₀·t + g·t²/2` | `$v_{0} \cdot t + \frac{g t^{2}}{2}$` |

**In a notebook's markdown cell it writes LaTeX between dollar signs**, which
is what that cell renders as real two-dimensional maths. A formula alone on its
line is fenced with `$$` and displayed; one inside a sentence gets single
dollars and stays inline. Everywhere else — a `.py` file, a comment, a plain
text file — it writes Unicode, because a backslash in those is only ever read
as a backslash.

The call forms it understands are `int(f, x = a .. b)`, `int(f, x)`,
`sum`/`product` over a range, `diff(y, x, n)`, `limit(f, x = a)`, `sqrt`,
`abs`, `exp`, `Pi` and `infinity` — a range written `x = a .. b`, as a
computer-algebra system writes it. Everything else is ordinary expression
syntax and needs no translation.

A raised form is all or nothing: Unicode has no superscript `q` and no
subscript `b`, so `x^q` stays as `x^(q)` rather than becoming half-raised,
which reads as a typo. And **text that is not a formula is never touched** —
prose, a bullet, a table row and a half-written expression all come back
exactly as they were, with a note in the status bar.

## Checking the formula

The drawing shows you how an expression is put together. The **Checks** button
goes further and says when it is wrong. It reports two kinds of thing, and
nothing else: units that cannot be combined, and mistakes that are certain.

A quiet panel means nothing was found — the button reads `Checks · ok` so that
this is distinguishable from the checks being switched off.

### Units

Adding a pressure to a temperature is invisible in the code and invisible in the
drawing. It is not invisible to this:

```python
from scipy import constants as cn
T = 300           # K
P = 1.013 * cn.bar
Q = 0.05          # m3/s
A = 1.2           # m2
rho = 998         # kg/m3

v = Q / A + rho   # adds m/s and kg/m³, which are different kinds of quantity
G = P * V / (cn.R * T)   # nothing to report
```

Units come from two places, and **nothing is guessed**:

- **`scipy.constants`.** Every one of its 122 names is on the record, through
  whatever the file called the module. `cn.bar` is a pressure, `cn.R` is
  J/(mol·K), `cn.kilo` is the number 1000 and carries no units at all.
- **A unit written in a comment.** `T = 300  # K` says what the 300 is, and so
  do `# m3/s`, `# kg/m3` and `# Pa*s`. Prefixes are understood (`mm`, `µm`,
  `kWh`), as are powers written as `m3`, `m^3` or `m**3`. For anything with a
  space in it, use brackets: `# [J/(mol K)]`.

  Tonnes are `t`, `ton`, `tonne` or `tonnes`, and a throughput can be per hour,
  day, week or year rather than per second: `# t/day`, `# m3/h`, `# kWh/year`,
  `# [t/(m2 h)]` all read correctly. Note that a **metric tonne and a short ton
  differ in size, not in kind**, so this cannot tell them apart — for the size
  too, write `12.5 * cn.metric_ton` and drop the comment, since the units then
  follow from the constant.

### Chemistry

The vocabulary covers what a reaction or a separation is written in:

```python
C_A  = 150      # mol/m3      (or # M, # mM — a molarity is a concentration)
MW   = 0.046    # g/mol
Ea   = 52.3e3   # J/mol
k2   = 0.004    # m3/(mol s)
kG   = 3.0e-6   # mol/(m2 s Pa)
mu   = 1.0e-3   # Pa s        (or # cP)
D_ab = 1.8e-9   # m2/s
a    = 120      # m2/m3
x    = 2.0      # wt%
```

Compound units may be written with spaces, as above. Prose is still prose: a
comment with a word that is not a unit in it — `# mass flow rate`, `# value in
mol` — declares nothing.

These all check out silently, which is the point:

```python
Re = rho * u * dia / mu                 # Reynolds
Sc = mu / (rho * D_ab)                  # Schmidt
Sh = kL * dia / D_ab                    # Sherwood
k  = A * math.exp(-Ea / (cn.R * T))     # Arrhenius
N_A = kG * p_A * a * Z                  # flux over a packed height
nd = mdot / MW                          # molar flow from a mass flow
```

and these do not:

```python
math.exp(-Ea / T)        # exp needs a plain number, but this is in J/(mol·K)
kG * p_A + C_A           # adds mol/(m²·s) and mol/m³
mdot + n                 # adds kg/s and mol
```

Two things it will not do:

- **°C and °F are left alone.** They are offset scales as well as scales, so
  `T_c + 10` means something and `T_c * 2` does not. `# C` and `# F` therefore
  declare nothing at all rather than being read as coulomb and farad, which in
  a comment on a number they almost never are. Spell out `coulomb` and `farad`
  for the electrical ones, and use kelvin for temperature.
- **It checks kind, not size.** `Ea = 52.3  # kJ/mol` used in `exp(-Ea/(R*T))`
  is wrong by a factor of a thousand and dimensionally perfect, so nothing is
  reported. Switch on **Values** for that: the drawing shows the number, and a
  Boltzmann factor of e^-0.019 is obvious on sight.

A name whose units cannot be traced to one of those is left alone. `T = 300` on
its own says nothing — the number could be kelvin, seconds or a count — so
nothing is claimed about it and nothing is reported. This is deliberate: a check
that guesses is worse than no check.

What gets reported: adding or subtracting different quantities, comparing them,
handing a quantity to `exp`, `log` or `sin`, an exponent with units, and
arguments to `hypot` or `min` that disagree. Roots halve the units, so
`sqrt(area)` is a length and the result is usable further down.

What deliberately does not: `P + 101325`, where a bare number stands in for a
pressure. That idiom is far too common to be worth a remark.

°C and °F are not supported, because they are offsets as well as scales — `T_c +
10` means something while `T_c * 2` does not, and nothing good comes of
pretending otherwise. Use kelvin.

### Mistakes that are certain

Every rule here fires only where the code is wrong, or where it means something
other than what it reads as. There is no rule for "this looks odd" — the drawing
is already the tool for judgement calls.

| | |
| --- | --- |
| degrees into a function wanting radians | `math.sin(theta_deg)`, and `theta_deg = atan(...)` |
| equality between floating-point numbers | `(a - b) == 1.5` |
| a minus sign outside a power | `-2**2` is −4 |
| integer division that truncates | `1 / 2` in C, C++, Java, Go, Rust |
| a comparison chain where there is none | `0 < i < n` outside Python and Julia |
| a mask compared before it is applied | `flags & 0xFF == 0` in C |

The last three are language-specific, and the panel reads each language by its
own rules: `0 < i < n` is a chain in Python and a bug in C++, so it is reported
in one and not the other.

Clicking a remark selects the part of the line it is about.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `prettyMath.autoUpdate` | `true` | follow the cursor |
| `prettyMath.fontSize` | `20` | also the A- / A+ buttons |
| `prettyMath.caretMeansPower` | `auto` | `auto` reads `^` per language |
| `prettyMath.multiplication` | `implicit` | or `dot`, `cross` |
| `prettyMath.indexAsSubscript` | `true` | `a[i]` as a subscript |
| `prettyMath.greekLetters` | `true` | `theta` as θ |
| `prettyMath.expandIdentities` | `true` | `exp`, `hypot`, `log1p`, `expm1` |
| `prettyMath.derivativeSymbol` | `auto` | `auto`, `d`, or `partial` |
| `prettyMath.stripNamespaces` | `Math, math, np, sp, sympy, self, …` | qualifiers to drop |
| `prettyMath.substituteValues` | `false` | the Values button; draw what variables are worth |
| `prettyMath.valueDigits` | `6` | significant digits for a substituted value |
| `prettyMath.mathInput` | `false` | Alt+Shift+M; backslash names become symbols as you type |
| `prettyMath.mathInputTarget` | `auto` | what Alt+M writes: LaTeX in markdown, Unicode elsewhere |
| `prettyMath.showChecks` | `true` | the Checks button; report what is wrong as well as drawing it |
| `prettyMath.checkUnits` | `true` | dimensional analysis, from scipy.constants and unit comments |
| `prettyMath.lintFormulas` | `true` | the short list of certain mistakes |
| `prettyMath.showLatex` | `false` | LaTeX under the drawing |
| `prettyMath.showTree` | `false` | parse tree under the drawing |
| `prettyMath.maxLines` | `40` | statements drawn from one selection |

## Installing

There is no build step — it is plain JavaScript with no dependencies, so the
folder is the extension.

Copy it into your editor's extensions directory and restart:

| Editor | Directory |
| --- | --- |
| VS Code | `~/.vscode/extensions/pretty-math` (`%USERPROFILE%\.vscode\extensions\pretty-math`) |
| VSCodium | `~/.vscode-oss/extensions/pretty-math` (`%USERPROFILE%\.vscode-oss\extensions\pretty-math`) |

To hack on it instead, open this folder in VS Code and press **F5** — that starts
an Extension Development Host with the extension loaded.

To build a `.vsix` (needs Node on PATH):

```bash
npx @vscode/vsce package
```

## Releasing

Pushing to `main` runs the tests on Linux, macOS and Windows. It does **not**
release anything — an ordinary push never reaches anyone's editor.

A release happens when a version tag is pushed:

```bash
npm version patch      # or minor / major; edit package.json by hand if npm is absent
git push origin main --follow-tags
```

The tag has to match the `version` field or the workflow stops. It then builds
the `.vsix`, attaches it to a GitHub release, and publishes to whichever
marketplaces have a token set as a repository secret:

| Secret | Marketplace | Where it comes from |
| --- | --- | --- |
| `VSCE_PAT` | Visual Studio Marketplace | Azure DevOps personal access token, scope *Marketplace → Manage*, for the `ru88erduck404` publisher |
| `OVSX_PAT` | Open VSX, which VSCodium uses | A token from open-vsx.org |

Neither is required. With no secrets set the workflow still tests, builds, and
attaches the `.vsix` to the GitHub release for hand installation.

`extensionKind: ["ui", "workspace"]` lets the extension run in the local
extension host of a Remote-SSH, WSL or dev-container window, since it only reads
the editor API and never the filesystem — so one install covers every remote.

## Development

```bash
node test/run.js     # parser, renderer and LaTeX output
node test/host.js    # extension host against a stubbed VS Code API
node test/corpus.js  # real source lines: no crashes, no hangs, offsets intact
node test/libraries.js # every library claim the README makes
node test/hostile.js   # prototype-shaped names, malformed replies, injection attempts
node test/fuzz.js      # generated and corrupted expressions; PRETTY_MATH_SEED to vary
node test/demo.js    # writes test/demo.html to eyeball the layout in a browser
```

- `src/lexer.js`, `src/parser.js` — tokenizer and Pratt parser, per-language flavors
- `src/prep.js` — finds the statement around the cursor, keeps source offsets
- `src/render.js` — the AST as HTML boxes, each tagged with its source range
- `src/latex.js` — the same AST as LaTeX
- `media/panel.js` — stretches fences and radicals to their content after layout

## Licence

MIT — see [LICENSE](LICENSE). Copyright © 2026 Malthe Møller Kristensen
([@Ru88erduck404](https://github.com/Ru88erduck404)). No third-party code is
included; the extension has no dependencies.
