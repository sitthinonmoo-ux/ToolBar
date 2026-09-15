const { spawn } = require('child_process');

// Windows' own PnP problem codes (CM_PROB_*). These are an OS-level contract, not
// anything hardware- or vendor-specific, which is the whole reason the scan can run on
// someone else's machine and still mean the same thing.
//
// The naive version of this check — "flag every device whose Status isn't OK" — is
// useless in practice: on a debloated/LTSC Windows it lights up with a dozen legacy ACPI
// stubs (System timer, PS/2 keyboard, DMA controller) that were disabled deliberately,
// burying the one device that genuinely has no driver. Splitting by problem code is what
// separates "no driver" from "switched off on purpose".
const MISSING_DRIVER_CODES = new Set([
  1, // not configured (no driver)
  18, // reinstall the drivers for this device
  28, // the drivers for this device are not installed
  31, // Windows cannot load the drivers required for this device
  37, // driver returned a failure from DriverEntry
  39, // driver is corrupted or missing
]);

// Deliberately off, absent, or unplugged — a report that nags about these is a report
// people stop reading.
const NOT_A_PROBLEM_CODES = new Set([
  22, // disabled by user or policy
  24, // device is not present
  45, // not currently connected
  47, // prepared for safe removal
]);

// Windows ships stand-in drivers that let a device work in a degraded way, so the device
// reports problem code 0 and looks perfectly healthy — the generic audio path has sound
// but no jack detection, the basic display adapter has a picture but no acceleration.
// Problem codes can never catch this case, so it needs its own check.
//
// Matching is gated on the enumerator as well as the name because "USB Audio Device" on a
// USB headset is the *correct* class driver, not a fallback; only the onboard HDAUDIO and
// PCI display stand-ins mean something is actually missing.
const FALLBACK_DRIVERS = [
  { enumerator: 'PCI', name: 'Microsoft Basic Display Adapter' },
  { enumerator: 'PCI', name: 'Microsoft Basic Render Driver' },
  { enumerator: 'HDAUDIO', name: 'High Definition Audio Device' },
];

const SCAN_TIMEOUT_MS = 30000;

// PCI vendor IDs whose drivers come from a first-party download page that has stayed put
// for years. Sending someone straight there beats a web search for these three, but note
// what is deliberately NOT here: a one-click winget install. winget carries no NVIDIA App
// and no AMD Adrenalin package (only Intel's assistant), so there is nothing to install
// silently — a link is the honest ceiling for GPU drivers.
const VENDOR_DRIVER_PAGES = {
  '10DE': { vendor: 'NVIDIA', url: 'https://www.nvidia.com/Download/index.aspx' },
  '1002': { vendor: 'AMD', url: 'https://www.amd.com/en/support' },
  '1022': { vendor: 'AMD', url: 'https://www.amd.com/en/support' },
  '8086': { vendor: 'Intel', url: 'https://www.intel.com/content/www/us/en/support/detect.html' },
};

function vendorIdOf(hardwareId) {
  const match = /VEN_([0-9A-F]{4})/i.exec(hardwareId || '');
  return match ? match[1].toUpperCase() : null;
}

// Everything that isn't a known GPU vendor is onboard-ish — a motherboard audio codec, an
// ACPI device, a card reader — and for those the motherboard model is the single most
// useful search term, far more than the raw ID on its own.
function actionFor(hardwareId, board) {
  const known = VENDOR_DRIVER_PAGES[vendorIdOf(hardwareId)];
  if (known) return { type: 'vendor', vendor: known.vendor, url: known.url };
  const terms = [board, `"${hardwareId}"`, 'driver'].filter(Boolean).join(' ');
  return { type: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(terms)}` };
}

// Boards report their maker's full legal name ("Micro-Star International Co., Ltd."),
// which nobody writes on a support page or in a forum post. Searching the trade name the
// rest of the world uses is what actually finds the download.
const BOARD_MAKER_TRADE_NAMES = [
  [/micro-?star/i, 'MSI'],
  [/asustek/i, 'ASUS'],
  [/gigabyte/i, 'Gigabyte'],
  [/asrock/i, 'ASRock'],
  [/hewlett-?packard/i, 'HP'],
];

function searchableBoardName({ boardMaker, boardModel }) {
  const maker = BOARD_MAKER_TRADE_NAMES.find(([pattern]) => pattern.test(boardMaker || ''));
  return [maker ? maker[1] : boardMaker, boardModel].filter(Boolean).join(' ').trim();
}

// Only devices that could possibly be interesting cross the process boundary: anything
// already reporting a problem, plus the three classes where a fallback driver is worth
// knowing about. Serialising all ~400 PnP devices would be pure waste.
const SCAN_SCRIPT = `
$board = Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue
$drivers = @{}
Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.DeviceID -and -not $drivers.ContainsKey($_.DeviceID)) { $drivers[$_.DeviceID] = $_ }
}
$devices = Get-CimInstance Win32_PnPEntity -ErrorAction Stop | Where-Object {
  $_.ConfigManagerErrorCode -ne 0 -or $_.PnPClass -in @('Display','MEDIA','Net')
} | ForEach-Object {
  $d = $drivers[$_.DeviceID]
  [PSCustomObject]@{
    name = $_.Name
    pnpClass = $_.PnPClass
    deviceId = $_.DeviceID
    hardwareId = if ($_.HardwareID -and $_.HardwareID.Count -gt 0) { $_.HardwareID[0] } else { $_.DeviceID }
    problemCode = [int]$_.ConfigManagerErrorCode
    provider = if ($d) { $d.DriverProviderName } else { '' }
  }
}
[PSCustomObject]@{
  boardMaker = if ($board) { $board.Manufacturer } else { '' }
  boardModel = if ($board) { $board.Product } else { '' }
  devices = @($devices)
} | ConvertTo-Json -Compress -Depth 4
`;

function runScan() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCAN_SCRIPT],
      { windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('สแกนไม่เสร็จภายในเวลาที่กำหนด'));
    }, SCAN_TIMEOUT_MS);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      if (!stdout.trim()) return reject(new Error(stderr.trim() || 'ไม่ได้ข้อมูลอุปกรณ์จากระบบ'));
      try {
        const parsed = JSON.parse(stdout);
        // ConvertTo-Json emits a bare object rather than a 1-element array when exactly
        // one device matches — which is the common case on a healthy machine.
        const devices = Array.isArray(parsed.devices) ? parsed.devices : parsed.devices ? [parsed.devices] : [];
        resolve({ boardMaker: parsed.boardMaker || '', boardModel: parsed.boardModel || '', devices });
      } catch (err) {
        reject(new Error(`อ่านผลการสแกนไม่ได้: ${err.message}`));
      }
    });
  });
}

function enumeratorOf(deviceId) {
  return String(deviceId || '').split('\\')[0].toUpperCase();
}

function classify(device) {
  // Checked ahead of the problem codes: a stand-in driver that also fails to start (an
  // iGPU on Basic Display Adapter reporting code 10, say) still means "the vendor driver
  // is missing", which is more useful than filing it under possible hardware faults.
  const isFallback = FALLBACK_DRIVERS.some(
    (f) => f.name === device.name && f.enumerator === enumeratorOf(device.deviceId)
  );
  if (isFallback) return 'fallback';
  if (MISSING_DRIVER_CODES.has(device.problemCode)) return 'missing';
  if (NOT_A_PROBLEM_CODES.has(device.problemCode)) return null;
  return device.problemCode === 0 ? null : 'other';
}

async function scanDrivers() {
  const { boardMaker, boardModel, devices } = await runScan();
  const board = searchableBoardName({ boardMaker, boardModel });
  const issues = [];
  const seen = new Map();
  for (const device of devices) {
    const kind = classify(device);
    if (!kind) continue;
    // Windows gives every HD Audio endpoint the same generic name, so onboard audio and
    // each HDMI output arrive as identical-looking rows. They are still separate devices
    // from separate vendors needing separate drivers, so the hardware ID has to be part
    // of the key — collapsing on the name alone would hide all but one of them behind a
    // "x3" badge and hand the copy button the wrong ID.
    const key = `${kind}|${device.name}|${device.pnpClass}|${device.hardwareId}`;
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const issue = {
      kind,
      name: device.name || 'Unknown device',
      pnpClass: device.pnpClass || '',
      hardwareId: device.hardwareId || '',
      problemCode: device.problemCode,
      count: 1,
      // 'other' is the possible-hardware-fault bucket (a dead USB port, a card that
      // cannot start) — pointing those at a driver download would be a wrong answer
      // dressed up as a helpful button.
      action: kind === 'other' ? null : actionFor(device.hardwareId, board),
    };
    seen.set(key, issue);
    issues.push(issue);
  }
  const order = { missing: 0, fallback: 1, other: 2 };
  issues.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  return {
    board,
    issues,
    counts: {
      missing: issues.filter((i) => i.kind === 'missing').length,
      fallback: issues.filter((i) => i.kind === 'fallback').length,
      other: issues.filter((i) => i.kind === 'other').length,
    },
    scannedDevices: devices.length,
  };
}

module.exports = { scanDrivers };
