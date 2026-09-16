const fs = require('fs');
const os = require('os');
const net = require('net');
const dns = require('dns').promises;
const { spawn } = require('child_process');
const { extractJoinCode, parseDirectEndpoint } = require('./serverStatus');

// ---------------- hardware (static parts of the hologram PC) ----------------
function gpuName() {
  return new Promise((resolve) => {
    const child = spawn('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => resolve(null));
    child.on('exit', (code) => resolve(code === 0 ? out.trim().split('\n')[0] || null : null));
  });
}

function drives() {
  const list = [];
  for (let c = 67; c <= 90; c++) {
    const root = `${String.fromCharCode(c)}:\\`;
    try {
      const s = fs.statfsSync(root);
      const total = s.blocks * s.bsize;
      if (total <= 0) continue;
      list.push({ letter: root.slice(0, 2), totalGB: total / 1024 ** 3, freeGB: (s.bavail * s.bsize) / 1024 ** 3 });
    } catch {
      // letter not mounted
    }
  }
  return list;
}

let hardwareCache = null;
async function getHardware() {
  if (!hardwareCache) {
    const cpus = os.cpus();
    hardwareCache = {
      cpuModel: (cpus[0] && cpus[0].model.trim()) || 'CPU',
      threads: cpus.length,
      ramGB: os.totalmem() / 1024 ** 3,
      gpuModel: await gpuName(),
      hostname: os.hostname(),
    };
  }
  // Free space changes while the app is open, so only the rest is cached.
  return { ...hardwareCache, drives: drives() };
}

// ---------------- server globe: location + latency ----------------
// Location comes from ipwho.is (HTTPS, no key). Results are cached for the session —
// a server's datacenter doesn't move, and the globe re-renders often.
const geoCache = new Map();

async function geoLookup(ip = '') {
  if (geoCache.has(ip)) return geoCache.get(ip);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: ctrl.signal });
    const d = await res.json();
    const geo = d && d.success
      ? { ip: d.ip, lat: d.latitude, lon: d.longitude, city: d.city || '', country: d.country || '', countryCode: d.country_code || '', isp: (d.connection && d.connection.isp) || '' }
      : null;
    if (geo) geoCache.set(ip, geo);
    return geo;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// TCP connect time rather than ICMP: no admin rights needed, and the ping output
// wording changes with the Windows display language.
function tcpPing(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const sock = net.connect({ host, port });
    const done = (ms) => {
      sock.destroy();
      resolve(ms);
    };
    sock.setTimeout(timeoutMs, () => done(null));
    sock.once('error', () => done(null));
    sock.once('connect', () => done(Number(process.hrtime.bigint() - start) / 1e6));
  });
}

async function bestPing(host, port) {
  for (const p of [port, 443, 80]) {
    if (!p) continue;
    const samples = [];
    for (let i = 0; i < 2; i++) {
      const ms = await tcpPing(host, p);
      if (ms != null) samples.push(ms);
    }
    if (samples.length) return Math.round(Math.min(...samples));
  }
  return null;
}

// `endpoint` is the ip:port fetchServerStatus already found (needed for cfx.re codes,
// whose address alone says nothing about where the server lives).
async function getServerGeo(address, endpoint) {
  let target = endpoint ? parseDirectEndpoint(endpoint) : null;
  if (!target && !extractJoinCode(address)) target = parseDirectEndpoint(address);
  if (!target) return { ok: false };
  let ip = target.host;
  if (!net.isIP(ip)) {
    try {
      ip = (await dns.lookup(ip, { family: 4 })).address;
    } catch {
      return { ok: false };
    }
  }
  const [geo, pingMs] = await Promise.all([geoLookup(ip), bestPing(ip, target.port)]);
  if (!geo) return { ok: false, pingMs };
  return { ok: true, pingMs, ...geo };
}

function getHomeGeo() {
  return geoLookup('');
}

module.exports = { getHardware, getServerGeo, getHomeGeo };
