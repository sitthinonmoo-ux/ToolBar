let allPlugins = [];
let activeCategory = 'home';
let searchTerm = '';
let currentPlugin = null;
let currentParams = {};
let lastHealth = null;

const grid = document.getElementById('card-grid');
const pluginCount = document.getElementById('plugin-count');
const toastStack = document.getElementById('toast-stack');
const viewDashboard = document.getElementById('view-dashboard');
const viewTools = document.getElementById('view-tools');
const viewConnect = document.getElementById('view-connect');
const viewApps = document.getElementById('view-apps');
const healthPanel = document.getElementById('health-panel');
const nextStepEl = document.getElementById('next-step');

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function toast(message, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${message}<div class="bar"></div>`;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// ---------------- icons + static i18n ----------------
function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = iconMarkup(el.dataset.icon);
  });
}

// Generic drag-to-reorder via native HTML5 DnD — attach once to a container that holds
// items matching itemSelector; getKey identifies each item, onReorder(keys) is called
// with the new order after a drop. axis 'y' suits a vertical list (sidebar), 'x' suits
// a wrapping grid (server cards), deciding which side of the hovered item to drop on.
function makeSortable(container, itemSelector, getKey, onReorder, axis = 'y') {
  let draggingEl = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    draggingEl = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', getKey(item));
    requestAnimationFrame(() => item.classList.add('dragging'));
  });

  container.addEventListener('dragend', () => {
    if (draggingEl) draggingEl.classList.remove('dragging');
    draggingEl = null;
  });

  container.addEventListener('dragover', (e) => {
    if (!draggingEl) return;
    e.preventDefault();
    const target = e.target.closest(itemSelector);
    if (!target || target === draggingEl || !container.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const before = axis === 'x' ? e.clientX - rect.left < rect.width / 2 : e.clientY - rect.top < rect.height / 2;
    container.insertBefore(draggingEl, before ? target : target.nextSibling);
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggingEl) return;
    const order = [...container.querySelectorAll(itemSelector)].map(getKey);
    onReorder(order);
  });
}

function applyStaticI18n() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.getElementById('btn-lang').textContent = getLang().toUpperCase();
}

document.getElementById('btn-lang').addEventListener('click', () => {
  setLang(getLang() === 'th' ? 'en' : 'th');
  applyStaticI18n();
  if (activeCategory === 'home') {
    if (lastHealth) renderHealthCheck(lastHealth);
    renderDashboardGraphics();
    renderDashboardServers();
  } else if (activeCategory === 'connect') {
    renderServerCards();
  } else {
    renderCards();
  }
});

// ---------------- sidebar / cards ----------------
const railByCategory = { graphics: 'var(--accent-2)', maintenance: 'var(--warning)', connect: 'var(--accent-1)', settings: 'var(--success)' };

function buildToolCard(plugin) {
  const card = document.createElement('div');
  card.className = 'tool-card';
  card.style.setProperty('--rail', railByCategory[plugin.category] || 'var(--accent-2)');
  card.innerHTML = `
    <div class="tool-card-icon">${iconMarkup(plugin.icon)}</div>
    <h3>${L(plugin.name)}</h3>
    <p>${L(plugin.description)}</p>
    <div class="tool-card-footer">
      <span class="tag">${t('nav.' + plugin.category)}</span>
      <button class="btn btn-primary btn-small">${t('card.open')}</button>
    </div>
  `;
  card.addEventListener('mousemove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
  card.querySelector('button').addEventListener('click', () => openModal(plugin));
  return card;
}

function renderCards() {
  const filtered = allPlugins.filter((p) => {
    const matchesCategory = activeCategory === 'all' || p.category === activeCategory;
    const name = L(p.name).toLowerCase();
    const desc = L(p.description).toLowerCase();
    const matchesSearch = !searchTerm || name.includes(searchTerm) || desc.includes(searchTerm);
    return matchesCategory && matchesSearch;
  });

  grid.innerHTML = '';
  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state">${t('empty.noMatch')}</div>`;
    return;
  }

  for (const plugin of filtered) {
    grid.appendChild(buildToolCard(plugin));
  }
}

// ---------------- dashboard: graphics shortcuts + server rows ----------------
function renderDashboardGraphics() {
  const dashGrid = document.getElementById('dash-graphics-grid');
  const dashCount = document.getElementById('dash-graphics-count');
  if (!dashGrid) return;
  const graphicsPlugins = allPlugins.filter((p) => p.category === 'graphics');
  dashGrid.innerHTML = '';
  for (const plugin of graphicsPlugins) {
    dashGrid.appendChild(buildToolCard(plugin));
  }
  if (dashCount) dashCount.textContent = t('header.count', graphicsPlugins.length);
}

function buildServerRow(server) {
  const row = document.createElement('div');
  row.className = 'server-row';
  const initials = (server.name || '?').trim().slice(0, 2).toUpperCase();
  row.innerHTML = `
    <div class="server-row-avatar">${server.logo ? '' : initials}</div>
    <div>
      <p class="server-row-name">${server.name}</p>
      <p class="server-row-addr">${server.address || '—'}</p>
    </div>
    <div class="server-row-stat server-card-status checking mono" data-role="status">${t('connect.status.checking')}</div>
    <button class="server-row-play" data-role="play">${iconMarkup('nav-connect')}</button>
  `;
  if (server.logo) {
    const avatar = row.querySelector('.server-row-avatar');
    avatar.style.backgroundImage = `url(${server.logo})`;
    avatar.style.backgroundSize = 'cover';
    avatar.style.backgroundPosition = 'center';
  }
  row.addEventListener('mousemove', (e) => {
    const r = row.getBoundingClientRect();
    row.style.setProperty('--mx', `${e.clientX - r.left}px`);
    row.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
  // Fire-and-forget: the IPC call itself resolves near-instantly (it just hands the
  // fivem:// URI to the OS), so there's nothing worth disabling the button over — any
  // stutter after this click is Windows/FiveM itself booting the game, not us.
  const playBtn = row.querySelector('[data-role="play"]');
  playBtn.addEventListener('click', () => {
    window.toolbarApi
      .launchServer(server)
      .then((result) => toast(result.message, result.success ? 'success' : 'error'))
      .catch((err) => toast(err.message, 'error'));
  });

  const statusEl = row.querySelector('[data-role="status"]');
  if (!server.address) {
    statusEl.remove();
  } else {
    checkServerStatus(server.address, statusEl);
  }
  return row;
}

function renderDashboardServers() {
  const rowsEl = document.getElementById('dash-servers-rows');
  const countEl = document.getElementById('dash-servers-count');
  if (!rowsEl) return;
  rowsEl.innerHTML = '';
  if (allServers.length === 0) {
    rowsEl.innerHTML = `<div class="empty-state">${t('connect.empty')}</div>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  for (const server of allServers) {
    rowsEl.appendChild(buildServerRow(server));
  }
  if (countEl) countEl.textContent = t('connect.count', allServers.length);

  const navTagConnect = document.getElementById('nav-tag-connect');
  if (navTagConnect) navTagConnect.textContent = allServers.length ? String(allServers.length) : '';
}

// ---------------- dashboard / health check ----------------
function openPluginById(pluginId) {
  const plugin = allPlugins.find((p) => p.id === pluginId);
  if (plugin) openModal(plugin);
}

function healthRow({ ok, label, detail, actionPluginId, quickAction }) {
  const row = document.createElement('div');
  row.className = `health-row ${ok ? 'ok' : 'bad'}`;
  row.innerHTML = `
    <span class="status-icon">${iconMarkup(ok ? 'status-ok' : 'status-bad')}</span>
    <div class="health-row-body">
      <div class="health-row-label">${label}</div>
      <div class="health-row-detail">${detail}</div>
    </div>
    <div class="health-row-actions">
      ${quickAction ? `<button class="btn ${quickAction.danger ? 'btn-danger' : 'btn-primary'} btn-small" data-role="quick">${quickAction.label}</button>` : ''}
      ${!ok && actionPluginId ? `<button class="btn btn-ghost btn-small" data-role="goto">${t('health.goTo')}</button>` : ''}
    </div>
  `;
  const gotoBtn = row.querySelector('[data-role="goto"]');
  if (gotoBtn) gotoBtn.addEventListener('click', () => openPluginById(actionPluginId));
  const quickBtn = row.querySelector('[data-role="quick"]');
  if (quickBtn) {
    quickBtn.addEventListener('click', async () => {
      const original = quickBtn.textContent;
      quickBtn.disabled = true;
      quickBtn.textContent = quickAction.loadingLabel;
      try {
        await quickAction.onClick();
      } finally {
        quickBtn.disabled = false;
        quickBtn.textContent = original;
      }
    });
  }
  return row;
}

// One-click install/uninstall for ReShade, driven entirely by what the health check
// already found — no modal, no manual file picking. Falls back to telling the user
// what's missing if GTA V or FiveM weren't auto-detected.
async function quickReshadeAction(action) {
  const gameExe = lastHealth && lastHealth.gta5.path;
  const fivemAppDir = lastHealth && lastHealth.fivem.path;
  if (!gameExe || !fivemAppDir) {
    toast(t('health.quickNeedsBoth'), 'error');
    return;
  }
  const pluginId = action === 'install' ? 'reshade-installer' : 'reshade-uninstaller';
  const params =
    action === 'install' ? { gameExe, api: 'dxgi', forFiveM: true, fivemAppDir } : { gameExe, fivemAppDir };
  try {
    const result = await window.toolbarApi.run(pluginId, params);
    toast(result.message, result.success ? 'success' : 'error');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    await loadHealthCheck({ silent: true });
  }
}

function renderNextStep(h) {
  let key = 'allDone';
  let actionPluginId = null;
  if (!h.gta5.ok || !h.fivem.ok) {
    key = 'needGame';
  } else if (!h.reshadeInstalled.ok) {
    key = 'installReshade';
    actionPluginId = 'reshade-installer';
  } else if (!h.reshadeConfirmed.ok) {
    key = 'confirmReshade';
    actionPluginId = 'fivem-reshade-addon';
  }
  nextStepEl.classList.toggle('done', key === 'allDone');
  nextStepEl.innerHTML = `
    <div>
      <p class="next-step-title">${t(`nextstep.${key}.title`)}</p>
      <p class="next-step-desc">${t(`nextstep.${key}.desc`)}</p>
    </div>
    ${actionPluginId ? `<button class="btn btn-primary">${t('nextstep.action')}</button>` : ''}
  `;
  if (actionPluginId) {
    nextStepEl.querySelector('button').addEventListener('click', () => openPluginById(actionPluginId));
  }
}

function renderHealthCheck(h) {
  healthPanel.innerHTML = '';
  healthPanel.appendChild(
    healthRow({
      ok: h.gta5.ok,
      label: t('health.gta5'),
      detail: h.gta5.ok ? t('health.found', h.gta5.path) : t('health.notFound'),
    })
  );
  healthPanel.appendChild(
    healthRow({
      ok: h.fivem.ok,
      label: t('health.fivem'),
      detail: h.fivem.ok ? t('health.found', h.fivem.path) : t('health.notFound'),
    })
  );
  healthPanel.appendChild(
    healthRow({
      ok: h.reshadeInstalled.ok,
      label: t('health.reshadeInstalled'),
      detail: h.reshadeInstalled.ok ? t('health.done') : t('health.notDone'),
      actionPluginId: 'reshade-installer',
      quickAction: h.reshadeInstalled.ok
        ? {
            label: t('health.quickUninstall'),
            loadingLabel: t('health.quickUninstalling'),
            danger: true,
            onClick: () => quickReshadeAction('uninstall'),
          }
        : {
            label: t('health.quickInstall'),
            loadingLabel: t('health.quickInstalling'),
            onClick: () => quickReshadeAction('install'),
          },
    })
  );
  healthPanel.appendChild(
    healthRow({
      ok: h.reshadeConfirmed.ok,
      label: t('health.reshadeConfirmed'),
      detail: h.reshadeConfirmed.ok ? t('health.done') : t('health.notDone'),
      actionPluginId: 'fivem-reshade-addon',
    })
  );
  renderNextStep(h);
  updateReadinessRing(h);
}

// Drives the orbital ring's fill, tick highlighting, and center count from the
// actual health check result — this is real state, not a decorative animation.
function updateReadinessRing(h) {
  const checks = [h.gta5.ok, h.fivem.ok, h.reshadeInstalled.ok, h.reshadeConfirmed.ok];
  const total = checks.length;
  const done = checks.filter(Boolean).length;
  const ratio = done / total;

  const ringVal = document.getElementById('ring-val');
  if (ringVal) {
    const circumference = 214;
    ringVal.style.strokeDashoffset = String(circumference - circumference * ratio);
  }
  const ringNum = document.getElementById('ring-num');
  if (ringNum) ringNum.textContent = `${done}/${total}`;

  const ticks = document.querySelectorAll('#ring-ticks .ring-tick');
  const onCount = Math.round(ratio * ticks.length);
  ticks.forEach((tick, i) => tick.classList.toggle('on', i < onCount));

  const navTagHome = document.getElementById('nav-tag-home');
  if (navTagHome) navTagHome.textContent = `${done}/${total}`;
}

async function loadHealthCheck({ silent = false } = {}) {
  if (!silent) {
    healthPanel.innerHTML = `<div class="empty-state">${t('dashboard.checking')}</div>`;
    nextStepEl.innerHTML = '';
  }
  try {
    lastHealth = await window.toolbarApi.healthCheck();
    renderHealthCheck(lastHealth);
  } catch (err) {
    if (!silent) healthPanel.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

// Keeps the "installed or removed?" status live without the user having to reopen
// the Home tab — e.g. after running the real ReShade Setup.exe wizard manually,
// or deleting the dll by hand outside the app.
setInterval(() => {
  if (activeCategory === 'home') loadHealthCheck({ silent: true });
}, 6000);

// ---------------- live system monitor (CPU/RAM/GPU HUD gauges) ----------------
const sysmonGrid = document.getElementById('sysmon-grid');
const RING_CIRCUMFERENCE = 2 * Math.PI * 42;
let sysmonBuilt = false;

function sysmonGaugeMarkup(id, label) {
  return `
    <div class="sysmon-card" id="sysmon-${id}">
      <svg viewBox="0 0 100 100" class="sysmon-ring">
        <circle class="sysmon-ring-track" cx="50" cy="50" r="42"/>
        <circle class="sysmon-ring-val" id="sysmon-${id}-ring" cx="50" cy="50" r="42"
          stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}"/>
      </svg>
      <div class="sysmon-card-body">
        <div class="sysmon-pct mono" id="sysmon-${id}-pct">--%</div>
        <div class="sysmon-label">${label}</div>
        <div class="sysmon-detail mono" id="sysmon-${id}-detail"></div>
      </div>
    </div>
  `;
}

function buildSysmonGauges() {
  if (sysmonBuilt) return;
  sysmonBuilt = true;
  sysmonGrid.innerHTML =
    sysmonGaugeMarkup('cpu', 'CPU') + sysmonGaugeMarkup('ram', 'RAM') + sysmonGaugeMarkup('gpu', 'GPU');
}

function setSysmonGauge(id, percent, pctText, detailText) {
  const ring = document.getElementById(`sysmon-${id}-ring`);
  const pctEl = document.getElementById(`sysmon-${id}-pct`);
  const detailEl = document.getElementById(`sysmon-${id}-detail`);
  if (!ring) return;
  const clamped = Math.max(0, Math.min(100, percent));
  ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - clamped / 100);
  ring.classList.toggle('warn', clamped >= 80);
  pctEl.textContent = pctText;
  detailEl.textContent = detailText;
}

async function updateSysmonStats() {
  buildSysmonGauges();
  try {
    const stats = await window.toolbarApi.getSysStats();
    setSysmonGauge('cpu', stats.cpu, `${stats.cpu}%`, 'utilization');
    setSysmonGauge('ram', stats.ram.usedPercent, `${stats.ram.usedPercent}%`, `${stats.ram.usedGB.toFixed(1)} / ${stats.ram.totalGB.toFixed(1)} GB`);
    if (stats.gpu) {
      setSysmonGauge('gpu', stats.gpu.utilPercent, `${stats.gpu.utilPercent}%`, `${stats.gpu.tempC}°C · ${(stats.gpu.memUsedMB / 1024).toFixed(1)}/${(stats.gpu.memTotalMB / 1024).toFixed(1)} GB`);
    } else {
      setSysmonGauge('gpu', 0, '—', t('sysmon.noGpu'));
    }
  } catch {
    // silent — a live HUD widget shouldn't spam toasts if one poll fails
  }
}

setInterval(() => {
  if (activeCategory === 'home') updateSysmonStats();
}, 2000);

function showView(category) {
  const isHome = category === 'home';
  const isConnect = category === 'connect';
  const isApps = category === 'apps';
  viewDashboard.classList.toggle('hidden', !isHome);
  viewConnect.classList.toggle('hidden', !isConnect);
  viewApps.classList.toggle('hidden', !isApps);
  viewTools.classList.toggle('hidden', isHome || isConnect || isApps);
  if (isHome) {
    loadHealthCheck();
    updateSysmonStats();
  }
  else if (isConnect) loadServers();
  else if (isApps) loadApps();
  else renderCards();
}

async function loadPlugins() {
  try {
    allPlugins = await window.toolbarApi.listPlugins();
    pluginCount.textContent = t('header.count', allPlugins.length);
    renderCards();
    renderDashboardGraphics();
  } catch (err) {
    console.error('loadPlugins failed', err);
    pluginCount.textContent = t('header.loadError', err.message);
  }
}

// --- Sidebar nav ---
const navList = document.getElementById('nav-list');
const navIndicator = document.getElementById('nav-indicator');

function positionNavIndicator(btn) {
  navIndicator.style.transform = `translateY(${btn.offsetTop}px)`;
}

// Drag-to-reorder: restore whatever order was saved last time, then keep saving it as
// the user drags nav items around. Categories not in the saved order (a future update
// added one) just keep their original relative position, appended at the end.
try {
  const savedNavOrder = JSON.parse(localStorage.getItem('toolbar.navOrder') || 'null');
  if (Array.isArray(savedNavOrder)) {
    const items = [...navList.querySelectorAll('.nav-item')];
    for (const category of savedNavOrder) {
      const item = items.find((el) => el.dataset.category === category);
      if (item) navList.appendChild(item);
    }
  }
} catch {}

makeSortable(
  navList,
  '.nav-item',
  (el) => el.dataset.category,
  (order) => {
    localStorage.setItem('toolbar.navOrder', JSON.stringify(order));
    positionNavIndicator(navList.querySelector('.nav-item.active'));
  },
  'y'
);

navList.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  const category = btn.dataset.category;
  const alreadyThere = category === activeCategory;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  btn.classList.add('active');
  activeCategory = category;
  positionNavIndicator(btn);
  // Re-clicking the tab you're already on shouldn't re-trigger a fresh disk scan
  // (health check) or IPC round-trip (servers list) — that's what was causing the
  // stutter when mashing the sidebar. Just re-show the already-loaded view.
  if (alreadyThere) return;
  showView(activeCategory);
});

document.getElementById('search').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  renderCards();
});

// --- Titlebar window controls ---
document.getElementById('btn-min').addEventListener('click', () => window.toolbarApi.minimize());
document.getElementById('btn-close').addEventListener('click', () => window.toolbarApi.close());

// --- Modal ---
const modalOverlay = document.getElementById('modal-overlay');
const modalInputs = document.getElementById('modal-inputs');
const modalResults = document.getElementById('modal-results');
const modalItems = document.getElementById('modal-items');
const modalTotal = document.getElementById('modal-total');
const modalWarnings = document.getElementById('modal-warnings');
const modalProgress = document.getElementById('modal-progress');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const btnDryrun = document.getElementById('btn-dryrun');
const btnConfirm = document.getElementById('btn-confirm');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const stepLine = document.getElementById('step-line');

function resetSteps() {
  step1.classList.add('active');
  step1.classList.remove('done');
  step2.classList.remove('active', 'done');
  stepLine.classList.remove('filled');
}

function advanceSteps() {
  step1.classList.add('done');
  step2.classList.add('active');
  stepLine.classList.add('filled');
}

function openModal(plugin) {
  currentPlugin = plugin;
  currentParams = {};

  document.getElementById('modal-icon').innerHTML = iconMarkup(plugin.icon);
  document.getElementById('modal-name').textContent = L(plugin.name);
  document.getElementById('modal-desc').textContent = L(plugin.description);

  modalResults.classList.add('hidden');
  modalProgress.classList.add('hidden');
  resetSteps();
  btnConfirm.disabled = true;
  btnConfirm.classList.toggle('btn-danger', !!plugin.dangerous);
  btnConfirm.classList.toggle('btn-primary', !plugin.dangerous);
  modalInputs.innerHTML = '';

  for (const input of plugin.inputs || []) {
    const field = document.createElement('div');
    field.className = 'input-field';

    if (input.type === 'file-picker' || input.type === 'folder-picker') {
      const isFolder = input.type === 'folder-picker';
      field.innerHTML = `
        <label>${L(input.label)}</label>
        <div class="file-picker-row">
          <input type="text" readonly placeholder="${isFolder ? t('browse.folderPlaceholder') : t('browse.filePlaceholder')}" />
          <button class="btn btn-ghost btn-small" data-role="browse">${isFolder ? t('browse.folder') : t('browse.file')}</button>
          ${input.detectable ? `<button class="btn btn-ghost btn-small" data-role="detect">${L(input.detectLabel) || t('browse.detectDefault')}</button>` : ''}
        </div>
        <p class="field-status" hidden></p>
        ${input.hint ? `<p class="field-hint">${L(input.hint)}</p>` : ''}
      `;
      const textInput = field.querySelector('input');
      const statusEl = field.querySelector('.field-status');

      const setStatus = (msg, ok) => {
        statusEl.hidden = !msg;
        statusEl.textContent = msg || '';
        statusEl.classList.toggle('ok', !!ok);
        statusEl.classList.toggle('bad', msg ? !ok : false);
      };

      field.querySelector('[data-role="browse"]').addEventListener('click', async () => {
        const picked = isFolder ? await window.toolbarApi.pickFolder() : await window.toolbarApi.pickFile(input.filters);
        if (picked) {
          textInput.value = picked;
          currentParams[input.key] = picked;
          setStatus('', false);
        }
      });

      // Feedback lives in the inline field-status line only — a toast here would pile
      // up into a wall of duplicates if someone clicks "detect" more than once.
      const runDetect = async () => {
        const result = await window.toolbarApi.detect(plugin.id, input.key, currentParams);
        if (result.path) {
          textInput.value = result.path;
          currentParams[input.key] = result.path;
        }
        setStatus(result.message, !!result.path);
      };

      const detectBtn = field.querySelector('[data-role="detect"]');
      if (detectBtn) {
        detectBtn.addEventListener('click', runDetect);
        runDetect(); // auto-detect once when the card opens, so the field never shows a stale guess
      }
    } else if (input.type === 'select') {
      const options = input.options.map((o) => `<option value="${o.value}">${L(o.label)}</option>`).join('');
      field.innerHTML = `<label>${L(input.label)}</label><select>${options}</select>`;
      const select = field.querySelector('select');
      if (input.default) select.value = input.default;
      currentParams[input.key] = select.value;
      select.addEventListener('change', () => {
        currentParams[input.key] = select.value;
      });
    } else if (input.type === 'checkbox-group') {
      const label = document.createElement('label');
      label.textContent = L(input.label);
      field.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'checkbox-group-actions';
      actions.innerHTML = `<button type="button" class="btn btn-ghost btn-small" data-role="toggle-all">${t('group.checkAll')}</button>`;
      field.appendChild(actions);

      currentParams[input.key] = input.options.filter((o) => o.default).map((o) => o.value);
      const checkboxes = [];
      for (const opt of input.options) {
        const row = document.createElement('div');
        row.className = 'checkbox-row';
        const id = `${input.key}-${opt.value}`;
        row.innerHTML = `<input type="checkbox" id="${id}" ${opt.default ? 'checked' : ''}/> <label for="${id}">${L(opt.label)}</label> <span class="tweak-status" data-status-for="${opt.value}"></span>`;
        const checkbox = row.querySelector('input');
        checkboxes.push(checkbox);
        checkbox.addEventListener('change', (e) => {
          const set = new Set(currentParams[input.key]);
          if (e.target.checked) set.add(opt.value);
          else set.delete(opt.value);
          currentParams[input.key] = Array.from(set);
        });
        field.appendChild(row);
      }

      const toggleBtn = actions.querySelector('[data-role="toggle-all"]');
      const setAll = (checked) => {
        currentParams[input.key] = checked ? input.options.map((o) => o.value) : [];
        for (const cb of checkboxes) cb.checked = checked;
        toggleBtn.textContent = checked ? t('group.uncheckAll') : t('group.checkAll');
      };
      toggleBtn.addEventListener('click', () => setAll(!checkboxes.every((cb) => cb.checked)));
      toggleBtn.textContent = checkboxes.every((cb) => cb.checked) ? t('group.uncheckAll') : t('group.checkAll');
      // Fire-and-forget: fills in "already applied / not yet" badges once the check
      // finishes. Plugins without checkStatus just get an empty map back.
      window.toolbarApi
        .checkStatus(plugin.id)
        .then((statusMap) => {
          for (const [key, applied] of Object.entries(statusMap || {})) {
            const el = field.querySelector(`[data-status-for="${key}"]`);
            if (!el || applied === null) continue;
            el.textContent = applied ? t('tweak.applied') : t('tweak.notApplied');
            el.classList.toggle('ok', applied);
            el.classList.toggle('bad', !applied);
          }
        })
        .catch((err) => console.error(`checkStatus(${plugin.id}) failed:`, err));
    } else if (input.type === 'checkbox') {
      currentParams[input.key] = !!input.default;
      const id = `chk-${input.key}`;
      field.innerHTML = `
        <div class="checkbox-row">
          <input type="checkbox" id="${id}" ${input.default ? 'checked' : ''}/>
          <label for="${id}">${L(input.label)}</label>
        </div>
      `;
      field.querySelector('input').addEventListener('change', (e) => {
        currentParams[input.key] = e.target.checked;
      });
    } else if (input.type === 'text') {
      field.innerHTML = `<label>${L(input.label)}</label><input type="text" placeholder="${L(input.placeholder) || ''}" />`;
      const textInput = field.querySelector('input');
      currentParams[input.key] = '';
      textInput.addEventListener('input', () => {
        currentParams[input.key] = textInput.value.trim();
      });
      if (input.hint) {
        const hint = document.createElement('p');
        hint.className = 'field-hint';
        hint.textContent = L(input.hint);
        field.appendChild(hint);
      }
    } else if (input.type === 'link') {
      field.innerHTML = `<label>${L(input.label)}</label><button class="btn btn-ghost btn-small">${L(input.buttonText)}</button>`;
      field.querySelector('button').addEventListener('click', () => window.toolbarApi.openExternal(input.url));
    }
    modalInputs.appendChild(field);
  }

  modalOverlay.classList.add('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
  currentPlugin = null;
}

document.getElementById('modal-close').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

btnDryrun.addEventListener('click', async () => {
  if (!currentPlugin) return;
  const originalLabel = btnDryrun.textContent;
  btnDryrun.textContent = t('modal.dryrunLoading');
  btnDryrun.disabled = true;
  try {
    const result = await window.toolbarApi.dryRun(currentPlugin.id, currentParams);
    modalResults.classList.remove('hidden');
    modalItems.innerHTML =
      (result.items || [])
        .map(
          (i, idx) =>
            `<li style="animation-delay:${idx * 0.06}s"><span class="item-path">${i.path}</span><span class="item-action">${i.action}${
              i.sizeBytes ? ' · ' + formatBytes(i.sizeBytes) : ''
            }</span></li>`
        )
        .join('') || `<li><span class="item-path">—</span></li>`;
    modalTotal.textContent = result.totalSizeBytes ? t('modal.totalSize', formatBytes(result.totalSizeBytes)) : '';
    modalWarnings.innerHTML = (result.warnings || []).map((w) => `<li>⚠ ${w}</li>`).join('');
    if (!result.blocked) advanceSteps();
    btnConfirm.disabled = !!result.blocked;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btnDryrun.textContent = originalLabel;
    btnDryrun.disabled = false;
  }
});

btnConfirm.addEventListener('click', async () => {
  if (!currentPlugin) return;
  const originalLabel = btnConfirm.textContent;
  btnConfirm.textContent = t('modal.confirmLoading');
  btnConfirm.disabled = true;

  const pluginId = currentPlugin.id;
  const hasProgressSupport = typeof window.toolbarApi.onPluginProgress === 'function';
  let unsubscribe = null;
  if (hasProgressSupport) {
    modalProgress.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressLabel.textContent = '';
    unsubscribe = window.toolbarApi.onPluginProgress((id, evt) => {
      if (id !== pluginId) return;
      const pct = Math.round((evt.done / evt.total) * 100);
      progressFill.style.width = `${pct}%`;
      progressLabel.textContent = `${evt.done}/${evt.total} (${pct}%)`;
    });
  }

  try {
    const result = await window.toolbarApi.run(pluginId, currentParams);
    if (hasProgressSupport) {
      progressFill.style.width = '100%';
      progressLabel.textContent = t('modal.progressDone');
    }
    toast((result.message || '').replace(/\n/g, '<br/>'), result.success ? 'success' : 'error');
    if (result.success) closeModal();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (unsubscribe) unsubscribe();
    btnConfirm.textContent = originalLabel;
    btnConfirm.disabled = false;
    setTimeout(() => modalProgress.classList.add('hidden'), 1200);
  }
});

// --- History drawer ---
const historyOverlay = document.getElementById('history-overlay');
const historyList = document.getElementById('history-list');

async function openHistory() {
  historyOverlay.classList.add('open');
  const backups = await window.toolbarApi.listBackups();
  if (backups.length === 0) {
    historyList.innerHTML = `<div class="empty-state">${t('history.empty')}</div>`;
    return;
  }
  historyList.innerHTML = '';
  for (const b of backups) {
    const item = document.createElement('div');
    item.className = 'backup-item';
    const date = new Date(b.timestamp).toLocaleString(getLang() === 'th' ? 'th-TH' : 'en-US');
    item.innerHTML = `
      <div class="backup-item-label">${b.label}</div>
      <div class="backup-item-meta">${date} · ${formatBytes(b.sizeBytes)}</div>
      <div class="backup-item-path">${b.originalPath}</div>
      <button class="btn btn-ghost btn-small">${t('history.restore')}</button>
    `;
    item.querySelector('button').addEventListener('click', async () => {
      const res = await window.toolbarApi.restoreBackup(b.id);
      if (res.success) {
        toast(t('history.restoredToast'), 'success');
        openHistory();
      } else {
        toast(res.message, 'error');
      }
    });
    historyList.appendChild(item);
  }
}

document.getElementById('btn-history').addEventListener('click', openHistory);
document.getElementById('history-close').addEventListener('click', () => historyOverlay.classList.remove('open'));
historyOverlay.addEventListener('click', (e) => {
  if (e.target === historyOverlay) historyOverlay.classList.remove('open');
});

// ---------------- servers (connect view) ----------------
let allServers = [];
let editingServerId = null;
let currentLogo = '';

const serverGrid = document.getElementById('server-grid');
const serverCount = document.getElementById('server-count');

// Drag-to-reorder: the dropped order is written straight back to servers.json (that
// array order is the source of truth the cards render from), and allServers is updated
// in place so the dashboard's own server list — a separate render — matches immediately.
makeSortable(
  serverGrid,
  '.tool-card[data-server-id]',
  (el) => el.dataset.serverId,
  (order) => {
    const byId = new Map(allServers.map((s) => [s.id, s]));
    allServers = order.map((id) => byId.get(id)).filter(Boolean);
    renderDashboardServers();
    window.toolbarApi.reorderServers(order).catch((err) => toast(err.message, 'error'));
  },
  'x'
);
const serverModalOverlay = document.getElementById('server-modal-overlay');
const serverModalTitle = document.getElementById('server-modal-title');
const serverNameInput = document.getElementById('server-name');
const serverModeSelect = document.getElementById('server-mode');
const serverAddressInput = document.getElementById('server-address');
const serverLauncherField = document.getElementById('server-launcher-field');
const serverLauncherPathInput = document.getElementById('server-launcher-path');
const serverArgsField = document.getElementById('server-args-field');
const serverArgsInput = document.getElementById('server-args');
const serverAutoclickField = document.getElementById('server-autoclick-field');
const serverAutoclickEnabled = document.getElementById('server-autoclick-enabled');
const serverAutoclickDelay = document.getElementById('server-autoclick-delay');
const serverAutoclickStatus = document.getElementById('server-autoclick-status');
const serverLogoPreview = document.getElementById('server-logo-preview');
let currentAutoClickPoint = null;
const btnDeleteServer = document.getElementById('btn-delete-server');
const btnSaveServer = document.getElementById('btn-save-server');

function renderServerCards() {
  serverCount.textContent = t('connect.count', allServers.length);
  serverGrid.innerHTML = '';
  if (allServers.length === 0) {
    serverGrid.innerHTML = `<div class="empty-state">${t('connect.empty')}</div>`;
    return;
  }
  for (const server of allServers) {
    const card = document.createElement('div');
    card.className = 'tool-card';
    card.draggable = true;
    card.dataset.serverId = server.id;
    card.innerHTML = `
      <span class="card-corner cc-tl"></span><span class="card-corner cc-br"></span>
      <span class="drag-handle server-card-drag" title="${t('connect.dragToReorder')}">${iconMarkup('grip')}</span>
      <div class="server-card-top">
        <div class="server-card-logo">${server.logo ? `<img src="${server.logo}" alt="" />` : iconMarkup('tool-launch')}</div>
        <button class="server-card-edit" data-role="edit" title="${t('connect.edit')}">${iconMarkup('edit')}</button>
      </div>
      <h3>${server.name}</h3>
      <p class="server-card-address">${server.address || '—'}</p>
      <p class="server-card-status checking" data-role="status">${t('connect.status.checking')}</p>
      <div class="server-card-footer">
        ${server.mode === 'customLauncher' ? `<span class="tag">${t('connect.launcherTag')}</span>` : '<span></span>'}
        <button class="btn btn-primary btn-small btn-play" data-role="play">${iconMarkup('nav-connect')} ${t('connect.play')}</button>
      </div>
    `;
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
    card.querySelector('[data-role="edit"]').addEventListener('click', () => openServerModal(server));
    const playBtn = card.querySelector('[data-role="play"]');
    playBtn.addEventListener('click', () => {
      window.toolbarApi
        .launchServer(server)
        .then((result) => toast(result.message, result.success ? 'success' : 'error'))
        .catch((err) => toast(err.message, 'error'));
    });
    serverGrid.appendChild(card);

    // Even a "custom launcher" server usually still has a real FiveM address filled
    // in (it's what fills {address} in the launch args) — so it's worth pinging too.
    const statusEl = card.querySelector('[data-role="status"]');
    if (!server.address) {
      statusEl.remove();
    } else {
      checkServerStatus(server.address, statusEl);
    }
  }
}

// Fire-and-forget ping so the card list renders instantly and each status pill
// fills in as its own request comes back — a slow/offline server shouldn't stall
// the rest of the list.
// Switching into "เข้าเกม" re-renders both the Connect grid and the dashboard's server
// rows, and each render kicks off a live network check per server — without this cache,
// bouncing between tabs re-fires those HTTP calls every single time, which is exactly
// the kind of repeated work that reads as "stuck/janky". A short TTL keeps status fresh
// without re-querying on every re-render.
const serverStatusCache = new Map();
const SERVER_STATUS_TTL_MS = 15000;

function applyServerStatus(statusEl, status) {
  statusEl.classList.remove('checking');
  if (status && status.online) {
    statusEl.classList.add('online');
    statusEl.textContent =
      status.maxPlayers != null
        ? t('connect.status.online', status.players, status.maxPlayers)
        : t('connect.status.onlineUnknownMax', status.players);
  } else {
    statusEl.classList.add('offline');
    statusEl.textContent = (status && status.message) || t('connect.status.offline');
  }
}

async function checkServerStatus(address, statusEl) {
  const cached = serverStatusCache.get(address);
  if (cached && Date.now() - cached.at < SERVER_STATUS_TTL_MS) {
    applyServerStatus(statusEl, cached.status);
    return;
  }
  try {
    const status = await window.toolbarApi.serverStatus(address);
    serverStatusCache.set(address, { status, at: Date.now() });
    if (!statusEl.isConnected) return; // card may have been re-rendered/removed by now
    applyServerStatus(statusEl, status);
  } catch {
    if (!statusEl.isConnected) return;
    statusEl.classList.remove('checking');
    statusEl.classList.add('offline');
    statusEl.textContent = t('connect.status.offline');
  }
}

async function loadServers({ silent = false } = {}) {
  // Only show the loading placeholder before we've ever loaded anything — once
  // allServers is populated, re-visiting the tab should keep showing the existing
  // cards while it refreshes, not flash back to "checking..." every time.
  if (!silent && allServers.length === 0) serverGrid.innerHTML = `<div class="empty-state">${t('dashboard.checking')}</div>`;
  try {
    allServers = await window.toolbarApi.listServers();
    renderServerCards();
    renderDashboardServers();
  } catch (err) {
    if (!silent) serverGrid.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function updateModeFieldsVisibility() {
  const isLauncher = serverModeSelect.value === 'customLauncher';
  serverLauncherField.classList.toggle('hidden', !isLauncher);
  serverArgsField.classList.toggle('hidden', !isLauncher);
  serverAutoclickField.classList.toggle('hidden', !isLauncher);
}

function renderAutoClickStatus() {
  serverAutoclickStatus.textContent = currentAutoClickPoint
    ? t('connect.form.captureClickDone', currentAutoClickPoint.x, currentAutoClickPoint.y)
    : '';
}

function openServerModal(server) {
  editingServerId = server ? server.id : null;
  currentLogo = server ? server.logo || '' : '';
  serverModalTitle.textContent = server ? t('connect.edit') : t('connect.addServer');
  serverNameInput.value = server ? server.name : '';
  serverModeSelect.value = server ? server.mode : 'quickconnect';
  serverAddressInput.value = server ? server.address : '';
  serverLauncherPathInput.value = server ? server.launcherPath || '' : '';
  serverArgsInput.value = server ? server.launchArgs || '' : '';
  serverAutoclickEnabled.checked = server ? !!server.autoClickEnabled : false;
  serverAutoclickDelay.value = server && server.autoClickDelayMs ? server.autoClickDelayMs : 3000;
  currentAutoClickPoint =
    server && Number.isFinite(server.autoClickX) && Number.isFinite(server.autoClickY)
      ? { x: server.autoClickX, y: server.autoClickY }
      : null;
  renderAutoClickStatus();
  btnDeleteServer.classList.toggle('hidden', !server);
  renderLogoPreview();
  updateModeFieldsVisibility();
  serverModalOverlay.classList.add('open');
}

function renderLogoPreview() {
  serverLogoPreview.innerHTML = currentLogo ? `<img src="${currentLogo}" alt="" />` : iconMarkup('tool-launch');
  document.getElementById('server-logo-clear').classList.toggle('hidden', !currentLogo);
}

function closeServerModal() {
  serverModalOverlay.classList.remove('open');
  editingServerId = null;
}

document.getElementById('btn-add-server').addEventListener('click', () => openServerModal(null));

document.getElementById('btn-export-settings').addEventListener('click', async () => {
  try {
    const result = await window.toolbarApi.exportSettings();
    if (result.canceled) return;
    if (result.success) toast(t('connect.exportOk', result.filePath), 'success');
    else toast(result.message, 'error');
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('btn-import-settings').addEventListener('click', async () => {
  try {
    const result = await window.toolbarApi.importSettings();
    if (result.canceled) return;
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    const tweakNote = result.appliedTweaks.length ? t('connect.importTweakNote', result.appliedTweaks.length) : '';
    toast(t('connect.importOk', result.added, result.updated) + tweakNote, 'success');
    await loadServers();
  } catch (err) {
    toast(err.message, 'error');
  }
});
document.getElementById('server-modal-close').addEventListener('click', closeServerModal);
serverModalOverlay.addEventListener('click', (e) => {
  if (e.target === serverModalOverlay) closeServerModal();
});
serverModeSelect.addEventListener('change', updateModeFieldsVisibility);

document.getElementById('server-logo-pick').addEventListener('click', async () => {
  const result = await window.toolbarApi.pickImage();
  if (result && typeof result === 'string') {
    currentLogo = result;
    renderLogoPreview();
  } else if (result && result.error) {
    toast(result.error, 'error');
  }
});
document.getElementById('server-logo-clear').addEventListener('click', () => {
  currentLogo = '';
  renderLogoPreview();
});

document.getElementById('server-launcher-pick').addEventListener('click', async () => {
  const picked = await window.toolbarApi.pickFile([{ name: 'Executable', extensions: ['exe'] }]);
  if (picked) serverLauncherPathInput.value = picked;
});

const serverLookupStatus = document.getElementById('server-lookup-status');

document.getElementById('server-lookup').addEventListener('click', async () => {
  const btn = document.getElementById('server-lookup');
  const address = serverAddressInput.value.trim();
  if (!address) {
    serverLookupStatus.hidden = false;
    serverLookupStatus.classList.remove('ok');
    serverLookupStatus.classList.add('bad');
    serverLookupStatus.textContent = t('connect.form.lookupNeedsAddress');
    return;
  }
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('connect.form.lookupLoading');
  serverLookupStatus.hidden = false;
  serverLookupStatus.classList.remove('bad', 'ok');
  serverLookupStatus.textContent = t('connect.status.checking');
  try {
    const info = await window.toolbarApi.serverStatus(address);
    if (!info || !info.online) {
      serverLookupStatus.classList.add('bad');
      serverLookupStatus.textContent = (info && info.message) || t('connect.form.lookupFailed');
      return;
    }
    if (info.hostname && !serverNameInput.value.trim()) serverNameInput.value = info.hostname;
    if (info.iconDataUri && !currentLogo) {
      currentLogo = info.iconDataUri;
      renderLogoPreview();
    }
    serverLookupStatus.classList.add('ok');
    serverLookupStatus.textContent =
      info.maxPlayers != null ? t('connect.status.online', info.players, info.maxPlayers) : t('connect.status.onlineUnknownMax', info.players);
  } catch {
    serverLookupStatus.classList.add('bad');
    serverLookupStatus.textContent = t('connect.form.lookupFailed');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

document.getElementById('server-autoclick-capture').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const original = btn.textContent;
  btn.disabled = true;
  // Hide our own window so it's not in the way while the user moves the mouse over
  // the launcher — we sample wherever the cursor ends up, no click needed here.
  window.toolbarApi.minimize();
  try {
    for (let sec = 3; sec >= 1; sec--) {
      serverAutoclickStatus.textContent = `${t('connect.form.captureClickWaiting')} ${sec}`;
      await wait(1000);
    }
    const result = await window.toolbarApi.sampleCursorPosition();
    if (result.success) {
      currentAutoClickPoint = { x: result.x, y: result.y };
    } else {
      toast(result.message, 'error');
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    renderAutoClickStatus();
    btn.disabled = false;
    btn.textContent = original;
  }
});

btnSaveServer.addEventListener('click', async () => {
  const name = serverNameInput.value.trim();
  if (!name) {
    toast(t('connect.errors.name'), 'error');
    return;
  }
  const mode = serverModeSelect.value;
  if (mode === 'customLauncher' && !serverLauncherPathInput.value.trim()) {
    toast(t('connect.errors.launcher'), 'error');
    return;
  }
  if (mode === 'customLauncher' && serverAutoclickEnabled.checked && !currentAutoClickPoint) {
    toast(t('connect.errors.autoClickPosition'), 'error');
    return;
  }
  const server = {
    id: editingServerId,
    name,
    mode,
    address: serverAddressInput.value.trim(),
    launcherPath: serverLauncherPathInput.value.trim(),
    launchArgs: serverArgsInput.value.trim(),
    logo: currentLogo,
    autoClickEnabled: mode === 'customLauncher' && serverAutoclickEnabled.checked,
    autoClickDelayMs: Number(serverAutoclickDelay.value) || 3000,
    autoClickX: currentAutoClickPoint ? currentAutoClickPoint.x : null,
    autoClickY: currentAutoClickPoint ? currentAutoClickPoint.y : null,
  };
  const result = await window.toolbarApi.saveServer(server);
  if (result.success) {
    closeServerModal();
    loadServers();
  } else {
    toast(result.message, 'error');
  }
});

btnDeleteServer.addEventListener('click', async () => {
  if (!editingServerId) return;
  if (!confirm(t('connect.deleteConfirm'))) return;
  await window.toolbarApi.deleteServer(editingServerId);
  closeServerModal();
  loadServers();
});

// ---------------- apps (app store view) ----------------
const appsGrid = document.getElementById('apps-grid');
const appsCount = document.getElementById('apps-count');
let appCatalog = [];
// Survives renderAppCards() rebuilding the grid (e.g. switching tabs away and back
// mid-install) — without this, the in-flight install's completion handler would update
// a detached card no one can see, the fresh card would show "Install" again as if
// nothing were happening, and clicking it would kick off a second concurrent install
// of the same package.
const installingAppIds = new Set();

// Real brand logos from simpleicons.org's CDN, or a favicon fallback for brands it
// doesn't carry (no bundled assets to maintain either way). If the logo URL 404s for
// any reason, falls back to a generic tool icon rather than showing a broken image.
function appLogoMarkup(app) {
  if (!app.iconUrl) return iconMarkup('tool-generic');
  const id = `app-logo-${app.id}`;
  setTimeout(() => {
    const img = document.getElementById(id);
    if (img) img.addEventListener('error', () => { img.outerHTML = iconMarkup('tool-generic'); }, { once: true });
  }, 0);
  return `<img id="${id}" src="${app.iconUrl}" alt="" />`;
}

async function loadApps() {
  if (appsGrid.children.length === 0) appsGrid.innerHTML = `<div class="empty-state">${t('dashboard.checking')}</div>`;
  try {
    appCatalog = await window.toolbarApi.listApps();
    appsCount.textContent = t('apps.count', appCatalog.length);
    renderAppCards();
    const status = await window.toolbarApi.checkAppsInstalled();
    for (const app of appCatalog) {
      if (installingAppIds.has(app.id)) continue; // don't clobber an install in progress
      const card = appsGrid.querySelector(`[data-app-id="${app.id}"]`);
      if (card) setAppCardState(card, status[app.id] ? 'installed' : 'idle');
    }
  } catch (err) {
    appsGrid.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function setAppCardState(card, state) {
  const btn = card.querySelector('[data-role="install"]');
  card.classList.toggle('installed', state === 'installed');
  card.querySelector('.app-card-progress').classList.toggle('hidden', state !== 'installing');
  btn.disabled = state === 'installing';
  btn.textContent = state === 'installing' ? t('apps.installing') : state === 'installed' ? t('apps.reinstall') : t('apps.install');
}

function renderAppCards() {
  appsGrid.innerHTML = '';
  for (const app of appCatalog) {
    const card = document.createElement('div');
    card.className = 'tool-card app-card';
    card.dataset.appId = app.id;
    card.innerHTML = `
      <span class="card-corner cc-tl"></span><span class="card-corner cc-br"></span>
      <div class="app-card-logo">${appLogoMarkup(app)}</div>
      <h3>${app.name}</h3>
      <p class="app-card-desc">${L(app.description)}</p>
      <div class="app-card-progress hidden"><div class="app-card-progress-fill"></div></div>
      <button class="btn btn-primary btn-small" data-role="install">${t('apps.install')}</button>
    `;
    if (installingAppIds.has(app.id)) setAppCardState(card, 'installing');
    card.querySelector('[data-role="install"]').addEventListener('click', async () => {
      installingAppIds.add(app.id);
      setAppCardState(card, 'installing');
      try {
        const result = await window.toolbarApi.installApp(app.id);
        toast(result.message, result.success ? 'success' : 'error');
        installingAppIds.delete(app.id);
        // Re-query rather than reuse `card` — a tab switch in the meantime would have
        // rebuilt the grid and left this closure holding a detached, invisible node.
        const liveCard = appsGrid.querySelector(`[data-app-id="${app.id}"]`);
        if (liveCard) setAppCardState(liveCard, result.success ? 'installed' : 'idle');
      } catch (err) {
        installingAppIds.delete(app.id);
        toast(err.message, 'error');
        const liveCard = appsGrid.querySelector(`[data-app-id="${app.id}"]`);
        if (liveCard) setAppCardState(liveCard, 'idle');
      }
    });
    appsGrid.appendChild(card);
  }
}

// ---------------- HUD chrome: particle field + targeting reticle + panel tilt ----------------
function initHudChrome() {
  const canvas = document.getElementById('particles');
  const ctx = canvas.getContext('2d');
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);
  // Grid-bucketed so connection checks only compare nearby particles instead of every
  // pair (O(n) in practice instead of O(n^2)), and every line/dot is batched into a
  // single path + one stroke()/fill() call — many small canvas calls (a strokeStyle
  // reassignment and a stroke() per segment) is what was actually causing the jank,
  // not the particle count itself.
  const N = 70;
  const CONNECT_DIST = 110;
  const CELL = CONNECT_DIST;
  const pts = Array.from({ length: N }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.12,
    vy: (Math.random() - 0.5) * 0.12,
  }));
  function drawParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cols = Math.max(1, Math.ceil(canvas.width / CELL));
    const rows = Math.max(1, Math.ceil(canvas.height / CELL));
    const buckets = new Map();
    const cellOf = (p) => {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / CELL)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / CELL)));
      return cy * cols + cx;
    };
    for (const p of pts) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      const key = cellOf(p);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }

    ctx.strokeStyle = 'rgba(47,227,255,.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of pts) {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / CELL)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / CELL)));
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const neighbors = buckets.get(ny * cols + nx);
          if (!neighbors) continue;
          for (const q of neighbors) {
            if (q === p) continue;
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            if (dx * dx + dy * dy < CONNECT_DIST * CONNECT_DIST) {
              ctx.moveTo(p.x, p.y);
              ctx.lineTo(q.x, q.y);
            }
          }
        }
      }
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(47,227,255,.4)';
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(p.x + 1.1, p.y);
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  const reticle = document.getElementById('reticle');
  const reticleDot = document.getElementById('reticle-dot');
  const shell = document.querySelector('.app-shell');
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let dotX = mouseX;
  let dotY = mouseY;
  let tiltX = 0;
  let tiltY = 0;
  let targetTiltX = 0;
  let targetTiltY = 0;
  let overHot = false;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    overHot = !!e.target.closest('.btn, .tool-card, .nav-item, .health-row-actions button, .server-card-edit, [data-role="play"]');
    const px = mouseX / window.innerWidth - 0.5;
    const py = mouseY / window.innerHeight - 0.5;
    targetTiltY = px * 4.5;
    targetTiltX = -py * 4.5;
  });

  let frameCount = 0;
  function loop() {
    frameCount++;
    // Particle field is the most expensive part of this loop — halving its rate to
    // ~30fps is imperceptible for slow-drifting dots but meaningfully cuts main-thread
    // work, leaving more headroom for DOM rebuilds when switching categories quickly.
    if (frameCount % 2 === 0) drawParticles();

    dotX += (mouseX - dotX) * 0.35;
    dotY += (mouseY - dotY) * 0.35;
    reticleDot.style.transform = `translate(${dotX}px,${dotY}px) translate(-50%,-50%)`;
    reticleDot.classList.add('show');

    reticle.style.transform = `translate(${mouseX}px,${mouseY}px) translate(-50%,-50%)`;
    reticle.classList.add('show');
    reticle.classList.toggle('hot', overHot);

    const prevTiltX = tiltX;
    const prevTiltY = tiltY;
    tiltX += (targetTiltX - tiltX) * 0.06;
    tiltY += (targetTiltY - tiltY) * 0.06;
    // Skip the style write entirely once the tilt has settled — an unchanging inline
    // transform still forces a style recalc every frame if reassigned, for nothing.
    if (shell && (Math.abs(tiltX - prevTiltX) > 0.002 || Math.abs(tiltY - prevTiltY) > 0.002)) {
      shell.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
    }

    requestAnimationFrame(loop);
  }
  loop();
}

// Builds the 28 tick marks around the readiness ring once; how many read "on" (cyan)
// vs. dim is updated per health check in renderHealthCheck below.
function buildRingTicks() {
  const g = document.getElementById('ring-ticks');
  if (!g) return;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2 - Math.PI / 2;
    const r1 = 38.5;
    const r2 = i % 7 === 0 ? 35.2 : 36.6;
    const x1 = 50 + Math.cos(a) * r1;
    const y1 = 50 + Math.sin(a) * r1;
    const x2 = 50 + Math.cos(a) * r2;
    const y2 = 50 + Math.sin(a) * r2;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'ring-tick');
    line.dataset.index = i;
    g.appendChild(line);
  }
}

// ---------------- init ----------------
mountIcons();
applyStaticI18n();
positionNavIndicator(navList.querySelector('.nav-item.active'));
buildRingTicks();
initHudChrome();
document.querySelector('.app-shell').classList.add('glitch');
loadPlugins();
loadHealthCheck();
loadServers({ silent: true });
updateSysmonStats();
