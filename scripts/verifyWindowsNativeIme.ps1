# A native Windows control separates OS-input setup failures from editor defects.
# It runs only on a disposable GitHub-hosted desktop, never the owner's desktop.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'This control requires a disposable GitHub-hosted Windows runner.'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeImeControl {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public static void Key(byte key) {
    keybd_event(key, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 2, UIntPtr.Zero);
  }
  public static void ToggleJapanese() {
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    Key(0xC0);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
  }
}
'@
$form = New-Object System.Windows.Forms.Form
$form.Text = 'MarkText native IME environment control'
$form.Width = 640
$form.Height = 240
$field = New-Object System.Windows.Forms.TextBox
$field.Multiline = $true
$field.Dock = 'Fill'
$field.Font = New-Object System.Drawing.Font('Yu Gothic', 24)
$form.Controls.Add($field)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 400
$script:tick = 0
$script:failure = $null
[System.Windows.Forms.InputLanguage]::InstalledInputLanguages |
  Select-Object Culture, LayoutName | Format-List
$form.Add_Shown({
  try {
    $japanese = [System.Windows.Forms.InputLanguage]::InstalledInputLanguages |
      Where-Object { $_.Culture.Name -eq 'ja-JP' } | Select-Object -First 1
    if ($null -eq $japanese) { throw 'Japanese input is not registered in the new GUI process.' }
    [System.Windows.Forms.InputLanguage]::CurrentInputLanguage = $japanese
    [NativeImeControl]::SetForegroundWindow($form.Handle) | Out-Null
    $field.Focus() | Out-Null
    $timer.Start()
  } catch { $script:failure = $_; $form.Close() }
})
$timer.Add_Tick({
  try {
    $script:tick++
    if ([NativeImeControl]::GetForegroundWindow() -ne $form.Handle) {
      throw 'The native environment control did not retain its own foreground window.'
    }
    switch ($script:tick) {
      1 { [NativeImeControl]::ToggleJapanese() }
      2 { [NativeImeControl]::Key(0x4E) }
      3 { [NativeImeControl]::Key(0x49) }
      4 { [NativeImeControl]::Key(0x48) }
      5 { [NativeImeControl]::Key(0x4F) }
      6 { [NativeImeControl]::Key(0x4E) }
      7 { [NativeImeControl]::Key(0x20) }
      8 { [NativeImeControl]::Key(0x20) }
      9 {
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
          $bitmap.Save((Join-Path $env:RUNNER_TEMP 'native-ime-candidate-panel.png'))
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
      }
      10 { [NativeImeControl]::Key(0x26) }
      11 { [NativeImeControl]::Key(0x0D) }
      13 {
        $script:observed = $field.Text
        $timer.Stop()
        $form.Close()
      }
    }
  } catch { $script:failure = $_; $timer.Stop(); $form.Close() }
})
try { [System.Windows.Forms.Application]::Run($form) }
finally { $timer.Dispose(); $form.Dispose() }
if ($null -ne $script:failure) { throw $script:failure }
$expected = -join ([char]0x65E5, [char]0x672C)
@{ observed = $script:observed; expected = $expected } | ConvertTo-Json
if ($script:observed -ne $expected) {
  throw 'The native control did not commit the expected Japanese candidate; this is an environment/control failure, not MarkText verification.'
}
