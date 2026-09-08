(function () {
  'use strict';

  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  const content = document.getElementById('content');
  const where = document.getElementById('where');
  const pinButton = document.getElementById('pin');

  let fontSize = 20;
  let state = null;

  function post(msg) { if (vscode) vscode.postMessage(msg); }

  // ------------------------------------------------------------- sizing pass
  //
  // Parentheses, braces and radicals are drawn with ordinary glyphs, then
  // stretched to whatever the content next to them turned out to be. This has
  // to run after layout, innermost box first, so outer boxes see final heights.

  function stretch(el, targetHeight, minScale) {
    el.style.transform = '';
    const natural = el.getBoundingClientRect().height;
    if (!natural || !targetHeight) return;
    let k = targetHeight / natural;
    if (k < (minScale === undefined ? 1.02 : minScale)) return;
    k = Math.min(k, 12);
    const kx = Math.min(1 + (k - 1) * 0.18, 1.45);
    el.style.transform = 'scaleY(' + k.toFixed(3) + ') scaleX(' + kx.toFixed(3) + ')';
  }

  function fit(root) {
    const fenced = Array.prototype.slice.call(root.querySelectorAll('.pm-fenced-tall')).reverse();
    fenced.forEach(function (group) {
      const body = group.querySelector(':scope > .pm-body');
      if (!body) return;
      const h = body.getBoundingClientRect().height;
      group.querySelectorAll(':scope > .pm-fence').forEach(function (f) {
        stretch(f, h * 0.94);
      });
    });

    const roots = Array.prototype.slice.call(root.querySelectorAll('.pm-sqrt')).reverse();
    roots.forEach(function (sq) {
      const radicand = sq.querySelector(':scope > .pm-radicand');
      const radical = sq.querySelector(':scope > .pm-radical');
      if (!radicand || !radical) return;
      stretch(radical, radicand.getBoundingClientRect().height * 0.98, 1.05);
    });

    // Integral signs grow to the integrand, and the sign's box has to grow with
    // them so the limits still sit at its head and foot.
    const integrals = Array.prototype.slice.call(root.querySelectorAll('.pm-integral')).reverse();
    integrals.forEach(function (group) {
      const body = group.querySelector(':scope > .pm-int-body');
      if (!body) return;
      group.querySelectorAll(':scope > .pm-int').forEach(function (s) { s.style.height = ''; });
      const h = body.getBoundingClientRect().height;
      group.querySelectorAll(':scope > .pm-int').forEach(function (sign) {
        const glyph = sign.querySelector(':scope > .pm-int-glyph');
        if (!glyph) return;
        stretch(glyph, h * 0.95, 1.05);
        sign.style.height = Math.max(h, glyph.getBoundingClientRect().height) + 'px';
      });
    });

    const braces = Array.prototype.slice.call(root.querySelectorAll('.pm-cases')).reverse();
    braces.forEach(function (c) {
      const grid = c.querySelector(':scope > .pm-cases-grid');
      const brace = c.querySelector(':scope > .pm-brace');
      if (!grid || !brace) return;
      stretch(brace, grid.getBoundingClientRect().height * 0.95);
    });

    // An exponent on a tall base sits next to its top, not next to the baseline.
    root.querySelectorAll('.pm-power').forEach(function (p) {
      const base = p.querySelector(':scope > .pm-base');
      const sup = p.querySelector(':scope > .pm-sup');
      if (!base || !sup) return;
      const h = base.getBoundingClientRect().height;
      const line = parseFloat(getComputedStyle(p).fontSize) || fontSize;
      if (h > line * 1.7) sup.style.verticalAlign = (h * 0.34).toFixed(1) + 'px';
      else sup.style.verticalAlign = '';
    });
  }

  // -------------------------------------------------------------- interaction

  function nodeAt(el) {
    return el && el.closest ? el.closest('.pm-n') : null;
  }

  function bindRow(row) {
    row.addEventListener('mouseover', function (ev) {
      const n = nodeAt(ev.target);
      row.querySelectorAll('.pm-hot').forEach(function (e) { e.classList.remove('pm-hot'); });
      if (!n) { post({ type: 'hover', s: null, e: null }); return; }
      n.classList.add('pm-hot');
      post({ type: 'hover', s: Number(n.dataset.s), e: Number(n.dataset.e) });
    });

    row.addEventListener('mouseleave', function () {
      row.querySelectorAll('.pm-hot').forEach(function (e) { e.classList.remove('pm-hot'); });
      post({ type: 'hover', s: null, e: null });
    });

    row.addEventListener('click', function (ev) {
      const n = nodeAt(ev.target);
      if (!n) return;
      post({ type: 'reveal', s: Number(n.dataset.s), e: Number(n.dataset.e) });
    });
  }

  // The smallest sub-expression containing the cursor, outlined so you can see
  // where you are inside a long formula.
  function markCursor(root, cursor) {
    root.querySelectorAll('.pm-cursor').forEach(function (e) { e.classList.remove('pm-cursor'); });
    if (typeof cursor !== 'number') return;
    let best = null;
    let bestSize = Infinity;
    root.querySelectorAll('.pm-n').forEach(function (n) {
      const s = Number(n.dataset.s);
      const e = Number(n.dataset.e);
      if (cursor >= s && cursor <= e && (e - s) < bestSize) { best = n; bestSize = e - s; }
    });
    if (best) best.classList.add('pm-cursor');
  }

  // -------------------------------------------------------------- rendering

  function escapeText(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function statementRow(st, opts) {
    const row = document.createElement('div');
    row.className = 'row';

    if (st.error) {
      const box = document.createElement('div');
      box.className = 'error';
      const pad = new Array(Math.max(0, st.error.pos) + 1).join(' ');
      box.innerHTML = '<span class="msg">' + escapeText(st.error.message) + '</span>' +
        '<span class="snip">' + escapeText(st.source) + '\n' + pad + '^</span>';
      row.appendChild(box);
      return row;
    }

    const math = document.createElement('div');
    math.className = 'math';
    math.innerHTML = st.html;
    row.appendChild(math);

    const src = document.createElement('div');
    src.className = 'source';
    src.textContent = st.source;
    row.appendChild(src);

    if (opts.showLatex && st.latex) {
      const tex = document.createElement('div');
      tex.className = 'extra';
      tex.textContent = st.latex;
      row.appendChild(tex);
    }
    if (opts.showTree && st.tree) {
      const tree = document.createElement('div');
      tree.className = 'extra';
      tree.textContent = st.tree;
      row.appendChild(tree);
    }

    bindRow(row);
    return row;
  }

  function render(msg) {
    state = msg;
    fontSize = msg.fontSize || fontSize;
    document.documentElement.style.setProperty('--pm-size', fontSize + 'px');

    where.textContent = (msg.fileName || '') + (msg.language ? '  ·  ' + msg.language : '');
    pinButton.classList.toggle('on', !!msg.pinned);
    pinButton.textContent = msg.pinned ? 'Pinned' : 'Pin';
    const texButton = document.getElementById('showtex');
    if (texButton) texButton.classList.toggle('on', !!msg.showLatex);

    content.textContent = '';
    if (!msg.statements || !msg.statements.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nothing to draw here — put the cursor on a line with an expression.';
      content.appendChild(p);
      return;
    }

    msg.statements.forEach(function (st) {
      content.appendChild(statementRow(st, msg));
    });

    // The sizing pass needs finished layout. A frame callback is the natural
    // hook, but it never fires while the panel is hidden, so a timer backs it
    // up; running fit twice is harmless because it resets before measuring.
    const finish = function () {
      fit(content);
      markCursor(content, msg.cursor);
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 60);
  }

  window.addEventListener('message', function (ev) {
    const msg = ev.data;
    if (!msg) return;
    if (msg.type === 'render') render(msg);
    else if (msg.type === 'empty') {
      content.textContent = '';
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = msg.reason || '';
      content.appendChild(p);
    } else if (msg.type === 'pinned') {
      pinButton.classList.toggle('on', msg.pinned);
      pinButton.textContent = msg.pinned ? 'Pinned' : 'Pin';
    }
  });

  document.getElementById('pin').addEventListener('click', function () { post({ type: 'pin' }); });
  document.getElementById('tex').addEventListener('click', function () { post({ type: 'copyLatex' }); });
  const showTex = document.getElementById('showtex');
  if (showTex) {
    showTex.addEventListener('click', function () {
      const next = !(state && state.showLatex);
      post({ type: 'setConfig', key: 'showLatex', value: next });
    });
  }
  document.getElementById('bigger').addEventListener('click', function () {
    fontSize = Math.min(72, fontSize + 2);
    post({ type: 'setConfig', key: 'fontSize', value: fontSize });
    document.documentElement.style.setProperty('--pm-size', fontSize + 'px');
    fit(content);
  });
  document.getElementById('smaller').addEventListener('click', function () {
    fontSize = Math.max(8, fontSize - 2);
    post({ type: 'setConfig', key: 'fontSize', value: fontSize });
    document.documentElement.style.setProperty('--pm-size', fontSize + 'px');
    fit(content);
  });

  window.addEventListener('resize', function () { if (state) fit(content); });

  post({ type: 'refresh' });
}());
