const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// Each tweak is one self-contained PowerShell snippet. These are exactly the settings
// found to already be in place on a well-tuned gaming machine (checked via this app's
// own diagnostics session) — the point of this plugin is to let the user reapply the
// same set in one click after a fresh Windows install, instead of hunting down each
// registry key by hand again.
// Windows loads the per-user input settings under HKCU\Control Panel\... into the live
// session once, at logon. Writing those keys therefore changes what the NEXT session will
// use while leaving the running one untouched — which is exactly the "it said it worked
// but nothing feels different" trap, made worse by the fact that a check reading the same
// key straight back reports success. Every such tweak also has to push the new value
// through SystemParametersInfo with SPIF_SENDCHANGE (0x02) so it applies right now.
// The type definition is guarded because several tweaks in one batch share this helper
// and Add-Type throws if the same class is defined twice in a single PowerShell session.
const SPI_HELPER = `
if (-not ('ToolBarSPI' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct TOOLBAR_ACCESSKEYS {
    public uint cbSize;
    public uint dwFlags;
}
public class ToolBarSPI {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, int[] pvParam, uint fWinIni);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref TOOLBAR_ACCESSKEYS pvParam, uint fWinIni);
}
'@
}
`;

const TWEAKS = {
  mousePrecision: {
    name: { th: 'ปิด Enhance Pointer Precision (mouse acceleration)', en: 'Disable Enhance Pointer Precision (mouse acceleration)' },
    admin: false,
    script: `
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name MouseSpeed -Value '0'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name MouseThreshold1 -Value '0'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name MouseThreshold2 -Value '0'
${SPI_HELPER}
$mouse = [int[]](0, 0, 0)
if (-not [ToolBarSPI]::SystemParametersInfo(0x0004, 0, $mouse, 0x03)) { throw 'SystemParametersInfo (SPI_SETMOUSE) failed' }
`,
    // Reads the value the running session is actually using (SPI_GETMOUSE), not the
    // registry copy — the registry can already say 0 while the live session still
    // accelerates, and reporting "applied" in that state is the whole bug.
    check: `
${SPI_HELPER}
$live = [int[]](1, 1, 1)
[ToolBarSPI]::SystemParametersInfo(0x0003, 0, $live, 0) | Out-Null
$p = Get-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -ErrorAction SilentlyContinue
$p -and $p.MouseSpeed -eq '0' -and $p.MouseThreshold1 -eq '0' -and $p.MouseThreshold2 -eq '0' -and $live[0] -eq 0 -and $live[1] -eq 0 -and $live[2] -eq 0
`,
  },
  powerUltimate: {
    name: { th: 'สลับแผนพลังงานเป็น Ultimate Performance', en: 'Switch power plan to Ultimate Performance' },
    admin: true,
    script: `
$scheme = powercfg /list | Select-String 'Ultimate Performance'
if (-not $scheme) { powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 | Out-Null }
$guid = (powercfg /list | Select-String 'Ultimate Performance').ToString().Split()[3]
powercfg /setactive $guid
`,
    check: `
(powercfg /getactivescheme) -match 'Ultimate Performance'
`,
  },
  networkThrottling: {
    name: { th: 'ปิด Network Throttling Index (กันเน็ตโดนหน่วงตอนมีงาน multimedia)', en: 'Disable Network Throttling Index' },
    admin: true,
    script: `
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -Name NetworkThrottlingIndex -Value 0xffffffff -Type DWord
`,
    check: `
$v = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile' -ErrorAction SilentlyContinue).NetworkThrottlingIndex
$v -eq 4294967295 -or $v -eq -1
`,
  },
  gameDvrOff: {
    name: { th: 'ปิด Xbox Game Bar / Game DVR (ลด overhead ตอนเล่นเกม)', en: 'Disable Xbox Game Bar / Game DVR' },
    admin: false,
    script: `
if (-not (Test-Path 'HKCU:\\System\\GameConfigStore')) { New-Item -Path 'HKCU:\\System\\GameConfigStore' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -Name GameDVR_Enabled -Value 0 -Type DWord
if (-not (Test-Path 'HKCU:\\SOFTWARE\\Microsoft\\GameBar')) { New-Item -Path 'HKCU:\\SOFTWARE\\Microsoft\\GameBar' -Force | Out-Null }
Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\GameBar' -Name AutoGameModeEnabled -Value 0 -Type DWord
Set-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\GameBar' -Name AllowAutoGameMode -Value 0 -Type DWord
`,
    check: `
$v = (Get-ItemProperty -Path 'HKCU:\\System\\GameConfigStore' -ErrorAction SilentlyContinue).GameDVR_Enabled
$v -eq 0
`,
  },
  hwGpuScheduling: {
    name: { th: 'เปิด Hardware-accelerated GPU Scheduling (ต้อง restart เครื่อง)', en: 'Enable Hardware-accelerated GPU Scheduling (needs a restart)' },
    admin: true,
    needsRestart: true,
    script: `
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name HwSchMode -Value 2 -Type DWord
`,
    check: `
$v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -ErrorAction SilentlyContinue).HwSchMode
$v -eq 2
`,
  },
  fivemHighPriority: {
    name: { th: 'ตั้ง High Priority ถาวรให้โปรเซส FiveM/GTA', en: 'Set permanent High Priority for FiveM/GTA processes' },
    admin: true,
    script: `
$builds = @(2372,2545,2628,2699,2802,2944,3028,3095,3179,3258,3323,3407,3488)
$exeNames = $builds | ForEach-Object { 'FiveM_b{0}_GTAProcess.exe' -f $_ }
$exeNames += @('FiveM_ROSService.exe', 'FiveM_SteamChild.exe')
foreach ($exe in $exeNames) {
  $key = "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\$exe\\PerfOptions"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  Set-ItemProperty -Path $key -Name CpuPriorityClass -Value 3 -Type DWord
  Set-ItemProperty -Path $key -Name IoPriority -Value 3 -Type DWord
}
`,
    check: `
$v = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\FiveM_ROSService.exe\\PerfOptions' -ErrorAction SilentlyContinue).CpuPriorityClass
$v -eq 3
`,
  },
  filterKeysBounceFix: {
    name: {
      th: 'แก้ Keyboard Bounce/Wait delay (กันคีย์หายตอนกดรัวๆ) — ไม่ใช่ตัว repeat rate เดิมที่ไม่ช่วยเกม',
      en: 'Fix keyboard bounce/wait delay (prevents dropped keys on rapid taps) — not the old repeat-rate hack, which does not help games',
    },
    admin: false,
    script: `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public struct FILTERKEYS {
    public uint cbSize;
    public uint dwFlags;
    public uint iWaitMSec;
    public uint iDelayMSec;
    public uint iRepeatMSec;
    public uint iBounceMSec;
}
public class ToolBarKeyboardAPI {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref FILTERKEYS pvParam, uint fWinIni);
}
'@
$fk = New-Object FILTERKEYS
$fk.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($fk)
$fk.dwFlags = 3
$fk.iWaitMSec = 0
$fk.iDelayMSec = 250
$fk.iRepeatMSec = 33
$fk.iBounceMSec = 0
$ok = [ToolBarKeyboardAPI]::SystemParametersInfo(0x0033, 0, [ref]$fk, 0x03)
if (-not $ok) { throw 'SystemParametersInfo (SPI_SETFILTERKEYS) failed' }
`,
    check: `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public struct FILTERKEYS2 {
    public uint cbSize;
    public uint dwFlags;
    public uint iWaitMSec;
    public uint iDelayMSec;
    public uint iRepeatMSec;
    public uint iBounceMSec;
}
public class ToolBarKeyboardAPIGet {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref FILTERKEYS2 pvParam, uint fWinIni);
}
'@
$fk = New-Object FILTERKEYS2
$fk.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($fk)
[ToolBarKeyboardAPIGet]::SystemParametersInfo(0x0032, 0, [ref]$fk, 0) | Out-Null
(($fk.dwFlags -band 1) -eq 1) -and $fk.iBounceMSec -eq 0 -and $fk.iWaitMSec -eq 0
`,
  },
  tcpCongestionCtcp: {
    name: { th: 'ตั้ง TCP Congestion Provider เป็น CTCP ทุก template', en: 'Set TCP Congestion Provider to CTCP for all templates' },
    admin: true,
    script: `
netsh int tcp set supplemental Internet congestionprovider=ctcp | Out-Null
netsh int tcp set supplemental Datacenter congestionprovider=ctcp | Out-Null
netsh int tcp set supplemental Compat congestionprovider=ctcp | Out-Null
`,
    check: `
$s = Get-NetTCPSetting -SettingName Internet -ErrorAction SilentlyContinue
$s -and $s.CongestionProvider -eq 'CTCP'
`,
  },
  dnsCloudflare: {
    name: { th: 'เปลี่ยน DNS เป็น Cloudflare (1.1.1.1 / 1.0.0.1)', en: 'Switch DNS to Cloudflare (1.1.1.1 / 1.0.0.1)' },
    admin: true,
    requiresCommand: 'Set-DnsClientServerAddress',
    script: `
$ifs = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
foreach ($if in $ifs) {
  Set-DnsClientServerAddress -InterfaceIndex $if.ifIndex -ServerAddresses ('1.1.1.1','1.0.0.1')
}
`,
    check: `
$ifs = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
$allSet = $true
foreach ($if in $ifs) {
  $addrs = (Get-DnsClientServerAddress -InterfaceIndex $if.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses
  if (-not $addrs -or $addrs -notcontains '1.1.1.1') { $allSet = $false }
}
$ifs.Count -gt 0 -and $allSet
`,
  },
  hpetDisable: {
    name: { th: 'ปิด HPET / Dynamic Tick (ลด timer latency)', en: 'Disable HPET / Dynamic Tick (lowers timer latency)' },
    admin: true,
    needsRestart: true,
    risk: {
      th: 'แก้ boot configuration (bcdedit) — บางเมนบอร์ด/CPU อาจทำให้เวลาของระบบเดินคลาดเคลื่อนหรือ VM/แอปที่พึ่ง high-precision timer ทำงานผิดปกติ ต้อง restart ถึงจะมีผล',
      en: 'Changes boot configuration (bcdedit) — on some boards/CPUs this can cause clock drift or break apps/VMs relying on a high-precision timer. Needs a restart to take effect.',
    },
    script: `
bcdedit /deletevalue useplatformclock | Out-Null
bcdedit /set disabledynamictick yes | Out-Null
bcdedit /set useplatformtick yes | Out-Null
`,
    check: `
$enum = bcdedit /enum '{current}'
($enum -match 'disabledynamictick\\s+Yes') -and ($enum -match 'useplatformtick\\s+Yes')
`,
  },
  cpuCoreParkingOff: {
    name: { th: 'ปิด CPU Core Parking + Processor Throttle ขั้นต่ำ/สูงสุด = 100%', en: 'Disable CPU core parking + set processor throttle min/max to 100%' },
    admin: true,
    risk: {
      th: 'ทุก core ทำงานเต็มตลอดเวลา แม้ตอนไม่ได้ใช้งานหนัก — ความร้อน/พัดลม/การใช้ไฟเพิ่มขึ้นชัดเจน โดยเฉพาะโน้ตบุ๊ก แบตหมดเร็วลง',
      en: 'Every core stays fully active even when idle — noticeably higher heat/fan noise/power draw, especially on laptops (shorter battery life).',
    },
    script: `
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR CPMINCORES 100
powercfg -setdcvalueindex SCHEME_CURRENT SUB_PROCESSOR CPMINCORES 100
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 100
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100
powercfg -setactive SCHEME_CURRENT
`,
    check: `
$q = powercfg /query SCHEME_CURRENT SUB_PROCESSOR | Out-String
$minOk = $q -match '(?s)PROCTHROTTLEMIN.*?Current AC Power Setting Index:\\s*0x00000064'
$maxOk = $q -match '(?s)PROCTHROTTLEMAX.*?Current AC Power Setting Index:\\s*0x00000064'
$minOk -and $maxOk
`,
  },
  win32PrioritySeparation: {
    name: { th: 'ตั้ง Win32PrioritySeparation = 26 (โปรไฟล์เกม)', en: 'Set Win32PrioritySeparation = 26 (gaming profile)' },
    admin: true,
    needsRestart: true,
    script: `
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name Win32PrioritySeparation -Value 26 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'GPU Priority' -Value 8 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'Priority' -Value 6 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'Scheduling Category' -Value 'High' -Type String
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games' -Name 'SFIO Priority' -Value 'High' -Type String
`,
    check: `
$v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -ErrorAction SilentlyContinue).Win32PrioritySeparation
$v -eq 26
`,
  },
  disablePagingExecutive: {
    name: { th: 'ปิด Paging Executive (ห้าม kernel paging ลง disk)', en: 'Disable Paging Executive (keeps kernel memory off disk)' },
    admin: true,
    needsRestart: true,
    risk: {
      th: 'เพิ่มการใช้ RAM ถาวรของระบบ — ถ้าเครื่องมี RAM น้อย (ต่ำกว่า 16GB) อาจทำให้แรมเต็มง่ายขึ้นแทนที่จะเร็วขึ้น',
      en: 'Increases the system\'s permanent RAM usage — on machines with less RAM (under 16GB) this can cause memory pressure instead of a speed gain.',
    },
    script: `
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -Name DisablePagingExecutive -Value 1 -Type DWord
`,
    check: `
$v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -ErrorAction SilentlyContinue).DisablePagingExecutive
$v -eq 1
`,
  },
  disableBackgroundServices: {
    name: { th: 'ปิด Background Services (SysMain, WSearch, DiagTrack)', en: 'Disable background services (SysMain, WSearch, DiagTrack)' },
    admin: true,
    risk: {
      th: 'ปิด Windows Search (WSearch) แปลว่าการค้นหาไฟล์ผ่าน Start Menu/File Explorer จะช้าลง (ค้นแบบไม่มี index) และปิด SysMain แปลว่าแอปที่เปิดบ่อยจะโหลดช้าลงเล็กน้อยตอนเปิดครั้งแรกหลังบูต',
      en: 'Disabling Windows Search (WSearch) makes Start Menu/File Explorer search slower (no index). Disabling SysMain makes frequently-used apps load slightly slower the first time after boot.',
    },
    script: `
foreach ($svc in @('SysMain','WSearch','DiagTrack')) {
  Set-Service -Name $svc -StartupType Disabled -ErrorAction SilentlyContinue
  Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
}
`,
    check: `
$names = @('SysMain','WSearch','DiagTrack')
$allDisabled = $true
foreach ($svc in $names) {
  $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
  if (-not $s -or $s.StartType -ne 'Disabled') { $allDisabled = $false }
}
$allDisabled
`,
  },
  tcpAdvancedTuning: {
    name: { th: 'TCP/UDP ขั้นสูง (RSS/RSC/ECN/timestamps/fastopen/hystart + ACK ไม่หน่วง)', en: 'Advanced TCP/UDP tuning (RSS/RSC/ECN/timestamps/fastopen/hystart + instant ACK)' },
    admin: true,
    needsRestart: true,
    script: `
netsh int tcp set global autotuninglevel=normal | Out-Null
netsh int tcp set global chimney=disabled | Out-Null
netsh int tcp set global dca=enabled | Out-Null
netsh int tcp set global ecncapability=disabled | Out-Null
netsh int tcp set global timestamps=disabled | Out-Null
netsh int tcp set global rss=enabled | Out-Null
netsh int tcp set global rsc=disabled | Out-Null
netsh int tcp set global fastopen=enabled | Out-Null
netsh int tcp set global hystart=disabled | Out-Null
netsh int tcp set global pacingprofile=off | Out-Null
netsh int udp set global uro=disabled | Out-Null
netsh int ip set global taskoffload=enabled | Out-Null
netsh int ip set global neighborcachelimit=4096 | Out-Null
netsh int ip set global routecachelimit=4096 | Out-Null
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name TcpAckFrequency -Value 1 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name TCPNoDelay -Value 1 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name TcpDelAckTicks -Value 0 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name TcpMaxDupAcks -Value 2 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name DefaultTTL -Value 64 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name EnablePMTUDiscovery -Value 1 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name MaxUserPort -Value 65534 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -Name TcpTimedWaitDelay -Value 30 -Type DWord
`,
    check: `
$v = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters' -ErrorAction SilentlyContinue)
$g = netsh int tcp show global
$v -and $v.TcpAckFrequency -eq 1 -and $v.TCPNoDelay -eq 1 -and ($g -match 'ECN Capability\\s*:\\s*disabled') -and ($g -match 'RFC 1323 Timestamps\\s*:\\s*disabled')
`,
  },
  qosBitsDelivery: {
    // netsh's "qos" context (used by most of the .bat guides floating around) isn't a
    // real netsh helper on Windows 10/11 — it silently no-ops. New-NetQosPolicy (NetQos
    // module) is the actual supported way to set a DSCP/QoS policy per app.
    name: { th: 'QoS ให้ FiveM/GTA5 + ปิด BITS/Delivery Optimization', en: 'QoS policy for FiveM/GTA5 + disable BITS/Delivery Optimization' },
    admin: true,
    requiresCommand: 'New-NetQosPolicy',
    risk: {
      th: 'ปิด Windows Update background download (Delivery Optimization) + ตั้ง BITS เป็น Manual — บางโปรแกรม/Windows Update อาจโหลดอัปเดตช้าลง',
      en: 'Disables Windows Update background downloads (Delivery Optimization) + sets BITS to Manual — some apps/Windows Update may download updates more slowly.',
    },
    script: `
Remove-NetQosPolicy -Name 'FiveM_QoS' -Confirm:$false -ErrorAction SilentlyContinue
Remove-NetQosPolicy -Name 'GTA5_QoS' -Confirm:$false -ErrorAction SilentlyContinue
New-NetQosPolicy -Name 'FiveM_QoS' -AppPathNameMatchCondition 'FiveM.exe' -DSCPAction 46 -NetworkProfile All | Out-Null
New-NetQosPolicy -Name 'GTA5_QoS' -AppPathNameMatchCondition 'GTA5.exe' -DSCPAction 46 -NetworkProfile All | Out-Null
Set-Service -Name BITS -StartupType Manual -ErrorAction SilentlyContinue
Stop-Service -Name BITS -Force -ErrorAction SilentlyContinue
if (-not (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config')) {
  New-Item -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config' -Force | Out-Null
}
Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config' -Name DODownloadMode -Value 0 -Type DWord
`,
    check: `
$policy = Get-NetQosPolicy -Name 'FiveM_QoS' -ErrorAction SilentlyContinue
$bits = (Get-Service -Name BITS -ErrorAction SilentlyContinue).StartType
$do = (Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\DeliveryOptimization\\Config' -ErrorAction SilentlyContinue).DODownloadMode
[bool]$policy -and $bits -eq 'Manual' -and $do -eq 0
`,
  },
  inputBufferSize: {
    name: { th: 'ลด Mouse/Keyboard Driver Buffer Size (ลด input lag)', en: 'Reduce mouse/keyboard driver buffer size (lowers input lag)' },
    admin: true,
    needsRestart: true,
    script: `
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters' -Name MouseDataQueueSize -Value 16 -Type DWord
Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters' -Name KeyboardDataQueueSize -Value 16 -Type DWord
`,
    check: `
$m = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\mouclass\\Parameters' -ErrorAction SilentlyContinue).MouseDataQueueSize
$k = (Get-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\kbdclass\\Parameters' -ErrorAction SilentlyContinue).KeyboardDataQueueSize
$m -eq 16 -and $k -eq 16
`,
  },
  disableAccessibilityShortcuts: {
    name: { th: 'ปิดทางลัดเปิด Sticky/Toggle Keys (กันเผลอโดนตอนเล่นเกม)', en: 'Disable Sticky/Toggle Keys shortcuts (prevents accidental triggers while gaming)' },
    admin: false,
    script: `
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\StickyKeys' -Name Flags -Value '506'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\ToggleKeys' -Name Flags -Value '58'
${SPI_HELPER}
$sk = New-Object TOOLBAR_ACCESSKEYS
$sk.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($sk)
$sk.dwFlags = 506
if (-not [ToolBarSPI]::SystemParametersInfo(0x003B, 0, [ref]$sk, 0x03)) { throw 'SystemParametersInfo (SPI_SETSTICKYKEYS) failed' }
$tk = New-Object TOOLBAR_ACCESSKEYS
$tk.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($tk)
$tk.dwFlags = 58
if (-not [ToolBarSPI]::SystemParametersInfo(0x0035, 0, [ref]$tk, 0x03)) { throw 'SystemParametersInfo (SPI_SETTOGGLEKEYS) failed' }
`,
    // SPI_GETSTICKYKEYS / SPI_GETTOGGLEKEYS report what the session will actually honour
    // when the hotkey is pressed, which is the thing this tweak is meant to disable.
    check: `
${SPI_HELPER}
$liveSk = New-Object TOOLBAR_ACCESSKEYS
$liveSk.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($liveSk)
[ToolBarSPI]::SystemParametersInfo(0x003A, 0, [ref]$liveSk, 0) | Out-Null
$liveTk = New-Object TOOLBAR_ACCESSKEYS
$liveTk.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($liveTk)
[ToolBarSPI]::SystemParametersInfo(0x0034, 0, [ref]$liveTk, 0) | Out-Null
$sk = (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\StickyKeys' -ErrorAction SilentlyContinue).Flags
$tk = (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Accessibility\\ToggleKeys' -ErrorAction SilentlyContinue).Flags
$sk -eq '506' -and $tk -eq '58' -and $liveSk.dwFlags -eq 506 -and $liveTk.dwFlags -eq 58
`,
  },
  keyboardSpeedMax: {
    name: { th: 'ตั้ง Keyboard Delay ต่ำสุด / Speed สูงสุด', en: 'Set keyboard delay to minimum / speed to maximum' },
    admin: false,
    script: `
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Keyboard' -Name KeyboardDelay -Value '0'
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Keyboard' -Name KeyboardSpeed -Value '31'
${SPI_HELPER}
if (-not [ToolBarSPI]::SystemParametersInfo(0x000B, 31, [IntPtr]::Zero, 0x03)) { throw 'SystemParametersInfo (SPI_SETKEYBOARDSPEED) failed' }
if (-not [ToolBarSPI]::SystemParametersInfo(0x0017, 0, [IntPtr]::Zero, 0x03)) { throw 'SystemParametersInfo (SPI_SETKEYBOARDDELAY) failed' }
`,
    // SPI_GETKEYBOARDSPEED / SPI_GETKEYBOARDDELAY return the live session's values, so a
    // registry write that has not reached the session yet can no longer pass as applied.
    check: `
${SPI_HELPER}
$speed = [int[]](0)
$delay = [int[]](0)
[ToolBarSPI]::SystemParametersInfo(0x000A, 0, $speed, 0) | Out-Null
[ToolBarSPI]::SystemParametersInfo(0x0016, 0, $delay, 0) | Out-Null
$p = Get-ItemProperty -Path 'HKCU:\\Control Panel\\Keyboard' -ErrorAction SilentlyContinue
$p -and $p.KeyboardDelay -eq '0' -and $p.KeyboardSpeed -eq '31' -and $speed[0] -eq 31 -and $delay[0] -eq 0
`,
  },
  usbSelectiveSuspendOff: {
    name: { th: 'ปิด USB Selective Suspend (กัน mouse/keyboard หน่วงตอน wake)', en: 'Disable USB Selective Suspend (prevents mouse/keyboard wake lag)' },
    admin: true,
    risk: {
      th: 'อุปกรณ์ USB ทุกตัว (รวมที่ชาร์จผ่าน USB) จะไม่เข้าโหมดประหยัดไฟเลย ใช้ไฟเพิ่มขึ้นเล็กน้อย เห็นผลชัดสุดบนโน้ตบุ๊ก',
      en: 'Every USB device (including anything charging over USB) never enters power-saving mode — slightly higher power draw, most noticeable on laptops.',
    },
    script: `
powercfg /setacvalueindex scheme_current 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg /setactive scheme_current
`,
    check: `
$q = powercfg /query scheme_current 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 | Out-String
$q -match 'Current AC Power Setting Index:\\s*0x00000000'
`,
  },
  memoryCompressionOff: {
    name: { th: 'ปิด Memory Compression', en: 'Disable Memory Compression' },
    admin: true,
    requiresCommand: 'Disable-MMAgent',
    risk: {
      th: 'ถ้า RAM น้อย (ต่ำกว่า 16GB) การปิด memory compression อาจทำให้ระบบ swap ลง disk บ่อยขึ้นแทน ซึ่งช้ากว่าเดิม — เหมาะกับเครื่อง RAM เยอะเท่านั้น',
      en: 'On machines with less RAM (under 16GB), disabling this can make the system swap to disk more often instead — slower than before. Only worth it on RAM-rich machines.',
    },
    // Disable-MMAgent is CIM-backed and, on machines where the underlying Superfetch/
    // SysMain service is disabled, raises a NON-terminating error ("service cannot be
    // started...") that ignores the script-level $ErrorActionPreference = 'Stop' —
    // it silently falls through to Write-Output 'TOOLBAR_TWEAK_OK:...' below as if it
    // succeeded, while also dumping a raw PowerShell error block into the captured
    // output. Passing -ErrorAction Stop directly on the cmdlet call (not just relying on
    // the ambient preference) is the only way to force it into the try/catch reliably.
    script: `
Disable-MMAgent -MemoryCompression -ErrorAction Stop
`,
    check: `
-not (Get-MMAgent).MemoryCompression
`,
  },
  mouseRawCurve: {
    name: { th: 'ตั้ง Mouse Curve เป็น Raw 1:1 (custom curve)', en: 'Set mouse curve to raw 1:1 (custom curve)' },
    admin: false,
    needsRestart: true,
    script: `
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name SmoothMouseXCurve -Value ([byte[]](0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xC0,0xCC,0x0C,0x00,0x00,0x00,0x00,0x00,0x80,0x99,0x19,0x00,0x00,0x00,0x00,0x00,0x40,0x66,0x26,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x99,0x33,0x00,0x00,0x00,0x00,0x00))
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -Name SmoothMouseYCurve -Value ([byte[]](0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x38,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x70,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xA8,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xC0,0xDC,0x00,0x00,0x00,0x00,0x00))
`,
    check: `
$p = Get-ItemProperty -Path 'HKCU:\\Control Panel\\Mouse' -ErrorAction SilentlyContinue
$p -and $p.SmoothMouseXCurve -and ($p.SmoothMouseXCurve[8] -eq 0xC0)
`,
  },
};

// Sentinel thrown by a tweak whose write succeeded but whose read-back says the value
// never took hold. It stays ASCII and marker-shaped so it survives the round trip through
// the script's stdout; summarizeOutput swaps it for the Thai explanation the user reads.
const VERIFY_FAILED = 'TOOLBAR_VERIFY_FAILED';

function listTweaks() {
  return Object.entries(TWEAKS).map(([key, t]) => ({
    key,
    name: t.name,
    admin: t.admin,
    risk: t.risk || null,
    needsRestart: !!t.needsRestart,
  }));
}

// Builds one PS script where every selected tweak runs in its OWN try/catch block and
// reports its own OK/FAIL line. This means one broken tweak (missing module, odd driver
// state, etc.) can never block the rest of the batch from applying — each tweak either
// lands or doesn't, independently. A tweak declaring requiresCommand gets a friendly
// "not available on this machine" failure instead of a raw .NET exception message.
// A best-effort System Restore Point is created first (skipped, not fatal, if System
// Restore is off or was already used in the last 24h) so the whole batch can be undone
// in one place regardless of what kind of setting each tweak touches.
// Script content stays plain-ASCII on purpose (restore-point label included) — a non-ASCII
// character embedded in a .ps1 file written without a BOM gets misread by PowerShell's
// parser under the system codepage, which can silently corrupt a string terminator and
// cascade into parse errors through the rest of the file. All Thai display text lives on
// the JS side (tweak names, warnings) and never needs to cross into the script itself.
function buildBatchScript(selected, restoreLabel) {
  const doneMarker = `TOOLBAR_TWEAKS_DONE_${Date.now()}`;
  // Windows throttles restore-point creation to once per 24h — when throttled,
  // Checkpoint-Computer does NOT throw; it just writes a WARNING and returns normally,
  // so without -WarningAction Stop this silently "succeeds" and tells the user they have
  // an undo point when none was actually created. -WarningAction Stop is what turns that
  // warning into a catchable error so the SKIP branch (and its honest message) actually
  // fires in that case.
  const restorePointBlock = `
try {
  Checkpoint-Computer -Description ${JSON.stringify(restoreLabel)} -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop -WarningAction Stop
  Write-Output 'TOOLBAR_RESTOREPOINT_OK'
} catch {
  Write-Output "TOOLBAR_RESTOREPOINT_SKIP: $($_.Exception.Message)"
}
`;
  const tweakBlocks = selected
    .map(([key, t]) => {
      const guard = t.requiresCommand
        ? `if (-not (Get-Command '${t.requiresCommand}' -ErrorAction SilentlyContinue)) { throw 'Command ${t.requiresCommand} is not available on this machine (this Windows edition may be missing the related module)' }\n`
        : '';
      // A script that ran without throwing is NOT the same as a setting that took hold:
      // a write can land on a key Windows ignores, a netsh/powercfg call can print its
      // own failure and still exit 0, and a value can be overwritten again moments later.
      // Every tweak already ships the read-back that checkStatus() uses for its badges, so
      // the apply path runs that same read-back and only claims success when it passes.
      // The check runs in its own scope with SilentlyContinue (several bodies rely on a
      // missing key returning $null rather than throwing) and its last emitted value is
      // the verdict — matching how checkStatus() evaluates the identical script.
      const verify = t.check
        ? `$verify_${key} = @(& {
  $ErrorActionPreference = 'SilentlyContinue'
  try {
${t.check.trim()}
  } catch { $false }
}) | Select-Object -Last 1
if ($verify_${key} -ne $true) { throw '${VERIFY_FAILED}' }\n`
        : '';
      return `try {\n${guard}${t.script}\n${verify}  Write-Output 'TOOLBAR_TWEAK_OK:${key}'\n} catch {\n  Write-Output "TOOLBAR_TWEAK_FAIL:${key}: $($_.Exception.Message)"\n}`;
    })
    .join('\n');
  const fullScript = `$ErrorActionPreference = 'Stop'\n${restorePointBlock}\n${tweakBlocks}\nWrite-Output '${doneMarker}'\n`;
  return { fullScript, doneMarker };
}

// Marker lines are `TOOLBAR_TWEAK_OK:<key>` (own line) and `TOOLBAR_TWEAK_FAIL:<key>: <msg>`.
// The OK check needs an explicit end-of-line boundary after <key> — without it, a key that
// happens to be a string prefix of another selected key's name would false-match on the
// longer one's marker (e.g. a future "tcp" key inside "TOOLBAR_TWEAK_OK:tcpAdvancedTuning").
// The FAIL check is naturally safe already since a literal ':' always follows <key> there.
function hasOkMarker(text, key) {
  return new RegExp(`TOOLBAR_TWEAK_OK:${key}(\\r?\\n|$)`).test(text);
}

// Parses the per-tweak OK/FAIL lines (and the restore-point line) out of the script's
// stdout and turns them into a summary the UI can show — which tweaks landed, which
// were skipped and why, whether a restore point now exists to undo this batch.
function summarizeOutput(output, selected) {
  const ok = [];
  const failed = [];
  for (const [key, t] of selected) {
    if (hasOkMarker(output, key)) {
      ok.push(t.name.th);
      continue;
    }
    const failMatch = output.match(new RegExp(`TOOLBAR_TWEAK_FAIL:${key}: (.+)`));
    const rawReason = failMatch ? failMatch[1].trim() : 'ไม่ทราบสาเหตุ';
    const reason = rawReason.includes(VERIFY_FAILED)
      ? 'เขียนค่าลงไปแล้ว แต่ตรวจสอบย้อนกลับไม่ผ่าน — ค่ายังไม่มีผลจริง'
      : rawReason;
    failed.push({ name: t.name.th, reason });
  }
  const restorePointOk = output.includes('TOOLBAR_RESTOREPOINT_OK');
  const lines = [];
  if (ok.length) lines.push(`ปรับสำเร็จ (ตรวจสอบย้อนกลับแล้ว) ${ok.length} รายการ: ${ok.join(', ')}`);
  if (failed.length) lines.push(`ทำไม่สำเร็จ ${failed.length} รายการ: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}`);
  // Only the tweaks that genuinely can't take effect until a reboot get the notice, and
  // only when one of them actually landed — the old blanket "some items need a restart"
  // line was appended to every elevated batch, so it read as boilerplate and told the user
  // nothing about which setting they were still waiting on.
  const restartPending = selected
    .filter(([key, t]) => t.needsRestart && hasOkMarker(output, key))
    .map(([, t]) => t.name.th);
  if (restartPending.length) {
    lines.push(`ต้อง restart เครื่องก่อนถึงจะมีผลจริง ${restartPending.length} รายการ: ${restartPending.join(', ')}`);
  }
  lines.push(
    restorePointOk
      ? 'สร้าง System Restore Point ไว้ก่อนแก้แล้ว — ถ้าอยากย้อนกลับทั้งหมด ใช้ System Restore ได้'
      : 'ข้ามการสร้าง System Restore Point (อาจปิดอยู่ หรือสร้างไปแล้วในช่วง 24 ชม.ที่ผ่านมา) — ปรับด้วยความระวัง'
  );
  // Success means every selected tweak landed. Reporting green when one item out of ten
  // worked is what let a mostly-failed batch look like a clean run.
  return {
    success: failed.length === 0 && ok.length > 0,
    message: lines.join('\n'),
    okCount: ok.length,
    failCount: failed.length,
  };
}

// Scans the growing output buffer for OK/FAIL markers belonging to tweaks we haven't
// already reported, so the caller can drive a progress bar as each tweak finishes
// instead of only finding out at the very end.
function extractNewProgress(buffer, selected, seen) {
  const events = [];
  for (const [key] of selected) {
    if (seen.has(key)) continue;
    if (hasOkMarker(buffer, key)) {
      seen.add(key);
      events.push({ key, status: 'ok', done: seen.size, total: selected.length });
    } else if (new RegExp(`TOOLBAR_TWEAK_FAIL:${key}:`).test(buffer)) {
      seen.add(key);
      events.push({ key, status: 'fail', done: seen.size, total: selected.length });
    }
  }
  return events;
}

// Anything touching HKLM (or services/power/boot config) needs admin, so if any selected
// tweak requires it we elevate the *whole* script once (one UAC prompt) rather than
// asking per-tweak. onProgress(optional) is called as each tweak finishes: { key, status, done, total }.
async function applyTweaks(selectedKeys, onProgress) {
  const selected = selectedKeys.map((k) => [k, TWEAKS[k]]).filter(([, t]) => t);
  if (selected.length === 0) return { success: false, message: 'ไม่ได้เลือกรายการที่จะปรับ' };

  const needsAdmin = selected.some(([, t]) => t.admin);
  const restoreLabel = `ToolBar tweaks (${selected.length} items) ${new Date().toISOString()}`;
  const { fullScript, doneMarker } = buildBatchScript(selected, restoreLabel);

  const scriptPath = path.join(os.tmpdir(), `toolbar-tweaks-${Date.now()}.ps1`);
  // UTF-8 BOM: without it, PowerShell 5.1 guesses the file's encoding from the system
  // codepage instead of trusting it's UTF-8 — safe here since the script is ASCII-only,
  // but keeping the BOM is cheap insurance against any future non-ASCII creeping in.
  fs.writeFileSync(scriptPath, '﻿' + fullScript, 'utf8');

  try {
    if (needsAdmin) {
      return await runElevated(scriptPath, doneMarker, selected, onProgress);
    }
    return await runDirect(scriptPath, doneMarker, selected, onProgress);
  } finally {
    fs.rm(scriptPath, { force: true }, () => {});
  }
}

function runDirect(scriptPath, marker, selected, onProgress) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const seen = new Set();
    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (onProgress) for (const evt of extractNewProgress(stdout, selected, seen)) onProgress(evt);
    });
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ success: false, message: `รันสคริปต์ไม่สำเร็จ: ${err.message}` }));
    child.on('exit', (code) => {
      if (stdout.includes(marker)) {
        resolve(summarizeOutput(stdout, selected));
      } else {
        resolve({ success: false, message: `ปรับค่าไม่สำเร็จ: ${stderr.trim() || stdout.trim() || `exit code ${code}`}` });
      }
    });
  });
}

// Elevates by launching a second PowerShell with -Verb RunAs; Windows shows the UAC
// prompt for that child, and -Wait blocks the (unelevated) parent until it finishes.
// We can't read the elevated child's stdout directly, so it writes its own result to
// a temp file that this process reads back afterward — polling that file periodically
// while waiting is what lets the progress bar move before the whole batch is done.
//
// IMPORTANT: `*> resultPath` (redirecting straight to a new file) makes Windows
// PowerShell 5.1 write that file as UTF-16LE with a BOM — but everything downstream
// (extractNewProgress, summarizeOutput, the `output.includes(marker)` done-check) reads
// it back as plain UTF-8. That mismatch means EVERY OTHER byte of the "UTF-8" string is
// a stray null character, which silently breaks all substring/regex matching against it
// (a script that actually finished successfully, markers and all, could get reported as
// a total failure with a garbled wall of text as the "error"). Piping through
// `Out-File -Encoding utf8` instead forces real UTF-8 output, which Node's
// `fs.readFileSync(path, 'utf8')` decodes correctly.
function runElevated(scriptPath, marker, selected, onProgress) {
  const resultPath = `${scriptPath}.result.txt`;
  const wrapped = `
& '${scriptPath}' *>&1 | Out-File -FilePath '${resultPath}' -Encoding utf8
`;
  const wrapperPath = `${scriptPath}.wrapper.ps1`;
  fs.writeFileSync(wrapperPath, wrapped, 'utf8');

  return new Promise((resolve) => {
    const seen = new Set();
    const poll = onProgress
      ? setInterval(() => {
          try {
            const partial = fs.readFileSync(resultPath, 'utf8');
            for (const evt of extractNewProgress(partial, selected, seen)) onProgress(evt);
          } catch {
            // file doesn't exist yet (UAC prompt still up, or PowerShell hasn't started writing) — fine, retry next tick
          }
        }, 300)
      : null;

    const launcher = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${wrapperPath}"' -Verb RunAs -Wait`,
      ],
      { windowsHide: true }
    );
    launcher.on('error', (err) => {
      if (poll) clearInterval(poll);
      resolve({ success: false, message: `เปิดสิทธิ์ Administrator ไม่สำเร็จ: ${err.message}` });
    });
    launcher.on('exit', () => {
      if (poll) clearInterval(poll);
      let output = '';
      try {
        output = fs.readFileSync(resultPath, 'utf8');
      } catch {
        // user likely clicked "No" on the UAC prompt — no result file was written
        resolve({ success: false, message: 'ไม่ได้รับสิทธิ์ Administrator (ยกเลิก UAC หรือปิดหน้าต่างไป) — ลองใหม่แล้วกด "ใช่"' });
        return;
      } finally {
        fs.rm(wrapperPath, { force: true }, () => {});
        fs.rm(resultPath, { force: true }, () => {});
      }
      if (output.includes(marker)) {
        // Catch any tweak whose OK/FAIL line landed between the last poll tick and exit.
        if (onProgress) for (const evt of extractNewProgress(output, selected, seen)) onProgress(evt);
        // The restart notice now comes from summarizeOutput, which names the specific
        // tweaks that need one — and does so on the unelevated path too, where several
        // HKCU tweaks that need a re-logon used to get no warning at all.
        resolve(summarizeOutput(output, selected));
      } else {
        resolve({ success: false, message: `ปรับค่าไม่สำเร็จ: ${output.trim() || 'ไม่ทราบสาเหตุ'}` });
      }
    });
  });
}

// Read-only: queries the current state of every tweak so the UI can show which ones
// are already applied. Never needs admin — HKLM reads don't require elevation, only writes do.
function checkStatus() {
  return new Promise((resolve) => {
    const entries = Object.entries(TWEAKS).filter(([, t]) => t.check);
    // Each check body may be several statements (assign, then test), so it has to run
    // inside a script block ( & { ... } ) rather than a plain (...) grouping, which
    // PowerShell only lets hold a single expression.
    const body = entries
      .map(([key, t]) => `$result_${key} = & {\n${t.check.trim()}\n}\nWrite-Output "TOOLBAR_CHECK_${key}=$($result_${key} -eq $true)"`)
      .join('\n');
    const fullScript = `$ErrorActionPreference = 'SilentlyContinue'\n${body}\n`;
    const scriptPath = path.join(os.tmpdir(), `toolbar-check-${Date.now()}.ps1`);
    fs.writeFileSync(scriptPath, fullScript, 'utf8');

    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => {
      fs.rm(scriptPath, { force: true }, () => {});
      resolve({});
    });
    child.on('exit', () => {
      fs.rm(scriptPath, { force: true }, () => {});
      const status = {};
      for (const [key] of entries) {
        const match = stdout.match(new RegExp(`TOOLBAR_CHECK_${key}=(True|False)`));
        status[key] = match ? match[1] === 'True' : null;
      }
      resolve(status);
    });
  });
}

module.exports = { listTweaks, applyTweaks, checkStatus };
