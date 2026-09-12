const os = require('os');
const { spawn } = require('child_process');

// CPU % needs two samples over time to compute — rather than blocking each call with
// a sleep, we keep the previous sample and diff against it on the next poll (the
// renderer already polls every few seconds, which is plenty of resolution).
let lastCpuSample = os.cpus();

function cpuPercent() {
  const current = os.cpus();
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < current.length; i++) {
    const prev = lastCpuSample[i].times;
    const now = current[i].times;
    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
    const nowTotal = now.user + now.nice + now.sys + now.idle + now.irq;
    idleDelta += now.idle - prev.idle;
    totalDelta += nowTotal - prevTotal;
  }
  lastCpuSample = current;
  if (totalDelta <= 0) return 0;
  return Math.round((1 - idleDelta / totalDelta) * 100);
}

function ramStats() {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPercent = Math.round(((total - free) / total) * 100);
  return { usedPercent, usedGB: (total - free) / 1024 ** 3, totalGB: total / 1024 ** 3 };
}

// GPU stats need nvidia-smi (NVIDIA only) — machines without it, or without an NVIDIA
// card, just don't get a GPU gauge rather than erroring the whole poll.
function gpuStats() {
  return new Promise((resolve) => {
    const child = spawn('nvidia-smi', [
      '--query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total,name',
      '--format=csv,noheader,nounits',
    ]);
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => resolve(null));
    child.on('exit', (code) => {
      if (code !== 0 || !stdout.trim()) return resolve(null);
      const [util, temp, memUsed, memTotal, name] = stdout.trim().split(',').map((s) => s.trim());
      resolve({
        utilPercent: Number(util) || 0,
        tempC: Number(temp) || 0,
        memUsedMB: Number(memUsed) || 0,
        memTotalMB: Number(memTotal) || 0,
        name,
      });
    });
  });
}

async function getStats() {
  const [gpu] = await Promise.all([gpuStats()]);
  return { cpu: cpuPercent(), ram: ramStats(), gpu };
}

module.exports = { getStats };
