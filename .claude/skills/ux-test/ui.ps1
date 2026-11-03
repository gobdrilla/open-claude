# UI driver for the ux-test skill (Windows). Acts on the visible Atelier window (ocui.exe).
#   shot <file.png>        screenshot of the window
#   keys <SendKeys>        e.g. "^1" (Ctrl+1), "%2" (Alt+2), "{F1}", "{ESC}", "^+e" (Ctrl+Shift+E)
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
}
"@
# Physical pixels everywhere, so screenshot and click coordinates match at any display scaling.
[W]::SetProcessDPIAware() | Out-Null
# The --lid-guard helper is also ocui.exe but has no window.
$p = Get-Process ocui -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
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

switch ($Cmd) {
  "shot" {
    $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
    $bmp.Save($A, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output "$A ($($r.R - $r.L)x$($r.B - $r.T))"
  }
  "keys" { (New-Object -ComObject WScript.Shell).SendKeys($A) }
  "click" { Mouse 2 4 }
  "rclick" { Mouse 8 16 }
  "hover" { Mouse 0 0 }
  "size" { [W]::MoveWindow($h, $r.L, $r.T, [int]$A, [int]$B, $true) | Out-Null }
  default { throw "unknown command $Cmd" }
}
Start-Sleep -Milliseconds 400
