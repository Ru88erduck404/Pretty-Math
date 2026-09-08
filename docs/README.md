# Screenshots

The Marketplace listing is the top-level `README.md`, rendered from whatever was
inside the `.vsix` when it was published — so a screenshot there is the first
thing anyone sees, and it is what sells the extension in two seconds.

Two images are referenced from the main README and need capturing from a running
editor. They cannot be generated from this repository: they are pictures of the
panel inside VS Code, chrome and theme included.

## Taking them

1. Open `docs/screenshot.py` in VS Code with the extension installed.
2. Open the panel with **Ctrl+Alt+M** and drag its top edge up until the drawing
   has some room.
3. Use the **A+** button to raise the font a little; ~26px photographs well.
4. Put the cursor on the line marked `(1)` — the quadratic formula.
5. Capture the panel only, not the whole window:
   - **Windows** — Win+Shift+S, drag over the panel, then paste into Paint and
     save.
   - **macOS** — Cmd+Shift+4, drag over the panel; it saves to the Desktop.
6. Save as `docs/panel.png`.
7. Repeat with the cursor on the two lines marked `(2)`, capturing both drawings
   together so the difference is visible, and save as `docs/precedence.png`.

Keep them under about 1500px wide. PNG, not JPEG — the text is thin and JPEG
smears it.

## Then

Delete the HTML comment above the images in the main README, commit the two
files, and bump the version so the listing picks them up:

```bash
git add docs/*.png README.md
git commit -m "Add screenshots to the listing"
git tag v0.1.2
git push origin main --tags
```

A dark theme is the better choice for both: the panel's colours were picked
against a dark editor background.
