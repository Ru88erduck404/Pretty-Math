# Lines chosen to photograph well in the panel. Open this file, put the cursor
# on a line, and the panel below shows it as real mathematics.
#
# For the README, the two worth capturing are marked (1) and (2).

import math

import numpy as np
import sympy as sp

# (1) The quadratic formula: a stacked fraction under a stretched radical.
x = (-b + math.sqrt(b**2 - 4 * a * c)) / (2 * a)

# (2) The same line with and without brackets. Only `b` sits under the bar in
#     the first, which is the whole point of the panel.
y = a / b * c
y = a / (b * c)

# Adam's update rule: nested fraction, root, Greek names, subscripts.
w[i] = w[i] - eta * grad[i] / (math.sqrt(v[i]) + eps)

# The Lorentz factor: three levels of nesting.
gamma = 1 / math.sqrt(1 - v**2 / c**2)

# Cross entropy, with a sum drawn as a sigma over its binding.
loss = -sum(y[i] * np.log(p[i]) + (1 - y[i]) * np.log(1 - p[i]) for i in idx) / n

# Calculus: SymPy calls become the notation they stand for.
ode = sp.Eq(sp.diff(y, t, 2) + 2 * zeta * omega_0 * sp.diff(y, t), F / m)
area = sp.integrate(x**2 + 1, (x, 0, 1))
series = sp.Sum(1 / n**2, (n, 1, sp.oo))

# numpy.diff is a difference, not a derivative, and is drawn as one.
d = np.diff(samples)

# Precedence that is easy to misread is bracketed even where the language
# does not require it.
mask = a and b or c
shifted = a + b << c

# In Python this masks then compares. Copy the same line into a .c file and
# the panel draws it the other way round, because C means the other thing.
ok = flags & 0xFF == 0
