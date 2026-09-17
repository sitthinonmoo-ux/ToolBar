// Hologram views for the Home tab: a wireframe model of this PC driven by live stats,
// a globe of saved servers, and the layered floating panels both open on click.
// Plain canvas 2D with a hand-rolled projection — three.js would be ~600KB for a few
// boxes and circles.
const Holo = (() => {
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const MONO = "'JetBrains Mono', Consolas, monospace";
  const SANS = "'IBM Plex Sans Thai', 'Segoe UI', sans-serif";

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function hexRgb(hex) {
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return Number.isNaN(n) ? [47, 227, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1).toFixed(3)})`;

  // Effects-saver mode: stages drop to ~15fps and skip purely decorative layers so the
  // Home tab doesn't compete with a running game for CPU/GPU time.
  let lite = false;
  const LITE_FRAME_MS = 66;
  // Canvas redraws are the app's main CPU cost, so stages idle at 30fps and only run at
  // full rate while the pointer is on them (dragging, hovering, picking).
  const IDLE_FRAME_MS = 1000 / 30;

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => hexRgb(cs.getPropertyValue(name) || fb);
    return {
      a1: v('--accent-1', '#3b82f6'),
      a2: v('--accent-2', '#2fe3ff'),
      warn: v('--warning', '#ffc247'),
      danger: v('--danger', '#ff5b60'),
      ok: v('--success', '#33f0b0'),
      text: v('--text-primary', '#e9f3ff'),
      sub: v('--text-secondary', '#8fa3c4'),
      dim: v('--text-dim', '#546384'),
    };
  }

  // Canvas sizing + a render loop that only runs while the canvas is actually on screen
  // and the window is visible, so the Home tab costs nothing once you leave it.
  function createStage(canvas, draw, { alwaysIdle = false } = {}) {
    const ctx = canvas.getContext('2d');
    const st = { w: 0, h: 0, dpr: 1, inView: false, active: false, pal: readPalette() };
    if (!alwaysIdle) {
      const host = canvas.parentElement;
      host.addEventListener('pointerenter', () => (st.active = true));
      host.addEventListener('pointerleave', () => (st.active = false));
    }
    let running = false;
    let last = 0;
    let lastSlot = -1;
    let palAt = 0;

    new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      st.dpr = window.devicePixelRatio || 1;
      st.w = canvas.clientWidth || r.width;
      st.h = canvas.clientHeight || r.height;
      canvas.width = Math.max(1, Math.round(st.w * st.dpr));
      canvas.height = Math.max(1, Math.round(st.h * st.dpr));
    }).observe(canvas);
    new IntersectionObserver((entries) => {
      st.inView = entries[entries.length - 1].isIntersecting;
      kick();
    }).observe(canvas);
    document.addEventListener('visibilitychange', kick);

    function frame(t) {
      if (!st.inView || document.hidden) {
        running = false;
        return;
      }
      // Capped stages draw on shared time slots (same rAF timestamp for every loop in a
      // frame), so all of them — and the HUD loop — land on the same vsyncs and the
      // compositor really only works at the capped rate.
      const slotMs = lite ? LITE_FRAME_MS : st.active ? 0 : IDLE_FRAME_MS;
      if (slotMs) {
        const slot = Math.floor(t / slotMs);
        if (last && slot === lastSlot) {
          requestAnimationFrame(frame);
          return;
        }
        lastSlot = slot;
      }
      const dt = last ? Math.min(lite ? 100 : 50, t - last) : 16;
      last = t;
      if (t - palAt > 500) {
        st.pal = readPalette();
        palAt = t;
      }
      if (st.w > 0 && st.h > 0) {
        ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
        ctx.clearRect(0, 0, st.w, st.h);
        draw(ctx, st, dt, t);
      }
      requestAnimationFrame(frame);
    }
    function kick() {
      if (running || !st.inView || document.hidden) return;
      running = true;
      last = 0;
      requestAnimationFrame(frame);
    }
    return st;
  }

  function localPoint(canvas, e) {
    // offsetX/Y are in the element's own (untransformed) space, which matters because
    // the whole app shell is tilted with a 3D transform that skews client coordinates.
    return { x: e.offsetX * (canvas.clientWidth / (canvas.offsetWidth || 1)), y: e.offsetY };
  }

  // ---------------- layered floating panels ----------------
  // One main card plus one card per section, cascading down and to the side of the
  // thing that was clicked, joined to it by an animated connector line.
  function closePanel(host) {
    const old = host.querySelector('.holo-panels');
    if (!old) return;
    old.classList.add('closing');
    setTimeout(() => old.remove(), 180);
  }

  // `sec.spark` is a recent-history array (0–100) drawn as a sparkline under the bar.
  function sparkMarkup(values, tone) {
    if (!values || values.length < 2) return '';
    const n = values.length;
    const pts = values.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(26 - (clamp(v, 0, 100) / 100) * 24).toFixed(2)}`).join(' ');
    return `<svg class="holo-spark ${tone || ''}" viewBox="0 0 100 28" preserveAspectRatio="none">`
      + `<polygon points="0,28 ${pts} 100,28" /><polyline points="${pts}" /></svg>`;
  }

  function sectionInner(sec) {
    const rows = sec.rows
      .filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== '')
      .map(([k, v, tone]) => `<div class="holo-row"><span>${esc(k)}</span><b class="mono ${tone || ''}">${esc(v)}</b></div>`)
      .join('');
    const bar = sec.bar != null
      ? `<div class="holo-bar ${sec.barTone || ''}"><i style="width:${clamp(sec.bar, 0, 100)}%"></i></div>`
      : '';
    const spark = sec.spark ? sparkMarkup(sec.spark, sec.barTone) : '';
    const sparkCap = spark && sec.sparkCaption ? `<div class="holo-spark-cap mono">${esc(sec.sparkCaption)}</div>` : '';
    return `<div class="holo-sec-title mono">${esc(sec.title)}</div>${bar}${spark}${sparkCap}${rows}`;
  }

  // Re-fills an open panel's sections in place (no unfold animation replay) so live
  // values and sparklines keep moving while the panel stays open.
  function refreshPanel(host, spec) {
    const blocks = host.querySelectorAll('.holo-panels:not(.closing) .holo-block[data-sec]');
    const sections = spec.sections || [];
    if (!blocks.length || blocks.length !== sections.length) return;
    blocks.forEach((el, i) => {
      el.innerHTML = sectionInner(sections[i]);
    });
  }

  function openPanel(host, anchor, spec) {
    host.querySelectorAll('.holo-panels').forEach((el) => el.remove());
    const hostW = host.clientWidth;
    const hostH = host.clientHeight;
    const panelW = Math.min(270, hostW - 24);
    const toRight = anchor.x < hostW / 2;

    const wrap = document.createElement('div');
    wrap.className = 'holo-panels';
    const blocks = [];
    blocks.push(`
      <div class="holo-block holo-block-head">
        <div class="holo-kicker mono">${esc(spec.kicker || '')}</div>
        <div class="holo-title">${esc(spec.title)}</div>
        ${spec.subtitle ? `<div class="holo-sub mono">${esc(spec.subtitle)}</div>` : ''}
        <button class="holo-close" data-role="close" aria-label="close">×</button>
      </div>`);
    for (const sec of spec.sections || []) {
      blocks.push(`<div class="holo-block" data-sec>${sectionInner(sec)}</div>`);
    }
    if (spec.actions && spec.actions.length) {
      blocks.push(`<div class="holo-block holo-block-actions">${spec.actions
        .map((a, i) => `<button class="btn ${a.primary ? 'btn-primary' : 'btn-ghost'} btn-small" data-action="${i}">${a.html || esc(a.label)}</button>`)
        .join('')}</div>`);
    }
    wrap.innerHTML = `
      <svg class="holo-link" width="${hostW}" height="${hostH}"><polyline points="" /><circle r="3.5" /></svg>
      <div class="holo-stack" style="width:${panelW}px">${blocks
        .map((b, i) => b.replace('class="holo-block', `style="--i:${i}" class="holo-block`))
        .join('')}</div>`;
    host.appendChild(wrap);

    const stack = wrap.querySelector('.holo-stack');
    const stackH = stack.offsetHeight;
    const left = toRight
      ? clamp(anchor.x + 56, 12, hostW - panelW - 12)
      : clamp(anchor.x - 56 - panelW, 12, hostW - panelW - 12);
    const top = clamp(anchor.y - 50, 10, Math.max(10, hostH - stackH - 10));
    stack.style.left = `${left}px`;
    stack.style.top = `${top}px`;
    stack.classList.toggle('from-right', !toRight);

    const edgeX = toRight ? left : left + panelW;
    const elbowX = toRight ? edgeX - 22 : edgeX + 22;
    const headY = top + 22;
    wrap.querySelector('polyline').setAttribute('points', `${anchor.x},${anchor.y} ${elbowX},${headY} ${edgeX},${headY}`);
    const dot = wrap.querySelector('circle');
    dot.setAttribute('cx', anchor.x);
    dot.setAttribute('cy', anchor.y);

    wrap.querySelector('[data-role="close"]').addEventListener('click', () => {
      closePanel(host);
      if (spec.onClose) spec.onClose();
    });
    wrap.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => spec.actions[Number(btn.dataset.action)].onClick(btn));
    });
    return wrap;
  }

  // ---------------- 3D helpers ----------------
  function box(cx, cy, cz, w, h, d) {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    return {
      c: [cx, cy, cz],
      v: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    };
  }
  const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [1, 2, 6, 5], [0, 3, 7, 4]];

  function circlePoint(c, axis, r, a) {
    const u = Math.cos(a) * r;
    const v = Math.sin(a) * r;
    if (axis === 'z') return [c[0] + u, c[1] + v, c[2]];
    if (axis === 'y') return [c[0] + u, c[1], c[2] + v];
    return [c[0], c[1] + u, c[2] + v];
  }

  function project(p, cam, cx, cy, f) {
    const x = p[0] - cam.tx;
    const y = p[1] - cam.ty;
    const z = p[2] - cam.tz;
    const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw);
    const x1 = x * cyw + z * syw;
    const z1 = -x * syw + z * cyw;
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const y1 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const s = f / Math.max(0.5, cam.dist - z2);
    return [cx + x1 * s, cy - y1 * s, z2, s];
  }

  // ---------------- PC hologram ----------------
  // `mini` is the sidebar version: same model and heat colours, no callouts or clicks.
  function createPcHologram(host, { getHardware, mini = false }) {
    const canvas = host.querySelector('canvas');
    if (mini) canvas.style.pointerEvents = 'none';
    let hw = null;
    let stats = null;
    // Recent samples per gauge for the panel sparklines. Polling runs every 2–6s
    // depending on tab and effects mode, so the caption uses real sample times.
    const HISTORY_LEN = 90;
    const hist = { cpu: [], ram: [], gpu: [] };
    const histAt = [];
    let hover = null;
    let selected = null;
    let parts = [];
    const cam = { yaw: 0.7, pitch: -0.3, dist: 12.5, tx: 0, ty: 0, tz: 0 };
    const goal = { dist: 12.5, tx: 0, ty: 0, tz: 0 };
    let spin = 0;
    let bladeAngle = 0;
    let drag = null;
    let idleSince = 0;
    // exploded view: 0 = assembled, 1 = parts pulled apart (double-click toggles)
    let explode = 0;
    let explodeGoal = 0;
    let clickTimer = null;
    // pulled-apart view snaps back on its own after this long without the pointer on it
    const EXPLODE_IDLE_MS = 8000;
    let touchedAt = 0;
    // smoothed 0–1 heat per part, so colours glide instead of jumping every poll
    const heat = {};
    const motes = Array.from({ length: 26 }, () => [(Math.random() - 0.5) * 1.8, -2.2 + Math.random() * 4.4, (Math.random() - 0.5) * 4.2, 0.004 + Math.random() * 0.01]);

    function buildParts() {
      const driveCount = hw && hw.drives ? Math.min(4, hw.drives.length) : 2;
      const drives = Array.from({ length: Math.max(1, driveCount) }, (_, i) => box(0.25, -1.55 - i * 0.2, 1.5, 1.15, 0.13, 0.75));
      parts = [
        { id: 'case', off: [0, 0, 0], shapes: [box(0, 0, 0, 2.0, 4.4, 4.6)], fans: [
          ...[1.25, 0, -1.25].map((y) => ({ c: [0.05, y, 2.3], axis: 'z', r: 0.52 })),
          { c: [-0.1, 1.3, -2.3], axis: 'z', r: 0.44 },
        ] },
        { id: 'psu', off: [0, -0.5, -3.0], shapes: [box(0, -1.78, -0.72, 1.92, 0.78, 2.5)] },
        { id: 'board', off: [-1.7, 0.1, 0], selectable: true, shapes: [box(-0.93, 0.35, -0.3, 0.05, 3.3, 3.5)] },
        { id: 'cpu', off: [-0.5, 2.0, -1.7], selectable: true, shapes: [box(-0.5, 1.28, -0.6, 0.74, 0.95, 0.95)], fans: [{ c: [-0.5, 1.28, -0.1], axis: 'z', r: 0.38 }] },
        { id: 'ram', off: [-0.5, 1.8, 1.8], selectable: true, shapes: [0, 1, 2, 3].map((i) => box(-0.74, 1.28, 0.22 + i * 0.14, 0.34, 0.95, 0.05)) },
        { id: 'gpu', off: [2.1, -0.2, 0.2], selectable: true, shapes: [box(-0.3, -0.08, -0.35, 1.1, 0.52, 3.1)], fans: [-1.25, -0.35, 0.55].map((z) => ({ c: [-0.3, -0.35, z], axis: 'y', r: 0.37 })) },
        { id: 'storage', off: [0.9, -0.6, 3.0], selectable: true, shapes: drives },
      ];
      for (const p of parts) {
        p.center = p.shapes.reduce((acc, s) => [acc[0] + s.c[0], acc[1] + s.c[1], acc[2] + s.c[2]], [0, 0, 0]).map((v) => v / p.shapes.length);
      }
    }
    buildParts();

    function level(id) {
      if (!stats) return 0;
      if (id === 'cpu' || id === 'board') return stats.cpu || 0;
      if (id === 'ram') return stats.ram ? stats.ram.usedPercent : 0;
      if (id === 'gpu') return stats.gpu ? stats.gpu.utilPercent : 0;
      if (id === 'storage' && hw && hw.drives && hw.drives.length) {
        return Math.max(...hw.drives.map((d) => 100 - (d.freeGB / d.totalGB) * 100));
      }
      return 0;
    }
    // 0–1 "how hot": load 60→90% (usage for RAM/drives), and for the GPU also its
    // temperature 55→83°C, whichever is worse — the same points the gauges warn at.
    function heatTarget(id) {
      let h = clamp((level(id) - 60) / 30, 0, 1);
      if (id === 'gpu' && stats && stats.gpu) h = Math.max(h, clamp((stats.gpu.tempC - 55) / 28, 0, 1));
      return h;
    }
    function heatColor(h, pal) {
      const mix = (a, b, f) => [0, 1, 2].map((i) => Math.round(lerp(a[i], b[i], f)));
      return h < 0.6 ? mix(pal.a2, pal.warn, h / 0.6) : mix(pal.warn, pal.danger, (h - 0.6) / 0.4);
    }
    function tone(id, pal) {
      return heatColor(heat[id] ?? heatTarget(id), pal);
    }

    const partName = (id) => t(`holo.part.${id}`);
    function valueText(id) {
      if (!stats) return '--';
      if (id === 'cpu') return `${stats.cpu}%`;
      if (id === 'ram') return stats.ram ? `${stats.ram.usedPercent}%` : '--';
      if (id === 'gpu') return stats.gpu ? `${stats.gpu.utilPercent}% · ${stats.gpu.tempC}°C` : '--';
      if (id === 'storage') return hw && hw.drives ? `${hw.drives.length} ${t('holo.drives')}` : '--';
      return '';
    }
    function subText(id) {
      if (!hw) return '';
      if (id === 'cpu') return hw.cpuModel;
      if (id === 'gpu') return hw.gpuModel || '';
      if (id === 'ram') return `${Math.round(hw.ramGB)} GB`;
      if (id === 'storage') return hw.drives.map((d) => d.letter).join(' ');
      return '';
    }

    function sparkOf(key) {
      const values = hist[key];
      if (values.length < 2) return {};
      const secs = Math.round((histAt[histAt.length - 1] - histAt[histAt.length - values.length]) / 1000);
      return {
        spark: values,
        sparkCaption: t('holo.spark', secs, Math.round(Math.max(...values))),
      };
    }

    function panelFor(id) {
      const gb = (v) => `${v.toFixed(v >= 100 ? 0 : 1)} GB`;
      const L = level(id);
      const base = { kicker: `SYS.${id.toUpperCase()} // ${hw ? hw.hostname : ''}`, title: partName(id) };
      if (id === 'cpu') {
        return { ...base, subtitle: hw && hw.cpuModel, sections: [
          { title: t('holo.sec.live'), bar: L, barTone: L >= 75 ? 'warn' : '', ...sparkOf('cpu'), rows: [[t('holo.load'), `${L}%`]] },
          { title: t('holo.sec.spec'), rows: [[t('holo.threads'), hw && hw.threads]] },
        ] };
      }
      if (id === 'gpu') {
        const g = stats && stats.gpu;
        return { ...base, subtitle: (hw && hw.gpuModel) || t('sysmon.noGpu'), sections: g ? [
          { title: t('holo.sec.live'), bar: g.utilPercent, ...sparkOf('gpu'), rows: [[t('holo.load'), `${g.utilPercent}%`], [t('holo.temp'), `${g.tempC}°C`, g.tempC >= 83 ? 'bad' : g.tempC >= 72 ? 'warn' : 'good']] },
          { title: 'VRAM', bar: (g.memUsedMB / g.memTotalMB) * 100, rows: [[t('holo.used'), gb(g.memUsedMB / 1024)], [t('holo.total'), gb(g.memTotalMB / 1024)]] },
        ] : [] };
      }
      if (id === 'ram') {
        const r = stats && stats.ram;
        return { ...base, subtitle: hw && `${Math.round(hw.ramGB)} GB`, sections: r ? [
          { title: t('holo.sec.live'), bar: r.usedPercent, barTone: r.usedPercent >= 75 ? 'warn' : '', ...sparkOf('ram'), rows: [[t('holo.used'), gb(r.usedGB)], [t('holo.free'), gb(r.totalGB - r.usedGB)], [t('holo.total'), gb(r.totalGB)]] },
        ] : [] };
      }
      if (id === 'storage') {
        return { ...base, subtitle: t('holo.drivesCount', hw ? hw.drives.length : 0), sections: (hw ? hw.drives : []).map((d) => {
          const used = 100 - (d.freeGB / d.totalGB) * 100;
          return { title: d.letter, bar: used, barTone: used >= 90 ? 'bad' : used >= 75 ? 'warn' : '', rows: [[t('holo.free'), gb(d.freeGB)], [t('holo.total'), gb(d.totalGB)]] };
        }) };
      }
      return { ...base, subtitle: hw && hw.hostname, sections: [
        { title: t('holo.sec.spec'), rows: [[t('holo.part.cpu'), hw && hw.cpuModel], [t('holo.part.gpu'), hw && hw.gpuModel], [t('holo.part.ram'), hw && `${Math.round(hw.ramGB)} GB`]] },
      ] };
    }

    function select(id, anchor) {
      selected = id;
      const p = parts.find((x) => x.id === id);
      goal.tx = p.center[0] + p.off[0] * explodeGoal;
      goal.ty = p.center[1] + p.off[1] * explodeGoal;
      goal.tz = p.center[2] + p.off[2] * explodeGoal;
      goal.dist = { board: 9.5, gpu: 7.2, storage: 6.2 }[id] || 5.6;
      openPanel(host, anchor, { ...panelFor(id), onClose: deselect });
    }
    function deselect() {
      selected = null;
      goal.tx = goal.tz = 0;
      goal.ty = explodeGoal ? 0.5 : 0;
      goal.dist = explodeGoal ? 15.5 : 12.5;
      idleSince = performance.now();
      touchedAt = idleSince;
    }

    const hitboxes = new Map();

    // Airflow streaks in case space, front intake (+z) to rear exhaust (-z):
    // [x, y, z, speed jitter, intake height]. Intake fans sit at y = 1.25 / 0 / -1.25,
    // the exhaust at y = 1.3, so the air bends upward as it crosses (hot air rises).
    function airY(p, z) {
      const u = clamp((2.3 - z) / 4.6, 0, 1);
      return lerp(p[4], 1.3 + (p[4] - 1.3) * 0.25, u * u);
    }
    function spawnAir(p, anywhere) {
      p[0] = (Math.random() - 0.5) * 1.5;
      p[4] = [1.25, 0, -1.25][Math.floor(Math.random() * 3)] + (Math.random() - 0.5) * 0.8;
      p[2] = anywhere ? -2.2 + Math.random() * 4.4 : 2.25;
      p[3] = 0.7 + Math.random() * 0.6;
      p[1] = airY(p, p[2]);
      return p;
    }
    const air = Array.from({ length: 46 }, () => spawnAir([], true));

    function drawAirflow(ctx, P, pal, k) {
      const load = stats ? Math.max(stats.cpu || 0, (stats.gpu && stats.gpu.utilPercent) || 0) / 100 : 0.1;
      const speed = 0.012 + load * 0.05;
      const warm = Math.max(heat.cpu || 0, heat.gpu || 0);
      ctx.lineWidth = 1.2;
      for (const p of air) {
        p[2] -= speed * p[3] * k;
        if (p[2] < -2.3) {
          spawnAir(p, false);
          continue;
        }
        p[1] = airY(p, p[2]);
        const tail = P([p[0], airY(p, p[2] + 0.35), p[2] + 0.35]);
        const head = P([p[0], p[1], p[2]]);
        const u = clamp((2.3 - p[2]) / 4.6, 0, 1);
        // cool on the way in, picks up the parts' heat on the way out
        ctx.strokeStyle = rgba(heatColor(warm * u, pal), (0.25 + load * 0.45) * Math.sin(u * Math.PI));
        ctx.beginPath();
        ctx.moveTo(tail[0], tail[1]);
        ctx.lineTo(head[0], head[1]);
        ctx.stroke();
      }
    }

    function draw(ctx, st, dt, now) {
      const { w, h, pal } = st;
      const cx = w * 0.5;
      const cy = h * (mini ? 0.5 : 0.54);
      const f = h * (mini ? 1.7 : 1.45);
      const k = dt / 16;

      if (!drag && !selected && now - idleSince > 1500) cam.yaw += 0.0035 * k;
      for (const key of ['dist', 'tx', 'ty', 'tz']) cam[key] = lerp(cam[key], goal[key], 0.07 * k);
      if (explodeGoal && !selected && !drag && now - touchedAt > EXPLODE_IDLE_MS) setExplode(0);
      explode = Math.abs(explode - explodeGoal) < 0.001 ? explodeGoal : lerp(explode, explodeGoal, 0.08 * k);
      for (const part of parts) heat[part.id] = lerp(heat[part.id] ?? heatTarget(part.id), heatTarget(part.id), 0.04 * k);
      const load = stats ? stats.cpu / 100 : 0.1;
      bladeAngle += (0.05 + load * 0.35) * k;
      spin += 0.01 * k;

      const P = (pt) => project(pt, cam, cx, cy, f);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      // floor rings
      const floorY = -2.55;
      for (const [r, a] of [[2.6, 0.35], [3.3, 0.18], [4.1, 0.1]]) {
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const q = P([Math.cos((i / 64) * TAU) * r, floorY, Math.sin((i / 64) * TAU) * r]);
          i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
        }
        ctx.strokeStyle = rgba(pal.a2, a);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU + spin;
        const len = i % 6 === 0 ? 0.35 : 0.15;
        const q1 = P([Math.cos(a) * 3.3, floorY, Math.sin(a) * 3.3]);
        const q2 = P([Math.cos(a) * (3.3 + len), floorY, Math.sin(a) * (3.3 + len)]);
        ctx.moveTo(q1[0], q1[1]);
        ctx.lineTo(q2[0], q2[1]);
      }
      ctx.strokeStyle = rgba(pal.a2, 0.45);
      ctx.stroke();

      // projector beam under the case
      const base = P([0, floorY, 0]);
      const grad = ctx.createRadialGradient(base[0], base[1], 0, base[0], base[1], base[3] * 3);
      grad.addColorStop(0, rgba(pal.a2, 0.16));
      grad.addColorStop(1, rgba(pal.a2, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(base[0], base[1], base[3] * 3, base[3] * 0.9, 0, 0, TAU);
      ctx.fill();

      hitboxes.clear();
      const pulse = 0.5 + 0.5 * Math.sin(now / 420);
      if (!lite && explode < 0.5) drawAirflow(ctx, P, pal, k);

      for (const part of parts) {
        const off = part.off.map((v) => v * explode);
        const PP = explode ? (pt) => P([pt[0] + off[0], pt[1] + off[1], pt[2] + off[2]]) : P;
        const isHot = hover === part.id || selected === part.id;
        const dimmed = selected && selected !== part.id && part.id !== 'case';
        const col = part.id === 'case' || part.id === 'psu' ? pal.a1 : tone(part.id, pal);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const lvl = level(part.id) / 100;

        for (const shape of part.shapes) {
          const pv = shape.v.map(PP);
          for (const q of pv) {
            minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]);
            minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
          }
          if (part.selectable) {
            ctx.fillStyle = rgba(col, (isHot ? 0.07 : 0.025) + lvl * 0.05 * (0.6 + 0.4 * pulse));
            for (const face of FACES) {
              ctx.beginPath();
              face.forEach((vi, i) => (i ? ctx.lineTo(pv[vi][0], pv[vi][1]) : ctx.moveTo(pv[vi][0], pv[vi][1])));
              ctx.closePath();
              ctx.fill();
            }
          }
          ctx.beginPath();
          for (const [a, b] of EDGES) {
            ctx.moveTo(pv[a][0], pv[a][1]);
            ctx.lineTo(pv[b][0], pv[b][1]);
          }
          const baseA = part.id === 'case' ? 0.35 : part.id === 'psu' ? 0.3 : 0.7;
          ctx.strokeStyle = rgba(col, dimmed ? baseA * 0.3 : isHot ? 1 : baseA);
          ctx.lineWidth = isHot ? 1.8 : 1;
          ctx.stroke();
        }

        for (const fan of part.fans || []) {
          ctx.beginPath();
          for (let i = 0; i <= 28; i++) {
            const q = PP(circlePoint(fan.c, fan.axis, fan.r, (i / 28) * TAU));
            i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
          }
          const cq = PP(fan.c);
          for (let b = 0; b < 5; b++) {
            const q = PP(circlePoint(fan.c, fan.axis, fan.r * 0.85, bladeAngle + (b / 5) * TAU));
            ctx.moveTo(cq[0], cq[1]);
            ctx.lineTo(q[0], q[1]);
          }
          ctx.strokeStyle = rgba(col, dimmed ? 0.18 : part.id === 'case' ? 0.4 : 0.75);
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (part.selectable) {
          hitboxes.set(part.id, { minX, minY, maxX, maxY, area: (maxX - minX) * (maxY - minY), center: PP(part.center) });
        }
        // exploded view: name tag above every part
        if (explode > 0.6 && !selected && part.id !== 'case') {
          const c = PP(part.center);
          ctx.globalCompositeOperation = 'source-over';
          ctx.font = `600 10px ${MONO}`;
          ctx.textAlign = 'center';
          ctx.fillStyle = rgba(col, (explode - 0.6) / 0.4);
          ctx.fillText(partName(part.id).toUpperCase(), c[0], part.id === 'board' ? maxY + 16 : minY - 8);
          ctx.textAlign = 'left';
          ctx.globalCompositeOperation = 'lighter';
        }
      }

      // scan plane sweeping the case + rising motes (decorative only)
      if (!lite) {
        const scanY = -2.2 + ((now / 3800) % 1) * 4.4;
        const sc = [[-1, scanY, -2.3], [1, scanY, -2.3], [1, scanY, 2.3], [-1, scanY, 2.3]].map(P);
        ctx.beginPath();
        sc.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath();
        ctx.fillStyle = rgba(pal.a2, 0.05);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.a2, 0.5);
        ctx.stroke();

        ctx.fillStyle = rgba(pal.a2, 0.7);
        ctx.beginPath();
        for (const m of motes) {
          m[1] += m[3] * k;
          if (m[1] > 2.2) m[1] = -2.2;
          const q = P(m);
          ctx.moveTo(q[0] + 1, q[1]);
          ctx.arc(q[0], q[1], 1, 0, TAU);
        }
        ctx.fill();
      }

      ctx.globalCompositeOperation = 'source-over';
      if (!mini && !selected && explode < 0.3) drawCallouts(ctx, w, h, pal, now);
    }

    const CALLOUTS = [
      { id: 'cpu', side: 'l', y: 0.16 },
      { id: 'ram', side: 'r', y: 0.16 },
      { id: 'gpu', side: 'l', y: 0.66 },
      { id: 'storage', side: 'r', y: 0.66 },
    ];
    // Point `u` (0–1) of the way along a polyline, by length.
    function alongPath(pts, u) {
      const lens = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        lens.push(l);
        total += l;
      }
      let d = u * total;
      for (let i = 0; i < lens.length; i++) {
        if (d <= lens[i] || i === lens.length - 1) {
          const f = lens[i] ? clamp(d / lens[i], 0, 1) : 0;
          return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f)];
        }
        d -= lens[i];
      }
      return pts[0];
    }

    function drawCallouts(ctx, w, h, pal, now) {
      const pad = 14;
      const boxW = Math.min(190, w * 0.27);
      for (const c of CALLOUTS) {
        const hb = hitboxes.get(c.id);
        if (!hb) continue;
        const ax = hb.center[0];
        const ay = hb.center[1];
        const lx = c.side === 'l' ? pad : w - pad - boxW;
        const ly = h * c.y;
        const edgeX = c.side === 'l' ? lx + boxW : lx;
        const col = tone(c.id, pal);
        const hot = hover === c.id;

        ctx.strokeStyle = rgba(col, hot ? 0.95 : 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(edgeX, ly + 8);
        ctx.lineTo(edgeX + (c.side === 'l' ? 18 : -18), ly + 8);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.fillStyle = rgba(col, 0.9);
        ctx.beginPath();
        ctx.arc(ax, ay, 2.6, 0, TAU);
        ctx.fill();

        // data stream: packets flow from the part out to its readout, faster under load
        if (!lite) {
          const path = [[ax, ay], [edgeX + (c.side === 'l' ? 18 : -18), ly + 8], [edgeX, ly + 8]];
          const speed = 0.00018 + (level(c.id) / 100) * 0.0009;
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 3; i++) {
            const u = (now * speed + i / 3) % 1;
            const p = alongPath(path, u);
            const fade = Math.sin(u * Math.PI);
            const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 5);
            gr.addColorStop(0, rgba(pal.text, 0.9 * fade));
            gr.addColorStop(0.35, rgba(col, 0.7 * fade));
            gr.addColorStop(1, rgba(col, 0));
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.arc(p[0], p[1], 5, 0, TAU);
            ctx.fill();
          }
          ctx.globalCompositeOperation = 'source-over';
        }

        ctx.textAlign = c.side === 'l' ? 'left' : 'right';
        const tx = c.side === 'l' ? lx : lx + boxW;
        ctx.font = `600 10px ${MONO}`;
        ctx.fillStyle = rgba(pal.sub, 0.9);
        ctx.fillText(partName(c.id).toUpperCase(), tx, ly + 4);
        ctx.font = `700 17px ${MONO}`;
        ctx.fillStyle = rgba(col, 1);
        ctx.fillText(valueText(c.id), tx, ly + 24);
        ctx.font = `10px ${SANS}`;
        ctx.fillStyle = rgba(pal.dim, 1);
        let sub = subText(c.id);
        while (sub && ctx.measureText(sub).width > boxW) sub = `${sub.slice(0, -2)}…`;
        ctx.fillText(sub, tx, ly + 39);
      }
      ctx.textAlign = 'left';
    }

    function pick(pt) {
      let best = null;
      for (const [id, hb] of hitboxes) {
        if (pt.x >= hb.minX && pt.x <= hb.maxX && pt.y >= hb.minY && pt.y <= hb.maxY) {
          if (!best || hb.area < best.area) best = { id, area: hb.area };
        }
      }
      return best && best.id;
    }

    canvas.addEventListener('mousedown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    window.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const wasClick = drag.moved < 4;
      drag = null;
      idleSince = performance.now();
      if (!wasClick || e.target !== canvas) return;
      const pt = localPoint(canvas, e);
      // Held back briefly so the first click of a double-click doesn't open a panel.
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        const id = pick(pt);
        if (id) {
          const hb = hitboxes.get(id);
          select(id, { x: hb.center[0], y: hb.center[1] });
        } else if (selected) {
          closePanel(host);
          deselect();
        }
      }, 220);
    });
    function setExplode(v) {
      explodeGoal = v;
      deselect();
    }
    canvas.addEventListener('dblclick', () => {
      clearTimeout(clickTimer);
      if (selected) closePanel(host);
      setExplode(explodeGoal ? 0 : 1);
    });
    window.addEventListener('mousemove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = e.clientX;
        drag.y = e.clientY;
        cam.yaw += dx * 0.01;
        cam.pitch = clamp(cam.pitch + dy * 0.006, -1.1, 0.35);
      }
    });
    canvas.addEventListener('mousemove', (e) => {
      touchedAt = performance.now();
      if (drag) return;
      hover = pick(localPoint(canvas, e));
      canvas.classList.toggle('pointing', !!hover);
    });
    canvas.addEventListener('mouseleave', () => {
      hover = null;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && selected) {
        closePanel(host);
        deselect();
      }
    });

    createStage(canvas, draw, { alwaysIdle: mini });
    async function refreshHardware() {
      try {
        hw = await getHardware();
        buildParts();
      } catch {
        // hologram still renders with placeholder parts
      }
    }
    refreshHardware();

    return {
      setStats(s) {
        stats = s;
        const push = (key, v) => {
          if (typeof v !== 'number') return;
          hist[key].push(v);
          if (hist[key].length > HISTORY_LEN) hist[key].shift();
        };
        histAt.push(Date.now());
        if (histAt.length > HISTORY_LEN) histAt.shift();
        push('cpu', s && s.cpu);
        push('ram', s && s.ram && s.ram.usedPercent);
        push('gpu', s && s.gpu && s.gpu.utilPercent);
        if (selected) refreshPanel(host, panelFor(selected));
      },
      refreshHardware,
    };
  }

  // ---------------- server globe ----------------
  function llVec(lat, lon) {
    const la = lat * DEG;
    const lo = lon * DEG;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  }
  function viewRotate(v, clat, clon) {
    const lo = -clon * DEG;
    const x = v[0] * Math.cos(lo) + v[2] * Math.sin(lo);
    const z0 = -v[0] * Math.sin(lo) + v[2] * Math.cos(lo);
    const la = clat * DEG;
    const y = v[1] * Math.cos(la) - z0 * Math.sin(la);
    const z = v[1] * Math.sin(la) + z0 * Math.cos(la);
    return [x, y, z];
  }
  function angDist(a, b) {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    return Math.acos(clamp(d, -1, 1));
  }
  function slerp(a, b, t, omega) {
    if (omega < 1e-6) return a;
    const s = Math.sin(omega);
    const k1 = Math.sin((1 - t) * omega) / s;
    const k2 = Math.sin(t * omega) / s;
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  }
  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  function createServerGlobe(host, { resolveStatus, getServerGeo, getHomeGeo, onPlay }) {
    const canvas = host.querySelector('canvas');
    let home = null;
    let servers = [];
    const geo = new Map();
    let center = { lat: 15, lon: 100 };
    let zoomTarget = 90;
    let zoomFrom = 90;
    let zoomAt = 0;
    let regional = true;
    let hover = null;
    let selected = null;
    let labelBoxes = [];
    let wobble = 0;
    let generation = 0;
    let stageRef = null;

    function fitHalfAngle() {
      const pts = [...geo.values()].filter((g) => g && g.ok);
      if (!home || !pts.length) return 90;
      const hv = llVec(home.lat, home.lon);
      const far = Math.max(...pts.map((g) => angDist(hv, llVec(g.lat, g.lon)))) / DEG;
      return clamp(far * 2.6, 2.2, 90);
    }
    function setZoom(target, now = performance.now()) {
      zoomFrom = currentHalfAngle(now);
      zoomTarget = target;
      zoomAt = now;
    }
    function currentHalfAngle(now) {
      // log-space easing so the dive from the whole planet down to a city reads smoothly
      const tt = ease((now - zoomAt) / 2200);
      return Math.exp(lerp(Math.log(zoomFrom), Math.log(zoomTarget), tt));
    }

    async function load(list) {
      const gen = ++generation;
      servers = list.filter((s) => s.address);
      if (!home) {
        try {
          home = await getHomeGeo();
        } catch {
          home = null;
        }
        if (home) center = { lat: home.lat, lon: home.lon };
      }
      await Promise.all(servers.map(async (s) => {
        try {
          const status = await resolveStatus(s.address);
          const g = await getServerGeo(s.address, status && status.endpoint);
          if (gen !== generation) return;
          geo.set(s.id, { ...g, status });
        } catch {
          geo.set(s.id, { ok: false });
        }
      }));
      if (gen !== generation) return;
      if (!home) {
        const first = [...geo.values()].find((g) => g.ok);
        if (first) center = { lat: first.lat, lon: first.lon };
      }
      if (regional) setZoom(fitHalfAngle());
    }

    function pingTone(ms, pal) {
      if (ms == null) return pal.dim;
      if (ms <= 40) return pal.ok;
      if (ms <= 100) return pal.warn;
      return pal.danger;
    }
    const pingWidth = (ms) => (ms == null ? 1 : ms <= 30 ? 3.4 : ms <= 80 ? 2.4 : ms <= 150 ? 1.6 : 1.1);

    function serverPanel(s, g) {
      const st = g.status || {};
      const km = home ? Math.round(angDist(llVec(home.lat, home.lon), llVec(g.lat, g.lon)) * 6371) : null;
      return {
        kicker: `NODE // ${g.ip || ''}`,
        title: s.name,
        subtitle: s.address,
        sections: [
          { title: t('holo.sec.link'), rows: [
            [t('holo.ping'), g.pingMs != null ? `${g.pingMs} ms` : t('holo.pingNone'), g.pingMs == null ? 'bad' : g.pingMs <= 40 ? 'good' : g.pingMs <= 100 ? 'warn' : 'bad'],
            [t('holo.players'), st.online ? (st.maxPlayers != null ? `${st.players}/${st.maxPlayers}` : `${st.players}`) : t('connect.status.offline'), st.online ? 'good' : 'bad'],
            [t('holo.build'), st.gameBuild],
            [t('holo.pure'), st.pureLevel != null ? `${st.pureLevel}` : null],
          ], bar: st.online && st.maxPlayers ? (st.players / st.maxPlayers) * 100 : null },
          { title: t('holo.sec.location'), rows: [
            [t('holo.city'), [g.city, g.country].filter(Boolean).join(', ')],
            [t('holo.isp'), g.isp],
            [t('holo.distance'), km != null ? `${km.toLocaleString()} km` : null],
          ] },
        ],
        actions: [{ primary: true, label: t('connect.play'), onClick: () => onPlay(s) }],
        onClose: () => {
          selected = null;
        },
      };
    }

    // All labels go in one column beside the nodes, pushed apart vertically — servers
    // are often in the same city, so per-node fans would pile on top of each other.
    function drawLabels(ctx, pending, w, h, pal) {
      if (!pending.length) return;
      const LH = 34;
      const xs = pending.map((p) => p.sp[0]);
      const toRight = Math.max(...xs) < w * 0.6;
      const colX = toRight ? Math.max(...xs) + 64 : Math.min(...xs) - 64;
      pending.sort((a, b) => a.sp[1] - b.sp[1]);
      const ys = [];
      pending.forEach((p, i) => {
        const want = p.sp[1] - 12 - ((pending.length - 1) * LH) / 2 + i * LH;
        ys.push(Math.max(want, i ? ys[i - 1] + LH : 34));
      });
      const overflow = ys[ys.length - 1] + 30 - (h - 40);
      if (overflow > 0) for (let i = 0; i < ys.length; i++) ys[i] = Math.max(34 + i * LH, ys[i] - overflow);

      ctx.globalCompositeOperation = 'source-over';
      pending.forEach(({ s, sp }, i) => {
        const g2 = geo.get(s.id);
        const ly = ys[i];
        ctx.font = `600 11.5px ${SANS}`;
        let name = s.name;
        while (ctx.measureText(name).width > 150) name = `${name.slice(0, -2)}…`;
        const nameW = ctx.measureText(name).width;
        const pingTxt = g2.pingMs != null ? `${g2.pingMs} ms` : '— ms';
        ctx.font = `600 10px ${MONO}`;
        const bw = Math.max(nameW, ctx.measureText(pingTxt).width) + 18;
        const bx = toRight ? colX : colX - bw;
        const isHot = hover === s.id || selected === s.id;
        const pc = pingTone(g2.pingMs, pal);

        ctx.strokeStyle = rgba(pc, isHot ? 0.95 : 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sp[0], sp[1]);
        ctx.lineTo(toRight ? bx - 14 : bx + bw + 14, ly + 13);
        ctx.lineTo(toRight ? bx : bx + bw, ly + 13);
        ctx.stroke();

        ctx.fillStyle = isHot ? rgba(pc, 0.2) : 'rgba(6,10,20,.78)';
        ctx.fillRect(bx, ly, bw, 28);
        ctx.strokeStyle = rgba(pc, isHot ? 0.95 : 0.4);
        ctx.strokeRect(bx + 0.5, ly + 0.5, bw - 1, 27);
        ctx.fillStyle = rgba(pc, 1);
        ctx.fillRect(toRight ? bx : bx + bw - 2, ly, 2, 28);

        ctx.textAlign = 'left';
        ctx.font = `600 11.5px ${SANS}`;
        ctx.fillStyle = rgba(pal.text, 1);
        ctx.fillText(name, bx + 9, ly + 12);
        ctx.font = `600 10px ${MONO}`;
        ctx.fillStyle = rgba(pc, 1);
        ctx.fillText(pingTxt, bx + 9, ly + 24);
        labelBoxes.push({ id: s.id, x: bx, y: ly, w: bw, h: 28 });
      });
      ctx.globalCompositeOperation = 'lighter';
    }

    function draw(ctx, st, dt, now) {
      stageRef = st;
      const { w, h, pal } = st;
      const S = Math.min(w, h);
      const cx = w / 2;
      const cy = h / 2;
      const half = currentHalfAngle(now);
      const R = half >= 89.9 ? S * 0.42 : (S * 0.42) / Math.sin(half * DEG);
      wobble += (dt / 16) * 0.004;
      const clat = center.lat + (half > 60 ? 8 : 0);
      const clon = center.lon + (half > 60 ? ((now / 80) % 360) : Math.sin(wobble) * half * 0.06);
      const toScreen = (v, lift = 0) => {
        const r = viewRotate(v, clat, clon);
        const m = 1 + lift;
        return [cx + r[0] * R * m, cy - r[1] * R * m, r[2]];
      };

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';

      // atmosphere + disk
      if (R < S * 3) {
        const g1 = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.12);
        g1.addColorStop(0, rgba(pal.a1, 0.05));
        g1.addColorStop(0.85, rgba(pal.a2, 0.09));
        g1.addColorStop(1, rgba(pal.a2, 0));
        ctx.fillStyle = g1;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.12, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(pal.a2, 0.5);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, TAU);
        ctx.stroke();
      } else {
        const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.7);
        g2.addColorStop(0, rgba(pal.a1, 0.08));
        g2.addColorStop(1, rgba(pal.a1, 0));
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, w, h);
      }

      // graticule, limited to the visible window
      const step = half > 45 ? 15 : half > 12 ? 5 : half > 4 ? 1 : 0.5;
      const win = Math.min(180, half * 1.8);
      const latMin = Math.max(-90, Math.floor((center.lat - win) / step) * step);
      const latMax = Math.min(90, Math.ceil((center.lat + win) / step) * step);
      const lonWin = half > 60 ? 180 : Math.min(180, win / Math.max(0.2, Math.cos(center.lat * DEG)));
      const lonMin = Math.floor((clon - lonWin) / step) * step;
      const lonMax = Math.ceil((clon + lonWin) / step) * step;
      const seg = step / 4;
      const strokeLine = (pts) => {
        let open = false;
        for (const p of pts) {
          if (p[2] <= 0.02) {
            open = false;
            continue;
          }
          open ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
          open = true;
        }
      };
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lat = latMin; lat <= latMax; lat += step) {
        const pts = [];
        for (let lon = lonMin; lon <= lonMax; lon += seg) pts.push(toScreen(llVec(lat, lon)));
        strokeLine(pts);
      }
      for (let lon = lonMin; lon <= lonMax; lon += step) {
        const pts = [];
        for (let lat = Math.max(-90, latMin - step); lat <= Math.min(90, latMax + step); lat += seg) pts.push(toScreen(llVec(lat, lon)));
        strokeLine(pts);
      }
      ctx.strokeStyle = rgba(pal.a2, half > 45 ? 0.16 : 0.13);
      ctx.stroke();

      // distance rings around home
      if (home && half < 45) {
        const kmStep = niceStep((half * 111) / 2.5);
        const hv = llVec(home.lat, home.lon);
        const east = [Math.cos(home.lon * DEG), 0, -Math.sin(home.lon * DEG)];
        const north = [hv[1] * east[2] - hv[2] * east[1], hv[2] * east[0] - hv[0] * east[2], hv[0] * east[1] - hv[1] * east[0]];
        ctx.font = `9px ${MONO}`;
        for (let i = 1; i <= 4; i++) {
          const ang = (kmStep * i) / 6371;
          ctx.beginPath();
          for (let j = 0; j <= 72; j++) {
            const b = (j / 72) * TAU;
            const dir = [east[0] * Math.cos(b) + north[0] * Math.sin(b), east[1] * Math.cos(b) + north[1] * Math.sin(b), east[2] * Math.cos(b) + north[2] * Math.sin(b)];
            const v = [hv[0] * Math.cos(ang) + dir[0] * Math.sin(ang), hv[1] * Math.cos(ang) + dir[1] * Math.sin(ang), hv[2] * Math.cos(ang) + dir[2] * Math.sin(ang)];
            const q = toScreen(v);
            j ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
          }
          ctx.setLineDash([2, 5]);
          ctx.strokeStyle = rgba(pal.a1, 0.35);
          ctx.stroke();
          ctx.setLineDash([]);
          const lblV = [hv[0] * Math.cos(ang) + north[0] * Math.sin(ang), hv[1] * Math.cos(ang) + north[1] * Math.sin(ang), hv[2] * Math.cos(ang) + north[2] * Math.sin(ang)];
          const lq = toScreen(lblV);
          ctx.fillStyle = rgba(pal.dim, 0.9);
          ctx.fillText(`${kmStep * i} km`, lq[0] + 3, lq[1] - 3);
        }
      }

      // arcs + pulses, grouped by shared location
      const groups = new Map();
      for (const s of servers) {
        const g = geo.get(s.id);
        if (!g || !g.ok) continue;
        const key = `${g.lat.toFixed(2)},${g.lon.toFixed(2)}`;
        if (!groups.has(key)) groups.set(key, { g, list: [] });
        groups.get(key).list.push(s);
      }
      const hv = home ? llVec(home.lat, home.lon) : null;
      labelBoxes = [];
      const pending = [];
      let gi = 0;
      for (const { g, list } of groups.values()) {
        const sv = llVec(g.lat, g.lon);
        const sp = toScreen(sv);
        const bestPing = Math.min(...list.map((s) => (geo.get(s.id).pingMs ?? 9999)));
        const col = pingTone(bestPing === 9999 ? null : bestPing, pal);
        if (hv) {
          const omega = angDist(hv, sv);
          const lift = Math.min(0.25, omega * 0.55);
          const pts = [];
          for (let i = 0; i <= 48; i++) {
            const tt = i / 48;
            pts.push(toScreen(slerp(hv, sv, tt, omega), lift * Math.sin(Math.PI * tt)));
          }
          ctx.beginPath();
          strokeLine(pts);
          ctx.strokeStyle = rgba(col, 0.25);
          ctx.lineWidth = pingWidth(bestPing === 9999 ? null : bestPing) + 3;
          ctx.stroke();
          ctx.strokeStyle = rgba(col, 0.85);
          ctx.lineWidth = pingWidth(bestPing === 9999 ? null : bestPing);
          ctx.stroke();

          if (!lite) list.forEach((s, si) => {
            const ms = geo.get(s.id).pingMs;
            const speed = ms == null ? 0.00012 : 0.0009 / Math.max(1, Math.sqrt(ms / 8));
            const tt = ((now * speed) + si / list.length + gi * 0.13) % 1;
            const p = toScreen(slerp(hv, sv, tt, omega), lift * Math.sin(Math.PI * tt));
            if (p[2] <= 0) return;
            const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 7);
            gr.addColorStop(0, rgba(pal.text, 0.95));
            gr.addColorStop(0.3, rgba(col, 0.8));
            gr.addColorStop(1, rgba(col, 0));
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.arc(p[0], p[1], 7, 0, TAU);
            ctx.fill();
          });
        }
        if (sp[2] <= 0) continue;

        // server node
        const r = 4 + 1.5 * Math.sin(now / 300 + gi);
        ctx.strokeStyle = rgba(col, 0.95);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(sp[0], sp[1] - r);
        ctx.lineTo(sp[0] + r, sp[1]);
        ctx.lineTo(sp[0], sp[1] + r);
        ctx.lineTo(sp[0] - r, sp[1]);
        ctx.closePath();
        ctx.stroke();

        list.forEach((srv) => pending.push({ s: srv, sp }));
        gi++;
      }

      // home marker
      if (home) {
        const hp = toScreen(llVec(home.lat, home.lon));
        if (hp[2] > 0) {
          const pr = ((now / 1600) % 1);
          ctx.strokeStyle = rgba(pal.a2, 0.9 * (1 - pr));
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hp[0], hp[1], 4 + pr * 22, 0, TAU);
          ctx.stroke();
          ctx.fillStyle = rgba(pal.a2, 1);
          ctx.beginPath();
          ctx.arc(hp[0], hp[1], 3.2, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = rgba(pal.a2, 0.6);
          ctx.beginPath();
          ctx.moveTo(hp[0] - 12, hp[1]); ctx.lineTo(hp[0] - 6, hp[1]);
          ctx.moveTo(hp[0] + 6, hp[1]); ctx.lineTo(hp[0] + 12, hp[1]);
          ctx.moveTo(hp[0], hp[1] - 12); ctx.lineTo(hp[0], hp[1] - 6);
          ctx.moveTo(hp[0], hp[1] + 6); ctx.lineTo(hp[0], hp[1] + 12);
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          ctx.font = `700 10px ${MONO}`;
          ctx.fillStyle = rgba(pal.a2, 1);
          const labelsRight = !pending.length || Math.max(...pending.map((p) => p.sp[0])) < w * 0.6;
          const hx = labelsRight ? hp[0] - 16 : hp[0] + 16;
          ctx.textAlign = labelsRight ? 'right' : 'left';
          ctx.fillText(t('holo.you'), hx, hp[1] + 3);
          ctx.font = `9.5px ${SANS}`;
          ctx.fillStyle = rgba(pal.sub, 1);
          ctx.fillText(home.city || '', hx, hp[1] + 15);
          ctx.textAlign = 'left';
          ctx.globalCompositeOperation = 'lighter';
        }
      }

      drawLabels(ctx, pending, w, h, pal);

      // lens frame + readout
      const lensR = S * 0.47;
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(pal.a2, 0.25);
      ctx.setLineDash([3, 9]);
      ctx.lineDashOffset = -now / 60;
      ctx.beginPath();
      ctx.arc(cx, cy, lensR, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU - now / 9000;
        const l = i % 9 === 0 ? 8 : 3;
        ctx.moveTo(cx + Math.cos(a) * (lensR + 4), cy + Math.sin(a) * (lensR + 4));
        ctx.lineTo(cx + Math.cos(a) * (lensR + 4 + l), cy + Math.sin(a) * (lensR + 4 + l));
      }
      ctx.strokeStyle = rgba(pal.a2, 0.35);
      ctx.stroke();

      ctx.globalCompositeOperation = 'source-over';
      ctx.font = `9.5px ${MONO}`;
      ctx.fillStyle = rgba(pal.dim, 1);
      const latTxt = `${Math.abs(center.lat).toFixed(2)}°${center.lat >= 0 ? 'N' : 'S'}`;
      const lonTxt = `${Math.abs(center.lon).toFixed(2)}°${center.lon >= 0 ? 'E' : 'W'}`;
      ctx.fillText(`LAT ${latTxt}  LON ${lonTxt}`, 12, h - 26);
      ctx.fillText(`ZOOM ×${(90 / half).toFixed(1)} · ${regional ? t('holo.region') : t('holo.world')}`, 12, h - 12);
      if (!home && !geo.size) {
        ctx.textAlign = 'center';
        ctx.fillText(t('holo.locating'), cx, cy);
        ctx.textAlign = 'left';
      }
    }

    function pickLabel(pt) {
      const hit = labelBoxes.find((b) => pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h);
      return hit || null;
    }
    canvas.addEventListener('mousemove', (e) => {
      const hit = pickLabel(localPoint(canvas, e));
      hover = hit ? hit.id : null;
      canvas.classList.toggle('pointing', !!hit);
    });
    canvas.addEventListener('mouseleave', () => {
      hover = null;
    });
    canvas.addEventListener('click', (e) => {
      const pt = localPoint(canvas, e);
      const hit = pickLabel(pt);
      if (hit) {
        const s = servers.find((x) => x.id === hit.id);
        const g = geo.get(hit.id);
        if (!s || !g) return;
        selected = s.id;
        openPanel(host, { x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 }, serverPanel(s, g));
        return;
      }
      if (selected) {
        selected = null;
        closePanel(host);
        return;
      }
      regional = !regional;
      setZoom(regional ? fitHalfAngle() : 90);
    });

    createStage(canvas, draw);
    setInterval(() => {
      if (stageRef && stageRef.inView && !document.hidden && servers.length) load(servers);
    }, 30000);

    return {
      setServers(list) {
        load(list);
      },
    };
  }

  return {
    createPcHologram,
    createServerGlobe,
    setLite(v) {
      lite = !!v;
    },
  };
})();
