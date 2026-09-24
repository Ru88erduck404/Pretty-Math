# Screenshots

The Marketplace listing is the top-level `README.md`, rendered from whatever was
inside the `.vsix` when it was published, so the images at the top of it are the
first thing anyone sees.

Those images are hosted on GitHub's attachment CDN — the `user-attachments`
links in `README.md` — rather than committed here. Dragging a picture into a
GitHub issue or the web editor uploads it and gives you such a link. They are
public as long as the repository is, and they are served over HTTPS, which is
what the Marketplace requires.

If you would rather keep them in the repository, commit the files under `docs/`
and reference them relatively (`![alt](docs/panel.png)`); vsce rewrites relative
image links to raw.githubusercontent URLs when it packages, so both work.

## Taking new ones

`docs/screenshot.py` holds lines chosen to photograph well. Open it with the
extension installed, press **Alt+P**, drag the panel taller, and raise the font
with **A+** — about 26px reads well in a screenshot.

- **Windows** — Win+Shift+S, drag over the panel, paste into the GitHub editor.
- **macOS** — Cmd+Shift+4, drag over the panel, then drag the file in.

Capture the panel alone rather than the whole window, use a dark theme — the
panel's colours were chosen against a dark editor background — and keep it under
about 1500px wide. PNG, not JPEG: the text is thin and JPEG smears it.

Changing the images only changes the listing once a new version is published,
because the listing is the README as it was inside the published `.vsix`.
