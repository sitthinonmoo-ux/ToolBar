let allPlugins = [];
let activeCategory = 'home';
let searchTerm = '';
let currentPlugin = null;
let currentParams = {};
// Set by the checkbox-group renderer when the open card has status badges; null for every
// other card. Re-read after a run so the badges reflect the machine, not the pre-run guess.
let refreshStatusBadges = null;
let lastHealth = null;

const grid = document.getElementById('card-grid');
const pluginCount = document.getElementById('plugin-count');
const toastStack = document.getElementById('toast-stack');
const viewDashboard = document.getElementById('view-dashboard');
const viewTools = document.getElementById('view-tools');
const viewConnect = document.getElementById('view-connect');
const viewApps = document.getElementById('view-apps');
const viewDrivers = document.getElementById('view-drivers');
const healthPanel = document.getElementById('health-panel');
const nextStepEl = document.getElementById('next-step');
const themePanel = document.getElementById('theme-panel');

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

// A regular toast auto-dismisses after 5s — wrong for "update ready, restart
// whenever you like", which should stay put until the user acts (or a newer status
// replaces it). Tracks its own element so a later status update swaps it in place
// instead of stacking duplicate "downloading... 40%" toasts on every progress tick.
let updateToastEl = null;
function showUpdateToast(message, { actionLabel, onAction } = {}) {
  if (updateToastEl) updateToastEl.remove();
  const el = document.createElement('div');
  el.className = 'toast update-toast';
  el.innerHTML = `<span>${message}</span>${actionLabel ? `<button class="btn btn-primary btn-small">${actionLabel}</button>` : ''}`;
  if (actionLabel && onAction) {
    el.querySelector('button').addEventListener('click', onAction);
  }
  toastStack.appendChild(el);
  updateToastEl = el;
}

// ---------------- theme picker ----------------
// Colors here are cosmetic labels only — the actual hex values live in styles.css's
// [data-theme="..."] blocks; swatchColor just needs to roughly match so the little dot
// isn't lying about what you're about to pick.
const THEMES = [
  { id: 'cyan', swatchColor: '#2fe3ff' },
  { id: 'violet', swatchColor: '#c084fc' },
  { id: 'magenta', swatchColor: '#ff6ec7' },
  { id: 'amber', swatchColor: '#ffd166' },
  { id: 'emerald', swatchColor: '#34f5b0' },
  { id: 'crimson', swatchColor: '#ff7a7a' },
  { id: 'black', swatchColor: '#f2f4f8' },
];
const THEME_STORAGE_KEY = 'toolbar.theme';
const themeSwatchesEl = document.getElementById('theme-swatches');

function applyTheme(themeId, { save = true } = {}) {
  if (themeId === 'cyan') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = themeId;
  if (save) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
    } catch {
      // localStorage can throw in a locked-down profile — theming still works for
      // this session, it just won't be remembered next launch.
    }
  }
  themeSwatchesEl.querySelectorAll('.theme-swatch').forEach((el) => {
    el.classList.toggle('active', el.dataset.themeId === themeId);
  });
}

function renderThemePicker() {
  themeSwatchesEl.innerHTML = '';
  const activeThemeId = document.documentElement.dataset.theme || 'cyan';
  for (const theme of THEMES) {
    const btn = document.createElement('button');
    btn.className = `theme-swatch${theme.id === activeThemeId ? ' active' : ''}`;
    btn.dataset.themeId = theme.id;
    btn.style.setProperty('--swatch-accent', theme.swatchColor);
    btn.innerHTML = `<span class="theme-swatch-dot"></span> ${t(`theme.${theme.id}`)}`;
    btn.addEventListener('click', () => applyTheme(theme.id));
    themeSwatchesEl.appendChild(btn);
  }
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
    renderDashboardServers();
  } else if (activeCategory === 'connect') {
    renderServerCards();
  } else {
    renderCards();
  }
  renderThemePicker();
  renderFxPicker();
  renderDockGame();
  renderDockPlay();
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
function healthRow({ ok, label, detail }) {
  const row = document.createElement('div');
  row.className = `health-row ${ok ? 'ok' : 'bad'}`;
  row.innerHTML = `
    <span class="status-icon">${iconMarkup(ok ? 'status-ok' : 'status-bad')}</span>
    <div class="health-row-body">
      <div class="health-row-label">${label}</div>
      <div class="health-row-detail">${detail}</div>
    </div>
  `;
  return row;
}

// Home only tracks whether the game itself is set up; ReShade status lives on its own
// cards in the Graphics tab.
function renderNextStep(h) {
  const missing = !h.gta5.ok || !h.fivem.ok;
  nextStepEl.classList.toggle('hidden', !missing);
  nextStepEl.innerHTML = missing
    ? `<div><p class="next-step-title">${t('nextstep.needGame.title')}</p><p class="next-step-desc">${t('nextstep.needGame.desc')}</p></div>`
    : '';
}

function renderHealthCheck(h) {
  healthPanel.innerHTML = '';
  for (const key of ['gta5', 'fivem']) {
    healthPanel.appendChild(
      healthRow({
        ok: h[key].ok,
        label: t(`health.${key}`),
        detail: h[key].ok ? t('health.found', h[key].path) : t('health.notFound'),
      })
    );
  }
  renderNextStep(h);
  updateReadiness(h);
}

function updateReadiness(h) {
  const checks = [h.gta5.ok, h.fivem.ok];
  const done = checks.filter(Boolean).length;
  const chip = document.getElementById('readiness-chip');
  if (chip) {
    chip.classList.toggle('ok', done === checks.length);
    chip.innerHTML = `<span class="readiness-dot"></span><span>${t('holo.readiness')}</span><b class="mono">${done}/${checks.length}</b>`;
  }
  const navTagHome = document.getElementById('nav-tag-home');
  if (navTagHome) navTagHome.textContent = `${done}/${checks.length}`;
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
    if (pcHolo) pcHolo.setStats(stats);
    if (miniHolo) miniHolo.setStats(stats);
    updateDockGauges(stats);
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

// The sidebar dock shows these on every tab: every 2s on Home, 4s elsewhere, 6s in
// saver mode (a game is probably running and doesn't need us spawning nvidia-smi).
let sysmonTick = 0;
setInterval(() => {
  if (document.hidden) return;
  sysmonTick++;
  const every = fx.lite ? 3 : activeCategory === 'home' ? 1 : 2;
  if (sysmonTick % every === 0) updateSysmonStats();
}, 2000);

function showView(category) {
  const isHome = category === 'home';
  const isConnect = category === 'connect';
  const isApps = category === 'apps';
  const isDrivers = category === 'drivers';
  viewDashboard.classList.toggle('hidden', !isHome);
  viewConnect.classList.toggle('hidden', !isConnect);
  viewApps.classList.toggle('hidden', !isApps);
  viewDrivers.classList.toggle('hidden', !isDrivers);
  viewTools.classList.toggle('hidden', isHome || isConnect || isApps || isDrivers);
  themePanel.classList.toggle('hidden', category !== 'settings');
  // Without this a tall view leaves the shared scroll container part-way down, so the
  // next view opens mid-content with its own header scrolled off the top.
  document.querySelector('.content').scrollTop = 0;
  if (isHome) {
    loadHealthCheck();
    updateSysmonStats();
  }
  else if (isConnect) loadServers();
  else if (isApps) loadApps();
  else if (isDrivers) loadDrivers();
  else renderCards();
}

async function loadPlugins() {
  try {
    allPlugins = await window.toolbarApi.listPlugins();
    pluginCount.textContent = t('header.count', allPlugins.length);
    renderCards();
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
  refreshStatusBadges = null;

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
      // Kept as a reusable closure because these badges also have to be re-read after a
      // run — otherwise a failed batch leaves the pre-run badges on screen, still claiming
      // every item is applied while the result text says the opposite.
      refreshStatusBadges = () =>
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
      refreshStatusBadges();
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
    // On failure the modal stays open, so the badges behind it have to be re-read from the
    // machine — they were filled in before the run and would otherwise keep showing the
    // old verdict for the very items the result just reported as failed.
    if (!result.success && refreshStatusBadges) await refreshStatusBadges();
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
const serverLogoPreview = document.getElementById('server-logo-preview');
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

// Caches the in-flight promise too, so the card, the Home row and the globe asking for
// the same server at once share one request.
function getServerStatusCached(address) {
  const cached = serverStatusCache.get(address);
  if (cached && Date.now() - cached.at < SERVER_STATUS_TTL_MS) return cached.promise;
  const promise = window.toolbarApi.serverStatus(address);
  serverStatusCache.set(address, { promise, at: Date.now() });
  promise.catch(() => serverStatusCache.delete(address));
  return promise;
}

async function checkServerStatus(address, statusEl) {
  try {
    const status = await getServerStatusCached(address);
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
    renderDockPlay();
    if (serverGlobe) serverGlobe.setServers(allServers);
  } catch (err) {
    if (!silent) serverGrid.innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function updateModeFieldsVisibility() {
  const isLauncher = serverModeSelect.value === 'customLauncher';
  serverLauncherField.classList.toggle('hidden', !isLauncher);
  serverArgsField.classList.toggle('hidden', !isLauncher);
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
  const server = {
    id: editingServerId,
    name,
    mode,
    address: serverAddressInput.value.trim(),
    launcherPath: serverLauncherPathInput.value.trim(),
    launchArgs: serverArgsInput.value.trim(),
    logo: currentLogo,
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

// ---------------- drivers (driver check view) ----------------
const driversList = document.getElementById('drivers-list');
const driversCount = document.getElementById('drivers-count');
let driverScanCache = null;
let driverScanInFlight = false;

const DRIVER_KIND_RAIL = {
  missing: 'var(--danger)',
  fallback: 'var(--accent-1)',
  other: 'var(--text-dim)',
};

async function loadDrivers({ force = false } = {}) {
  if (driverScanInFlight) return;
  if (driverScanCache && !force) return renderDrivers(driverScanCache);
  driverScanInFlight = true;
  driversCount.textContent = t('drivers.subtitle');
  driversList.innerHTML = `<div class="empty-state">${t('drivers.scanning')}</div>`;
  try {
    const result = await window.toolbarApi.scanDrivers();
    if (!result.success) throw new Error(result.message);
    driverScanCache = result;
    renderDrivers(result);
  } catch (err) {
    driversList.innerHTML = `<div class="empty-state">${t('drivers.error', err.message)}</div>`;
    driversCount.textContent = '';
  } finally {
    driverScanInFlight = false;
  }
}

function renderDrivers(result) {
  const { issues, scannedDevices } = result;
  driversCount.textContent = issues.length
    ? t('drivers.summary', issues.length, scannedDevices)
    : t('drivers.allClear', scannedDevices);
  document.getElementById('nav-tag-drivers').textContent = issues.length || '';
  if (!issues.length) {
    driversList.innerHTML = `<div class="empty-state"><strong>${t('drivers.none')}</strong><br />${t('drivers.noneHint')}</div>`;
    return;
  }
  driversList.innerHTML = '';
  for (const issue of issues) {
    const row = document.createElement('div');
    row.className = `driver-row kind-${issue.kind}`;
    row.style.setProperty('--rail', DRIVER_KIND_RAIL[issue.kind]);
    const badges = [`<span class="driver-badge">${t('drivers.kind.' + issue.kind)}</span>`];
    if (issue.pnpClass) badges.push(`<span class="tag">${issue.pnpClass}</span>`);
    if (issue.count > 1) badges.push(`<span class="tag">${t('drivers.multiple', issue.count)}</span>`);
    if (issue.problemCode) badges.push(`<span class="tag mono">${t('drivers.problemCode', issue.problemCode)}</span>`);
    const findLabel = issue.action
      ? issue.action.type === 'vendor'
        ? t('drivers.openVendor', issue.action.vendor)
        : t('drivers.search')
      : '';
    row.innerHTML = `
      <div class="driver-row-main">
        <h3>${issue.name}</h3>
        <div class="driver-badges">${badges.join('')}</div>
        <p class="driver-hint">${t('drivers.hint.' + issue.kind)}</p>
        <code class="driver-hwid mono">${issue.hardwareId}</code>
      </div>
      <div class="driver-row-actions">
        ${issue.action ? `<button class="btn btn-primary btn-small" data-role="find">${findLabel}</button>` : ''}
        <button class="btn btn-ghost btn-small" data-role="copy">${t('drivers.copyId')}</button>
      </div>
    `;
    const findBtn = row.querySelector('[data-role="find"]');
    if (findBtn) findBtn.addEventListener('click', () => window.toolbarApi.openExternal(issue.action.url));
    row.querySelector('[data-role="copy"]').addEventListener('click', async (e) => {
      await navigator.clipboard.writeText(issue.hardwareId);
      e.target.textContent = t('drivers.copied');
      setTimeout(() => { e.target.textContent = t('drivers.copyId'); }, 1500);
    });
    driversList.appendChild(row);
  }
}

document.getElementById('btn-scan-drivers').addEventListener('click', () => loadDrivers({ force: true }));

// ---------------- HUD chrome: particle field + targeting reticle + panel tilt ----------------
// ---------------- effects mode ----------------
// 'auto' drops to the saver look while FiveM is running; 'full' / 'lite' pin it. The
// OS reduced-motion flag is deliberately ignored: stripped Windows builds switch it on
// along with every other visual effect, which would leave auto permanently in saver. The saver look is the `fx-lite` class on <html>
// plus Holo.setLite — both the CSS and the canvas loops key off those.
const FX_STORAGE_KEY = 'toolbar.fxMode';
const FX_MODES = ['auto', 'full', 'lite'];
const fx = { mode: 'auto', gameRunning: false, lite: false };
try {
  const saved = localStorage.getItem(FX_STORAGE_KEY);
  if (FX_MODES.includes(saved)) fx.mode = saved;
} catch {
  // storage unavailable — stays on auto for this session
}

function applyFx() {
  fx.lite = fx.mode === 'lite' || (fx.mode === 'auto' && fx.gameRunning);
  document.documentElement.classList.toggle('fx-lite', fx.lite);
  Holo.setLite(fx.lite);
  if (fx.lite) finishBoot();
  renderFxPicker();
  renderDockGame();
}

function setFxMode(mode) {
  fx.mode = mode;
  try {
    localStorage.setItem(FX_STORAGE_KEY, mode);
  } catch {
    // not remembered, still applies now
  }
  applyFx();
}

function renderFxPicker() {
  const wrap = document.getElementById('fx-modes');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const mode of FX_MODES) {
    const btn = document.createElement('button');
    btn.className = `theme-swatch${mode === fx.mode ? ' active' : ''}`;
    btn.style.setProperty('--swatch-accent', 'var(--accent-2)');
    btn.innerHTML = `<span class="theme-swatch-dot"></span> ${t(`fx.${mode}`)}`;
    btn.addEventListener('click', () => setFxMode(mode));
    wrap.appendChild(btn);
  }
  let status = fx.lite ? 'fx.status.lite' : 'fx.status.full';
  if (fx.mode === 'auto' && fx.gameRunning) status = 'fx.status.game';
  document.getElementById('fx-status').textContent = t(status);
}

async function pollGameRunning() {
  try {
    const running = await window.toolbarApi.isFiveMRunning();
    if (running !== fx.gameRunning) {
      fx.gameRunning = running;
      gameSince = running ? Date.now() : 0;
      applyFx();
    }
  } catch {
    // keep the last known state
  }
}
setInterval(pollGameRunning, 10000);

// ---------------- cursor highlight ----------------
// One handler feeds --mx/--my to whichever glow surface is under the pointer, so cards,
// rows, gauges, stages and hologram panels all light up the same way.
const GLOW_SELECTOR = '.tool-card, .server-row, .sysmon-card, .health-row, .driver-row, .holo-stage, .holo-block';
let glowEl = null;
document.addEventListener('mousemove', (e) => {
  if (fx.lite) return;
  const el = e.target.closest && e.target.closest(GLOW_SELECTOR);
  // A hologram panel sits inside a stage — keep the stage's light following along too.
  const targets = el ? [el] : [];
  if (el && el.classList.contains('holo-block')) {
    const stage = el.closest('.holo-stage');
    if (stage) targets.push(stage);
  }
  for (const target of targets) {
    const r = target.getBoundingClientRect();
    target.style.setProperty('--mx', `${e.clientX - r.left}px`);
    target.style.setProperty('--my', `${e.clientY - r.top}px`);
  }
  if (glowEl && glowEl !== el && glowEl.classList.contains('holo-block')) glowEl.style.removeProperty('--mx');
  glowEl = el;
});

// ---------------- boot sequence ----------------
// Plays on every launch (skipped in saver mode). The app loads underneath the whole
// time, and a click or key press skips it.
let bootTimer = null;

function finishBoot() {
  const el = document.getElementById('boot');
  if (!el || el.classList.contains('done')) return;
  clearTimeout(bootTimer);
  el.classList.add('done');
  setTimeout(() => el.remove(), 400);
  const shell = document.querySelector('.app-shell');
  shell.classList.remove('glitch');
  void shell.offsetWidth;
  shell.classList.add('glitch');
}

function runBoot() {
  const el = document.getElementById('boot');
  if (!el) return;
  if (fx.lite) {
    el.remove();
    return;
  }
  el.classList.add('play');
  const lines = [
    ['SYS.CORE', 'ONLINE'],
    ['CPU', '…'],
    ['GPU', '…'],
    ['NET.MAP', 'LINKING'],
    ['HOLO.RENDER', 'READY'],
  ];
  const linesEl = document.getElementById('boot-lines');
  linesEl.innerHTML = lines
    .map(([k, v], i) => `<div class="boot-line" style="--i:${i}"><span>&gt; ${k}</span><b data-boot="${k}">${v}</b></div>`)
    .join('');
  window.toolbarApi.getHardware().then((hw) => {
    linesEl.querySelector('[data-boot="CPU"]').textContent = `${hw.threads} THREADS`;
    linesEl.querySelector('[data-boot="GPU"]').textContent = hw.gpuModel || '—';
  }).catch(() => {});
  el.addEventListener('click', finishBoot);
  document.addEventListener('keydown', finishBoot, { once: true });
  bootTimer = setTimeout(finishBoot, 1500);
}

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
  // Follows the theme accent; re-read occasionally rather than every frame.
  let particleRgb = '47,227,255';
  let particleRgbAt = 0;
  function particleColor(alpha) {
    const now = performance.now();
    if (now - particleRgbAt > 1000) {
      particleRgbAt = now;
      const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim().replace('#', '');
      const n = parseInt(hex, 16);
      if (hex.length === 6 && !Number.isNaN(n)) particleRgb = `${n >> 16},${(n >> 8) & 255},${n & 255}`;
    }
    return `rgba(${particleRgb},${alpha})`;
  }
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

    ctx.strokeStyle = particleColor(0.12);
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

    ctx.fillStyle = particleColor(0.4);
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(p.x + 1.1, p.y);
      ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  const reticle = document.getElementById('reticle');
  const reticleDot = document.getElementById('reticle-dot');
  const cursorGlow = document.getElementById('cursor-glow');
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
    overHot = !!e.target.closest('.btn, .tool-card, .nav-item, .server-card-edit, [data-role="play"], canvas.pointing, .holo-close');
    const px = mouseX / window.innerWidth - 0.5;
    const py = mouseY / window.innerHeight - 0.5;
    targetTiltY = fx.lite ? 0 : px * 4.5;
    targetTiltX = fx.lite ? 0 : -py * 4.5;
  });

  let frameCount = 0;
  function loop() {
    frameCount++;
    // Particle field is the most expensive part of this loop — halving its rate to
    // ~30fps is imperceptible for slow-drifting dots but meaningfully cuts main-thread
    // work, leaving more headroom for DOM rebuilds when switching categories quickly.
    if (!fx.lite && frameCount % 2 === 0) drawParticles();

    dotX += (mouseX - dotX) * 0.35;
    dotY += (mouseY - dotY) * 0.35;
    reticleDot.style.transform = `translate(${dotX}px,${dotY}px) translate(-50%,-50%)`;
    reticleDot.classList.add('show');
    if (!fx.lite) cursorGlow.style.transform = `translate(${dotX}px,${dotY}px)`;

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

// ---------------- sidebar dock ----------------
// Mini hologram, live gauges, game status and one-click Play for the top server,
// visible from every tab.
let miniHolo = null;
let gameSince = 0;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DOCK_RING = 2 * Math.PI * 15;

function dockGaugeMarkup(id, label) {
  return `
    <div class="dock-gauge" id="dock-${id}">
      <svg viewBox="0 0 36 36"><circle class="dock-ring-track" cx="18" cy="18" r="15"/>
        <circle class="dock-ring-val" cx="18" cy="18" r="15" stroke-dasharray="${DOCK_RING}" stroke-dashoffset="${DOCK_RING}"/></svg>
      <b class="mono">--</b><span class="mono">${label}</span>
    </div>`;
}

function setDockGauge(id, fraction, text, level) {
  const el = document.getElementById(`dock-${id}`);
  if (!el) return;
  el.querySelector('.dock-ring-val').style.strokeDashoffset = DOCK_RING * (1 - Math.max(0, Math.min(1, fraction)));
  el.querySelector('b').textContent = text;
  el.classList.toggle('warn', level === 'warn');
  el.classList.toggle('bad', level === 'bad');
}

function updateDockGauges(stats) {
  const byLoad = (v) => (v >= 90 ? 'bad' : v >= 75 ? 'warn' : '');
  setDockGauge('cpu', stats.cpu / 100, `${stats.cpu}%`, byLoad(stats.cpu));
  if (stats.gpu) {
    const temp = stats.gpu.tempC;
    setDockGauge('gpu', stats.gpu.utilPercent / 100, `${stats.gpu.utilPercent}%`, byLoad(stats.gpu.utilPercent));
    setDockGauge('temp', (temp - 30) / 60, `${temp}°`, temp >= 83 ? 'bad' : temp >= 72 ? 'warn' : '');
  } else {
    setDockGauge('gpu', 0, '—', '');
    setDockGauge('temp', 0, '—', '');
  }
}

function renderDockGame() {
  const el = document.getElementById('dock-game');
  if (!el) return;
  let clock = '';
  if (fx.gameRunning && gameSince) {
    const sec = Math.floor((Date.now() - gameSince) / 1000);
    const hh = Math.floor(sec / 3600);
    const mm = String(Math.floor(sec / 60) % 60).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    clock = hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
  }
  el.classList.toggle('running', fx.gameRunning);
  el.innerHTML = `
    <div class="dock-game-row"><span class="dock-dot"></span><span>FIVEM</span>
      <b>${fx.gameRunning ? t('dock.running') : t('dock.idle')}</b></div>
    <div class="dock-game-row dim"><span>${clock ? t('dock.session', clock) : '&nbsp;'}</span>
      <b class="${fx.lite ? 'lite' : ''}">FX ${fx.lite ? 'SAVER' : 'FULL'}</b></div>`;
}
setInterval(() => {
  if (fx.gameRunning && !document.hidden) renderDockGame();
}, 1000);

let dockPing = { id: null, ms: null, at: 0 };

async function renderDockPlay() {
  const el = document.getElementById('dock-play');
  if (!el) return;
  const server = allServers.find((s) => s.address);
  if (!server) {
    el.innerHTML = `<button class="dock-play-empty" data-role="add">+ ${esc(t('connect.addServer'))}</button>`;
    el.querySelector('[data-role="add"]').addEventListener('click', () => {
      document.querySelector('.nav-item[data-category="connect"]').click();
    });
    return;
  }
  if (dockPing.id !== server.id) dockPing = { id: server.id, ms: null, at: 0 };
  const ping = dockPing.ms != null ? `${dockPing.ms} ms` : '— ms';
  const pingTone = dockPing.ms == null ? '' : dockPing.ms <= 40 ? 'good' : dockPing.ms <= 100 ? 'warn' : 'bad';
  el.innerHTML = `
    <div class="dock-play-card">
      <span class="dock-play-avatar">${server.logo ? '' : esc((server.name || '?').trim().slice(0, 2).toUpperCase())}</span>
      <div class="dock-play-info">
        <div class="dock-play-name">${esc(server.name)}</div>
        <div class="dock-play-stat mono"><span data-role="players">…</span><span class="${pingTone}"> · ${ping}</span></div>
      </div>
      <button class="dock-play-btn" title="${esc(t('connect.play'))}">${iconMarkup('nav-connect')}</button>
    </div>`;
  if (server.logo) el.querySelector('.dock-play-avatar').style.backgroundImage = `url(${server.logo})`;
  el.querySelector('.dock-play-btn').addEventListener('click', () => launchWithToast(server));
  try {
    const status = await getServerStatusCached(server.address);
    const playersEl = el.querySelector('[data-role="players"]');
    if (!playersEl || !playersEl.isConnected) return;
    playersEl.textContent = status && status.online
      ? (status.maxPlayers != null ? `${status.players}/${status.maxPlayers}` : `${status.players}`)
      : t('dock.offline');
    playersEl.classList.toggle('bad', !(status && status.online));
    // an offline server's ping says nothing useful and only crowds the line
    if (!(status && status.online)) playersEl.nextElementSibling.remove();
    // Ping costs two TCP connects, so refresh it at most every 30s and not mid-game.
    if (!fx.lite && Date.now() - dockPing.at > 30000) {
      dockPing.at = Date.now();
      const geo = await window.toolbarApi.getServerGeo(server.address, status && status.endpoint);
      if (dockPing.id === server.id && geo && geo.pingMs != null) {
        dockPing.ms = geo.pingMs;
        renderDockPlay();
      }
    }
  } catch {
    // leave the placeholders; next refresh tries again
  }
}
setInterval(() => {
  if (!document.hidden) renderDockPlay();
}, 30000);

function initDock() {
  document.getElementById('dock-gauges').innerHTML =
    dockGaugeMarkup('cpu', 'CPU') + dockGaugeMarkup('gpu', 'GPU') + dockGaugeMarkup('temp', 'TEMP');
  miniHolo = Holo.createPcHologram(document.getElementById('dock-holo'), {
    getHardware: () => window.toolbarApi.getHardware(),
    mini: true,
  });
  renderDockGame();
  renderDockPlay();
}

// ---------------- holograms (Home) ----------------
let pcHolo = null;
let serverGlobe = null;

function launchWithToast(server) {
  window.toolbarApi
    .launchServer(server)
    .then((result) => toast(result.message, result.success ? 'success' : 'error'))
    .catch((err) => toast(err.message, 'error'));
}

function initHolograms() {
  pcHolo = Holo.createPcHologram(document.getElementById('pc-holo-stage'), {
    getHardware: () => window.toolbarApi.getHardware(),
  });
  serverGlobe = Holo.createServerGlobe(document.getElementById('globe-holo-stage'), {
    resolveStatus: getServerStatusCached,
    getServerGeo: (address, endpoint) => window.toolbarApi.getServerGeo(address, endpoint),
    getHomeGeo: () => window.toolbarApi.getHomeGeo(),
    onPlay: launchWithToast,
  });
  window.toolbarApi.getHardware().then((hw) => {
    document.getElementById('pc-holo-host').textContent = `// ${hw.hostname}`;
  }).catch(() => {});
}

// ---------------- init ----------------
try {
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'cyan', { save: false });
} catch {
  // localStorage unavailable — falls back to the default cyan theme for this session
}
mountIcons();
applyStaticI18n();
renderThemePicker();
positionNavIndicator(navList.querySelector('.nav-item.active'));
initHudChrome();
initHolograms();
initDock();
applyFx();
runBoot();
pollGameRunning();
document.querySelector('.app-shell').classList.add('glitch');
loadPlugins();
loadHealthCheck();
loadServers({ silent: true });
updateSysmonStats();
window.toolbarApi.getVersion().then((v) => {
  document.getElementById('titlebar-version').textContent = `v${v}`;
});

// Auto-update: main process pushes status as electron-updater's own events fire (see
// src/autoUpdate.js) — 'checking'/'not-available' are deliberately silent (nothing
// for the user to act on), only 'available'/'downloading'/'downloaded'/'error' surface.
window.toolbarApi.onUpdateStatus((status) => {
  if (status.state === 'available') {
    showUpdateToast(`พบอัปเดตใหม่ v${status.version} — กำลังดาวน์โหลด...`);
  } else if (status.state === 'downloading') {
    showUpdateToast(`กำลังดาวน์โหลดอัปเดต... ${status.percent}%`);
  } else if (status.state === 'downloaded') {
    showUpdateToast(`อัปเดตเป็น v${status.version} พร้อมติดตั้งแล้ว`, {
      actionLabel: 'รีสตาร์ทเพื่ออัปเดต',
      onAction: () => window.toolbarApi.restartToUpdate(),
    });
  }
});
