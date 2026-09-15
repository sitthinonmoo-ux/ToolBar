// Gaming-related apps installable via winget (Windows Package Manager, built into
// Windows 10/11 — no bundled installers or hosted download URLs to maintain).
// iconUrl points at a real logo: simpleicons.org's CDN for brands it carries there, or
// a locally bundled file (renderer/assets/) for the rest — hotlinking a favicon service
// from a file://-loaded page is unreliable (referrer/CSP quirks vary by host), so once
// we've fetched one and confirmed it's right, it gets checked in as a static asset
// instead of fetched live every time.
const simpleIcon = (slug) => `https://cdn.simpleicons.org/${slug}/ffffff`;
const localIcon = (fileName) => `assets/${fileName}`;

const APP_CATALOG = [
  {
    id: 'steam',
    name: 'Steam',
    wingetId: 'Valve.Steam',
    description: { th: 'แพลตฟอร์มเกม PC ที่ใหญ่ที่สุด ซื้อ/เล่นเกมและแชทกับเพื่อน', en: 'The biggest PC gaming platform — buy, play, and chat with friends' },
    iconUrl: simpleIcon('steam'),
  },
  {
    id: 'discord',
    name: 'Discord',
    wingetId: 'Discord.Discord',
    description: { th: 'แชท/วอยซ์สำหรับคุยกับเพื่อนตอนเล่นเกม', en: 'Voice/text chat for gaming with friends' },
    iconUrl: simpleIcon('discord'),
  },
  {
    id: 'obs',
    name: 'OBS Studio',
    wingetId: 'OBSProject.OBSStudio',
    description: { th: 'โปรแกรมอัดคลิป/สตรีมเกมฟรี โอเพนซอร์ส', en: 'Free, open-source screen recording and live streaming' },
    iconUrl: simpleIcon('obsstudio'),
  },
  {
    id: 'streamlabs',
    name: 'Streamlabs Desktop',
    wingetId: 'Streamlabs.Streamlabs',
    description: { th: 'สตรีมเกมพร้อม overlay/alert สำเร็จรูป', en: 'Streaming with built-in overlays and alerts' },
    iconUrl: simpleIcon('streamlabs'),
  },
  {
    id: 'parsec',
    name: 'Parsec',
    wingetId: 'Parsec.Parsec',
    description: { th: 'เล่นเกมผ่าน remote desktop แบบ low-latency', en: 'Low-latency remote desktop, built for gaming' },
    iconUrl: localIcon('parsec.png'),
  },
  {
    id: 'winrar',
    name: 'WinRAR',
    wingetId: 'RARLab.WinRAR',
    description: { th: 'โปรแกรมแตกไฟล์ zip/rar ที่ใช้กันมากที่สุด', en: 'The most widely used zip/rar archive tool' },
    iconUrl: localIcon('winrar.png'),
  },
  {
    id: 'fivem',
    name: 'FiveM',
    wingetId: 'Cfx.re.FiveM',
    // winget's community-maintained manifest for this package pins a SHA256 that goes
    // stale whenever Cfx.re updates the bootstrapper at this same URL — which is often,
    // since it's a self-updating installer — so `winget install` reliably fails with
    // "Installer hash does not match" until someone gets around to refreshing the
    // manifest. directUrl lets appInstaller.js skip winget entirely for this one entry
    // and fetch the real installer straight from the vendor instead.
    directUrl: 'https://runtime.fivem.net/client/FiveM.exe',
    description: { th: 'ตัวเล่น GTA V Roleplay/multiplayer server', en: 'GTA V roleplay/multiplayer client' },
    iconUrl: simpleIcon('fivem'),
  },
  {
    id: 'nvidia-app',
    name: 'NVIDIA App',
    // Msstore-source package (no winget-source listing exists for this one) — its ID
    // isn't a reverse-DNS name because Microsoft Store IDs are opaque product codes,
    // but `winget install --id` resolves it fine without needing `--source msstore`.
    wingetId: 'XP8CLZL93F5Z4P',
    description: { th: 'อัปเดตไดรเวอร์ GPU, ปรับแต่งเกม, อัด/สตรีมด้วย Shadowplay', en: 'GPU driver updates, game optimization, and Shadowplay recording' },
    iconUrl: simpleIcon('nvidia'),
  },
  {
    id: 'rockstar-launcher',
    name: 'Rockstar Games Launcher',
    wingetId: 'RockstarGames.Launcher',
    description: { th: 'ตัวจัดการเกม/บัญชี Rockstar เช่น GTA V', en: 'Rockstar\'s game/account manager, needed for titles like GTA V' },
    iconUrl: simpleIcon('rockstargames'),
  },
  {
    id: 'anydesk',
    name: 'AnyDesk',
    wingetId: 'AnyDesk.AnyDesk',
    description: { th: 'รีโมทเข้าเครื่องจากระยะไกล', en: 'Remote desktop access' },
    iconUrl: simpleIcon('anydesk'),
  },
  {
    id: 'ghub',
    name: 'Logitech G HUB',
    wingetId: 'Logitech.GHUB',
    // No simpleicons.org entry for this brand — icon extracted from the vendor's own
    // installer .exe instead of hotlinking an unverified third-party source.
    description: { th: 'ตั้งค่าเมาส์/คีย์บอร์ด/หูฟัง Logitech G, DPI, ไฟ RGB, มาโคร', en: 'Configures Logitech G mice/keyboards/headsets — DPI, RGB, macros' },
    iconUrl: localIcon('ghub.png'),
  },
];

module.exports = { APP_CATALOG };
