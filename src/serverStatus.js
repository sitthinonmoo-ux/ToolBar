// Looks up live status (online/offline, player count, hostname, tags, icon) for a
// saved FiveM server address. Two sources depending on what the address is:
//   - a cfx.re join code -> the official servers-frontend API (rich data + icon)
//   - a raw ip[:port]    -> the server's own info.json/players.json HTTP endpoint
//     (the same interface FiveM's in-game server browser and tools like txAdmin use)
function extractJoinCode(address) {
  const a = address || '';
  // Both "cfx.re/join/<code>" (the connect link) and
  // "servers.fivem.net/servers/detail/<code>" (the server-list detail page, which is
  // what people usually copy from their browser) key off the same join code.
  const m = a.match(/cfx\.re\/join\/([a-z0-9]+)/i) || a.match(/servers\.fivem\.net\/servers\/detail\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

function parseDirectEndpoint(address) {
  const stripped = (address || '')
    .trim()
    .replace(/^fivem:\/\/connect\//i, '')
    .replace(/^https?:\/\//i, '');
  if (!stripped || /cfx\.re/i.test(stripped)) return null;
  const [host, portStr] = stripped.split(':');
  if (!host) return null;
  return { host, port: portStr ? Number(portStr) : 30120 };
}

function stripColorCodes(s) {
  return (s || '').replace(/\^[0-9]/g, '').trim();
}

// sv_pureLevel (0 = off, 1 = no added files, 2 = no modified files either) and
// sv_enforceGameBuild are the two things FiveM restarts itself for right after a connect
// when the client isn't already in the matching mode. Both are published in the same
// `vars` blob this module already reads, so pulling them out costs nothing extra and lets
// launchServer start FiveM in the right state to begin with. Anything unexpected becomes
// null rather than a guess — a bogus value here would turn into a bogus launch flag.
function parsePureLevel(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 2 ? n : null;
}

function parseGameBuild(raw) {
  const s = String(raw ?? '').trim();
  return /^\d{3,6}$/.test(s) ? s : null;
}

async function fetchJson(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Some FXServer builds omit/mislabel the Content-Type header on info.json/
    // players.json, so sniff by attempting to parse rather than trusting the header.
    try {
      return await res.json();
    } catch {
      throw new Error('ที่อยู่นี้ไม่ใช่เซิร์ฟเวอร์ FiveM ที่เช็คสถานะได้');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDirectStatus(host, port) {
  const info = await fetchJson(`http://${host}:${port}/info.json`);
  const players = await fetchJson(`http://${host}:${port}/players.json`).catch(() => []);
  const vars = info.vars || {};
  return {
    online: true,
    hostname: stripColorCodes(info.hostname || vars.sv_projectName || vars.sv_hostname || ''),
    players: Array.isArray(players) ? players.length : 0,
    maxPlayers: Number(vars.sv_maxClients ?? vars.sv_maxclients) || null,
    tags: vars.tags || '',
    pureLevel: parsePureLevel(vars.sv_pureLevel),
    gameBuild: parseGameBuild(vars.sv_enforceGameBuild),
    iconDataUri: info.icon ? `data:image/png;base64,${info.icon}` : null,
    endpoint: `${host}:${port}`,
  };
}

async function fetchByJoinCode(code) {
  let data;
  try {
    data = await fetchJson(`https://servers-frontend.fivem.net/api/servers/single/${code}`);
  } catch (err) {
    if (/^HTTP 404/.test(err.message)) {
      // The public single-server lookup deliberately omits servers marked "private"
      // on the server list (anti-scraping) — this isn't a network failure, so give
      // a message that points at the actual fix instead of a generic "offline".
      throw new Error('ไม่พบในรายการสาธารณะของ FiveM (เซิร์ฟเวอร์อาจตั้งเป็น private) — ลองใส่ ip:port ตรงๆ แทนโค้ด cfx.re');
    }
    throw err;
  }
  const d = (data && data.Data) || {};
  const vars = d.vars || {};

  let iconDataUri = null;
  if (d.iconVersion) {
    try {
      const iconRes = await fetch(`https://servers-frontend.fivem.net/api/servers/icon/${code}/${d.iconVersion}.png`);
      if (iconRes.ok) {
        const buf = Buffer.from(await iconRes.arrayBuffer());
        iconDataUri = `data:image/png;base64,${buf.toString('base64')}`;
      }
    } catch {
      // icon is a nice-to-have, never fail the whole lookup over it
    }
  }

  return {
    online: true,
    hostname: stripColorCodes(d.hostname || vars.sv_projectName || ''),
    players: Number(d.clients) || 0,
    maxPlayers: Number(d.svMaxclients ?? d.sv_maxclients ?? vars.sv_maxclients) || null,
    tags: vars.tags || '',
    pureLevel: parsePureLevel(vars.sv_pureLevel),
    gameBuild: parseGameBuild(vars.sv_enforceGameBuild),
    iconDataUri,
    endpoint: data.EndPoint || null,
  };
}

async function fetchServerStatus(rawAddress) {
  const code = extractJoinCode(rawAddress);
  try {
    if (code) return await fetchByJoinCode(code);
    const direct = parseDirectEndpoint(rawAddress);
    if (!direct) return { online: false, message: 'รูปแบบที่อยู่นี้ยังไม่รองรับการเช็คสถานะ' };
    return await fetchDirectStatus(direct.host, direct.port);
  } catch (err) {
    if (err.name === 'AbortError') return { online: false, message: 'หมดเวลาเชื่อมต่อเซิร์ฟเวอร์' };
    // A message we authored ourselves (e.g. the "private server" case above) is
    // more useful to show as-is than the generic fallback.
    if (err.message && !/^HTTP \d/.test(err.message)) return { online: false, message: err.message };
    return { online: false, message: 'เซิร์ฟเวอร์ออฟไลน์หรือติดต่อไม่ได้' };
  }
}

module.exports = { fetchServerStatus, extractJoinCode, parseDirectEndpoint };
