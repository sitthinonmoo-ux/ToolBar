const path = require('path');
const { spawn } = require('child_process');

// Some server launchers gate Play behind their own login (LUV fetches a Steam auth
// ticket inside the launcher), so ToolBar can't skip them — it has to press their Play
// button. These launchers are NW.js builds with remote debugging and renderer
// accessibility both stripped, so there's no DOM or UI Automation handle to the button.
// What does work: posting a mouse click straight to the launcher's
// Chrome_RenderWidgetHostHWND. That lands even while the window is covered and never
// moves the user's real cursor. The button position is an offset from the client area's
// bottom-right corner (these windows are fixed-size), and `isReady` is a pixel test on
// that spot so the click waits until the button has actually rendered.
const PROFILES = {
  'luv-launcher.exe': {
    right: 115,
    bottom: 68,
    // PLAY is a saturated blue (~#2196F3); the background behind it before the UI
    // loads is dark, so "bright blue" is a reliable ready signal.
    isReady: '$c.B -gt 180 -and $c.R -lt 110 -and $c.G -gt 110',
  },
};

function buildScript(exeName, profile) {
  const procName = path.basename(exeName, '.exe');
  return `
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Text; using System.Drawing; using System.Runtime.InteropServices;
public static class TbAutoPlay {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EP cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  // Process.MainWindowHandle reads 0 for this launcher when it was started through
  // "cmd start" (as ToolBar does), so find its top-level window by pid instead.
  public static IntPtr MainOf(uint[] pids) {
    IntPtr f = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
      if (Array.IndexOf(pids, p) >= 0 && IsWindowVisible(h) && Render(h) != IntPtr.Zero) { f = h; return false; } return true; }, IntPtr.Zero);
    return f;
  }
  public static IntPtr Render(IntPtr p) {
    IntPtr f = IntPtr.Zero;
    EnumChildWindows(p, (h, l) => { var s = new StringBuilder(64); GetClassName(h, s, 64);
      if (s.ToString() == "Chrome_RenderWidgetHostHWND") { f = h; return false; } return true; }, IntPtr.Zero);
    return f;
  }
  public static Color Pixel(IntPtr h, int x, int y) {
    RECT r; GetClientRect(h, out r);
    using (var b = new Bitmap(Math.Max(1, r.R), Math.Max(1, r.B)))
    using (var g = Graphics.FromImage(b)) {
      var dc = g.GetHdc(); PrintWindow(h, dc, 3); g.ReleaseHdc(dc);
      return b.GetPixel(x, y);
    }
  }
}
"@
[TbAutoPlay]::SetProcessDPIAware() | Out-Null

function Test-FiveM { [bool](Get-Process -Name FiveM -ErrorAction SilentlyContinue) }
if (Test-FiveM) { exit 0 }

$deadline = (Get-Date).AddSeconds(90)
$attempts = 0
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 700
  if (Test-FiveM) { exit 0 }
  $pids = [uint32[]]@(Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  if ($pids.Count -eq 0) { continue }
  $h = [TbAutoPlay]::MainOf($pids)
  if ($h -eq [IntPtr]::Zero) { continue }
  if ([TbAutoPlay]::IsIconic($h)) { [TbAutoPlay]::ShowWindowAsync($h, 9) | Out-Null; continue }
  $render = [TbAutoPlay]::Render($h)
  if ($render -eq [IntPtr]::Zero) { continue }
  $r = New-Object TbAutoPlay+RECT
  [TbAutoPlay]::GetClientRect($render, [ref]$r) | Out-Null
  $x = $r.R - ${profile.right}; $y = $r.B - ${profile.bottom}
  if ($x -lt 0 -or $y -lt 0) { continue }
  try { $c = [TbAutoPlay]::Pixel($render, $x, $y) } catch { continue }
  if (-not (${profile.isReady})) { continue }

  # A short settle so the click doesn't land during the launcher's own fade-in.
  Start-Sleep -Milliseconds 800
  $lp = [IntPtr](($y -shl 16) -bor $x)
  [TbAutoPlay]::PostMessage($render, 0x0200, [IntPtr]0, $lp) | Out-Null
  Start-Sleep -Milliseconds 100
  [TbAutoPlay]::PostMessage($render, 0x0201, [IntPtr]1, $lp) | Out-Null
  Start-Sleep -Milliseconds 60
  [TbAutoPlay]::PostMessage($render, 0x0202, [IntPtr]0, $lp) | Out-Null
  $attempts++

  # Play takes a few seconds (auth ticket, then FiveM boot). Only click again if FiveM
  # never showed up, and cap it so a changed launcher layout can't click forever.
  $waitUntil = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $waitUntil) { if (Test-FiveM) { exit 0 }; Start-Sleep -Milliseconds 500 }
  if ($attempts -ge 2) { exit 2 }
}
exit 1
`;
}

// Fire-and-forget: returns whether a profile exists for this launcher, so the caller
// can word its status message; the click itself happens in the background.
function startAutoPlay(launcherPath) {
  const exeName = path.basename(launcherPath || '').toLowerCase();
  const profile = PROFILES[exeName];
  if (!profile) return false;
  const encoded = Buffer.from(buildScript(exeName, profile), 'utf16le').toString('base64');
  // Not detached: a DETACHED_PROCESS powershell.exe exits 0 straight away without
  // running its command. unref() alone is enough to keep ToolBar from waiting on it.
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
  return true;
}

module.exports = { startAutoPlay };
