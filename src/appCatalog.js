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
    description: { th: 'ตัวเล่น GTA V Roleplay/multiplayer server', en: 'GTA V roleplay/multiplayer client' },
    iconUrl: simpleIcon('fivem'),
  },
  {
    id: 'medal',
    name: 'Medal',
    wingetId: 'MedalB.V.Medal',
    description: { th: 'อัดคลิปไฮไลต์เกมอัตโนมัติ แชร์ง่าย', en: 'Auto-records game highlights, easy to share' },
    iconUrl: localIcon('medal.png'),
  },
];

module.exports = { APP_CATALOG };
