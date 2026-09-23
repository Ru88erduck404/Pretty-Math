"""A file for trying the Values button, in both of its modes.

Open the panel with Ctrl+Alt+M and press Values in its toolbar.

  1. With nothing running, the button reads "Values · file" and the numbers
     come from the assignments below -- read, never executed.
  2. Put a breakpoint on the marked line and press F5. Once it stops, the
     button reads "Values · live" and the numbers come from the running
     program. Step with F10 and watch them change.

Run it with F5; it prints a short table and exits.
"""

import math

# --- constants the file-reading mode can work out ---------------------------

mass = 3.0
speed = 12
gravity = 9.81
seconds_per_day = 60 * 60 * 24          # folded to 86400
half = 1 / 2                            # folded to 0.5
radius = math.sqrt(16)                  # folded to 4.0

# A value it cannot work out, on purpose: the name stays a name.
sample_count = len([1, 2, 3])

# Not a number, so it is left alone as well.
readings = [1.5, 2.5, 3.5]


def kinetic_energy(m, v):
    """Put the cursor on the return line: m and v are parameters, so the file
    mode knows nothing about them. Under the debugger they have real values."""
    return 0.5 * m * v**2


def simulate(steps):
    height = 100.0
    velocity = 0.0
    dt = 0.1

    for step in range(steps):
        # BREAKPOINT HERE. With the debugger paused, put the cursor on the next
        # line: height, velocity and dt are drawn as what they currently are,
        # and they change on every F10.
        velocity = velocity - gravity * dt
        height = height + velocity * dt
        if height <= 0:
            break

    return height, velocity


# --- lines worth putting the cursor on --------------------------------------

# Values from the constants above are plugged straight in.
energy = 0.5 * mass * speed**2

# The name on the left keeps its name; only the right-hand side is filled in.
momentum = mass * speed

# A fraction, so the value lands above and below the bar.
frequency = 1 / (2 * math.pi * math.sqrt(mass / gravity))

# The loop variable belongs to the comprehension, so it is never replaced by
# anything called `r` elsewhere; `readings` is a list, so it stays a name too.
total = sum(r**2 for r in readings)

# A derivative's variable is a symbol, not a value, so it is left alone even
# when the file assigns something to it.
# (needs sympy installed to run, but the panel draws it either way)
# ode = sp.diff(height, dt)

if __name__ == "__main__":
    print(f"{seconds_per_day = }")
    print(f"{energy = }")
    print(f"{momentum = }")
    print(f"{frequency = :.4f}")
    print(f"{total = }")
    print("kinetic_energy(2.0, 5.0) =", kinetic_energy(2.0, 5.0))
    print("simulate(30) =", simulate(30))
