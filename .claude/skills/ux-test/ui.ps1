# UI driver for the ux-test skill (Windows). Acts on the visible Atelier window (ocui.exe); the dev build
# (target\debug) wins over an installed Atelier that runs at the same time.
#   shot <file.png>        screenshot of the window
#   combo <keys>           shortcut with real scan codes, e.g. ctrl+1, alt+2, ctrl+shift+e, shift+esc, altgr+q, f1, down, space
#   keys <SendKeys>        type text, e.g. "Terminal.svelte" or "{BS 5}". Not for shortcuts: SendKeys leaves
#                          KeyboardEvent.code empty and the app matches Strg+1/2/3 and Alt+1…5 on e.code.
#   click|rclick|hover <x> <y>   pixel position inside the last screenshot
#   size <w> <h>           window size in physical pixels (logical size x display scaling)
param([Parameter(Mandatory)][string]$Cmd, [string]$A, [string]$B)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);
}
"@
# Physical pixels everywhere, so screenshot and click coordinates match at any display scaling.
[W]::SetProcessDPIAware() | Out-Null
# The --lid-guard helper is also ocui.exe but has no window.
$p = Get-Process ocui -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object { $_.Path -notlike "*\target\debug\*" } | Select-Object -First 1
if (-not $p) { throw "Atelier window (ocui.exe) not found" }
$h = $p.MainWindowHandle
[W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 250
$r = New-Object W+RECT
[W]::GetWindowRect($h, [ref]$r) | Out-Null

function Mouse([uint32]$down, [uint32]$up) {
  [W]::SetCursorPos($r.L + [int]$A, $r.T + [int]$B) | Out-Null
  Start-Sleep -Milliseconds 80
  if ($down) { [W]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); [W]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero) }
}

# Arrow keys, Home/End etc. and right Alt (AltGr) are extended keys.
function Ext([int]$vk) { ($vk -ge 0x21 -and $vk -le 0x2E) -or $vk -eq 0xA5 }

switch ($Cmd) {
  "shot" {
    $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
    $bmp.Save($A, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "$A ($($r.R - $r.L)x$($r.B - $r.T))"
  }
  "combo" {
    $map = @{ ctrl = 0x11; shift = 0x10; alt = 0x12; altgr = 0xA5; esc = 0x1B; enter = 0x0D; space = 0x20; tab = 0x09
      up = 0x26; down = 0x28; left = 0x25; right = 0x27; home = 0x24; end = 0x23; del = 0x2E; bs = 0x08 }
    $vks = @(foreach ($k in $A.ToLower().Split('+')) {
      if ($map.ContainsKey($k)) { $map[$k] }
      elseif ($k -match '^f(\d+)$') { 0x6F + [int]$Matches[1] }
      elseif ($k.Length -eq 1) { [int][char]$k.ToUpper() }
      else { throw "unknown key $k" }
    })
    foreach ($v in $vks) { [W]::keybd_event($v, [W]::MapVirtualKey($v, 0), [uint32](Ext $v), [UIntPtr]::Zero); Start-Sleep -Milliseconds 30 }
    [array]::Reverse($vks)
    foreach ($v in $vks) { [W]::keybd_event($v, [W]::MapVirtualKey($v, 0), [uint32](2 + (Ext $v)), [UIntPtr]::Zero) }
  }
  "keys" { (New-Object -ComObject WScript.Shell).SendKeys($A) }
  "click" { Mouse 2 4 }
  "rclick" { Mouse 8 16 }
  "hover" { Mouse 0 0 }
  "size" { [W]::MoveWindow($h, $r.L, $r.T, [int]$A, [int]$B, $true) | Out-Null }
  default { throw "unknown command $Cmd" }
}
Start-Sleep -Milliseconds 400
