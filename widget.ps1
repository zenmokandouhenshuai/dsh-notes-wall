# Sticky-note desktop widget (always-on-top, independent of the DSH window).
# Reads $DSH_HOME/dsh-notes/notes.json and shows one borderless topmost window
# per note whose "desktop" flag is true. Dragging moves a window, the edges and
# the bottom-right corner resize it, the small X unpins that note, and a thin
# overlay thumb scrolls long text. Keep this file pure ASCII: Windows PowerShell
# 5.1 would read a BOM-less UTF-8 script as ANSI and garble any Chinese literal.
param([string]$StateFile, [string]$Unpin, [switch]$Persist, [string]$InstanceTag, [string]$LogFile)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Log([string]$message) {
  if (-not $LogFile) { return }
  try { Add-Content -LiteralPath $LogFile -Value ((Get-Date -Format 'HH:mm:ss.fff') + ' ' + $message) } catch { }
}

if (-not ('NativeUi' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeUi {
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height);
  [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hwnd, IntPtr rgn, bool redraw);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
}
'@
}

if (-not $StateFile) {
  $root = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
  $StateFile = Join-Path $root 'dsh-notes\notes.json'
}
$PosFile = Join-Path (Split-Path -Parent $StateFile) 'widget-pos.json'

$Palette = @{
  butter = @{ bg = '#FEE6A3'; border = '#EDD289'; ink = '#3B3423' }
  cream  = @{ bg = '#F4EBD0'; border = '#E2D5B2'; ink = '#3B3628' }
  mint   = @{ bg = '#BFE9E0'; border = '#A6D7CC'; ink = '#223B35' }
  sky    = @{ bg = '#BBE0FA'; border = '#9FCEF0'; ink = '#1F3341' }
  blush  = @{ bg = '#F7BACC'; border = '#E9A2B6'; ink = '#42242D' }
  lilac  = @{ bg = '#D8CAF6'; border = '#C2AFEC'; ink = '#302A44' }
}
$DefaultStyle = @{ bg = '#F7F7F4'; border = '#D8D8D0'; ink = '#25251F' }

$script:Forms = @{}
$script:IdleTicks = 0
$script:DragActive = $false
$script:DragCursor = $null
$script:DragStart = $null
$script:DragForm = $null
$script:Resize = $null
$script:ThumbDrag = $null

function Read-State {
  try {
    if (-not (Test-Path -LiteralPath $StateFile)) { return $null }
    $stream = [System.IO.File]::Open($StateFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $reader = New-Object System.IO.StreamReader($stream, (New-Object System.Text.UTF8Encoding($false)))
      $text = $reader.ReadToEnd()
    } finally {
      if ($reader) { $reader.Dispose() }
      $stream.Dispose()
    }
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    return ($text | ConvertFrom-Json)
  } catch {
    return $null
  }
}

function Style-Of($note) {
  $key = ''
  if ($note.color) { $key = [string]$note.color }
  if ($Palette.ContainsKey($key)) { return $Palette[$key] }
  return $DefaultStyle
}

function Blend($top, $bottom, [double]$amount) {
  $r = [int]($top.R * $amount + $bottom.R * (1 - $amount))
  $g = [int]($top.G * $amount + $bottom.G * (1 - $amount))
  $b = [int]($top.B * $amount + $bottom.B * (1 - $amount))
  return [System.Drawing.Color]::FromArgb($r, $g, $b)
}

function Set-Form-Round($form) {
  try {
    $rgn = [NativeUi]::CreateRoundRectRgn(0, 0, $form.Width + 1, $form.Height + 1, 16, 16)
    [void][NativeUi]::SetWindowRgn($form.Handle, $rgn, $true)
  } catch {
    Log ('round failed: ' + $_.Exception.Message)
  }
}

function Set-Pill($control) {
  try {
    $rgn = [NativeUi]::CreateRoundRectRgn(0, 0, $control.Width + 1, $control.Height + 1, 6, 6)
    $control.Region = [System.Drawing.Region]::FromHrgn($rgn)
    [void][NativeUi]::DeleteObject($rgn)
  } catch { }
}

function Unpin-Note([string]$id) {
  $state = Read-State
  if (-not $state) { return }
  $notes = @($state.notes)
  $changed = $false
  foreach ($note in $notes) {
    if ([string]$note.id -ceq $id) {
      if ($note.desktop -eq $true) { $note.desktop = $false; $changed = $true }
    }
  }
  if (-not $changed) { return }
  # Compose the document by hand: Windows PowerShell 5.1 turns a one-element
  # array into an object, which would make the Host read the wall as empty.
  $parts = @()
  foreach ($note in $notes) {
    if ($null -ne $note) { $parts += ($note | ConvertTo-Json -Depth 8 -Compress) }
  }
  $stamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $json = '{"version":1,"notes":[' + ($parts -join ',') + '],"updatedAt":"' + $stamp + '"}'
  try {
    $temp = $StateFile + '.tmp-widget-' + $PID
    [System.IO.File]::WriteAllText($temp, $json, (New-Object System.Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temp -Destination $StateFile -Force
  } catch {
    # The Host may be rewriting the file at the same moment; the window closes
    # anyway and the next sync removes it.
  }
}

# Geometry is kept out of notes.json so the Host's whole-file writes never fight
# with a drag or a resize.
function Read-Positions {
  try {
    if (-not (Test-Path -LiteralPath $PosFile)) { return @{} }
    $text = [System.IO.File]::ReadAllText($PosFile, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($text)) { return @{} }
    $map = @{}
    foreach ($prop in ($text | ConvertFrom-Json).PSObject.Properties) {
      if ($prop.Value -and $null -ne $prop.Value.x -and $null -ne $prop.Value.y) {
        $entry = @{ x = [int]$prop.Value.x; y = [int]$prop.Value.y }
        if ($null -ne $prop.Value.w -and $null -ne $prop.Value.h) {
          $entry.w = [int]$prop.Value.w
          $entry.h = [int]$prop.Value.h
        }
        $map[$prop.Name] = $entry
      }
    }
    return $map
  } catch {
    return @{}
  }
}

function Save-Position([string]$id, $form) {
  try {
    $map = Read-Positions
    $map[$id] = @{
      x = [int]$form.Left
      y = [int]$form.Top
      w = [int]$form.Width
      h = [int]$form.Height
    }
    $parts = @()
    foreach ($key in $map.Keys) {
      if ($key -match '^[A-Za-z0-9_-]{1,64}$') {
        $parts += ('"' + $key + '":' + ($map[$key] | ConvertTo-Json -Depth 3 -Compress))
      }
    }
    $json = '{' + ($parts -join ',') + '}'
    [System.IO.File]::WriteAllText($PosFile, $json, (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

function Get-DefaultPosition([int]$top) {
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $x = [Math]::Max(8, $area.Right - 300)
  $y = [Math]::Min([Math]::Max(8, $top), [Math]::Max(8, $area.Bottom - 160))
  return New-Object System.Drawing.Point($x, $y)
}

function Update-Scroll($entry) {
  $form = $entry.Form
  if (-not $form -or $form.IsDisposed) { return }
  $viewH = [Math]::Max(24, ($form.ClientSize.Height - 20))
  $contentH = [Math]::Max(1, $entry.Label.Height)
  $max = [Math]::Max(0, ($contentH - $viewH))
  if ($entry.Offset -gt $max) { $entry.Offset = $max }
  if ($entry.Offset -lt 0) { $entry.Offset = 0 }
  $entry.Label.Location = New-Object System.Drawing.Point(12, (10 - [int]$entry.Offset))
  if ($max -le 0) {
    $entry.Thumb.Visible = $false
    return
  }
  $entry.Thumb.Visible = $true
  $trackTop = 26
  $trackBottom = $form.ClientSize.Height - 8
  $trackH = $trackBottom - $trackTop
  if ($trackH -lt 30) { $trackH = 30 }
  $thumbH = [int][Math]::Round($trackH * $viewH / $contentH)
  if ($thumbH -lt 24) { $thumbH = 24 }
  if ($thumbH -gt $trackH) { $thumbH = $trackH }
  $travel = $trackH - $thumbH
  $y = $trackTop
  if ($travel -gt 0) { $y = $trackTop + [int][Math]::Round($travel * ($entry.Offset / $max)) }
  $entry.Thumb.Bounds = New-Object System.Drawing.Rectangle(($form.ClientSize.Width - 11), $y, 6, $thumbH)
  Set-Pill $entry.Thumb
  Log ('scroll ' + $entry.Form.Tag + ' viewH=' + $viewH + ' contentH=' + $contentH + ' max=' + $max + ' thumbH=' + $thumbH + ' y=' + $y)
}

function Layout-Note($entry) {
  $form = $entry.Form
  if (-not $form -or $form.IsDisposed) { return }
  $w = $form.ClientSize.Width
  $entry.Close.Location = New-Object System.Drawing.Point(($w - 24), 4)
  $entry.Label.MaximumSize = New-Object System.Drawing.Size([Math]::Max(80, ($w - 48)), 0)
  Update-Scroll $entry
  Set-Form-Round $form
}

function Start-Drag($sender) {
  $form = $null
  if ($sender -is [System.Windows.Forms.Control]) { $form = $sender.FindForm() }
  if (-not ($form -is [System.Windows.Forms.Form])) { return }
  $script:DragActive = $true
  $script:DragForm = $form
  $script:DragCursor = [System.Windows.Forms.Cursor]::Position
  $script:DragStart = $form.Location
}

function Move-Drag {
  if (-not $script:DragActive) { return }
  if (-not $script:DragForm -or $script:DragForm.IsDisposed) { $script:DragActive = $false; return }
  $point = [System.Windows.Forms.Cursor]::Position
  $dx = $point.X - $script:DragCursor.X
  $dy = $point.Y - $script:DragCursor.Y
  $script:DragForm.Location = New-Object System.Drawing.Point(($script:DragStart.X + $dx), ($script:DragStart.Y + $dy))
}

function End-Drag {
  $form = $script:DragForm
  $script:DragActive = $false
  if ($form -and -not $form.IsDisposed -and $form.Tag) {
    Save-Position ([string]$form.Tag) $form
  }
}

function Hit-Zone($form) {
  $p = [System.Windows.Forms.Cursor]::Position
  $right = ($p.X -ge ($form.Right - 6))
  $bottom = ($p.Y -ge ($form.Bottom - 6))
  if ($right -and $bottom) { return 'SE' }
  if ($right) { return 'E' }
  if ($bottom) { return 'S' }
  return ''
}

function Handle-MouseDown($sender, $e) {
  $form = $null
  if ($sender -is [System.Windows.Forms.Control]) { $form = $sender.FindForm() }
  if (-not $form) { return }
  $zone = Hit-Zone $form
  if ($e -and $e.Button -eq [System.Windows.Forms.MouseButtons]::Left -and $zone) {
    $script:Resize = @{
      Entry = $script:Forms[[string]$form.Tag]
      Start = [System.Windows.Forms.Cursor]::Position
      W = $form.Width
      H = $form.Height
      Zone = $zone
    }
    return
  }
  Start-Drag $sender
}

function Handle-MouseMove($sender) {
  $form = $null
  if ($sender -is [System.Windows.Forms.Control]) { $form = $sender.FindForm() }
  if (-not $form) { return }
  if ($script:Resize) {
    $r = $script:Resize
    $p = [System.Windows.Forms.Cursor]::Position
    $dx = $p.X - $r.Start.X
    $dy = $p.Y - $r.Start.Y
    $w = $r.W
    $h = $r.H
    if ($r.Zone -eq 'E' -or $r.Zone -eq 'SE') { $w = [Math]::Max(180, $r.W + $dx) }
    if ($r.Zone -eq 'S' -or $r.Zone -eq 'SE') { $h = [Math]::Max(84, $r.H + $dy) }
    $form.Size = New-Object System.Drawing.Size($w, $h)
    if ($r.Entry) { Layout-Note $r.Entry }
    return
  }
  if ($script:DragActive) {
    Move-Drag
    return
  }
  $entry = $script:Forms[[string]$form.Tag]
  switch (Hit-Zone $form) {
    'E' { $cursor = [System.Windows.Forms.Cursors]::SizeWE }
    'S' { $cursor = [System.Windows.Forms.Cursors]::SizeNS }
    'SE' { $cursor = [System.Windows.Forms.Cursors]::SizeNWSE }
    default { $cursor = [System.Windows.Forms.Cursors]::SizeAll }
  }
  $form.Cursor = $cursor
  if ($entry) {
    if ($entry.Panel) { $entry.Panel.Cursor = $cursor }
    if ($entry.Label) { $entry.Label.Cursor = $cursor }
  }
}

function Handle-MouseUp($sender) {
  $form = $null
  if ($sender -is [System.Windows.Forms.Control]) { $form = $sender.FindForm() }
  if ($script:Resize) {
    $script:Resize = $null
    if ($form -and $form.Tag) { Save-Position ([string]$form.Tag) $form }
    return
  }
  End-Drag
}

function Scroll-By($sender, [int]$delta) {
  $form = $null
  if ($sender -is [System.Windows.Forms.Control]) { $form = $sender.FindForm() }
  if (-not $form) { return }
  $entry = $script:Forms[[string]$form.Tag]
  if (-not $entry) { return }
  $entry.Offset = $entry.Offset - ([Math]::Sign($delta) * 56)
  Update-Scroll $entry
}

function Start-Thumb-Drag($sender) {
  $form = $sender.FindForm()
  if (-not $form) { return }
  $entry = $script:Forms[[string]$form.Tag]
  if (-not $entry) { return }
  $script:ThumbDrag = @{
    Entry = $entry
    Start = [System.Windows.Forms.Cursor]::Position
    Offset = $entry.Offset
  }
  $script:DragActive = $false
}

function Move-Thumb-Drag {
  if (-not $script:ThumbDrag) { return }
  $t = $script:ThumbDrag
  $entry = $t.Entry
  if (-not $entry.Form -or $entry.Form.IsDisposed) { $script:ThumbDrag = $null; return }
  $viewH = [Math]::Max(24, ($entry.Form.ClientSize.Height - 20))
  $contentH = [Math]::Max(1, $entry.Label.Height)
  $max = [Math]::Max(0, ($contentH - $viewH))
  if ($max -le 0) { return }
  $trackH = [Math]::Max(30, ($entry.Form.ClientSize.Height - 8 - 26))
  $thumbH = [int][Math]::Round($trackH * $viewH / $contentH)
  if ($thumbH -lt 24) { $thumbH = 24 }
  $travel = [Math]::Max(1, ($trackH - $thumbH))
  $point = [System.Windows.Forms.Cursor]::Position
  $entry.Offset = $t.Offset + (($point.Y - $t.Start.Y) * $max / $travel)
  Update-Scroll $entry
}

function New-NoteForm($note, [int]$top) {
  $style = Style-Of $note
  $bg = [System.Drawing.ColorTranslator]::FromHtml($style.bg)
  $ink = [System.Drawing.ColorTranslator]::FromHtml($style.ink)

  $font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10.5, [System.Drawing.FontStyle]::Regular)
  $text = [string]$note.text
  $saved = (Read-Positions)[[string]$note.id]

  $width = 280
  if ($saved -and $saved.w -ge 180) { $width = [int]$saved.w }
  $wrapWidth = [Math]::Max(80, ($width - 48))
  $measured = [System.Windows.Forms.TextRenderer]::MeasureText($text, $font, (New-Object System.Drawing.Size($wrapWidth, 0)), [System.Windows.Forms.TextFormatFlags]::WordBreak)
  $height = [Math]::Max(84, [Math]::Min(560, $measured.Height + 44))
  if ($saved -and $saved.h -ge 84) { $height = [int]$saved.h }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Notes'
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $form.TopMost = $true
  $form.ShowInTaskbar = $false
  $form.MinimizeBox = $false
  $form.MaximizeBox = $false
  $form.BackColor = $bg
  $form.Size = New-Object System.Drawing.Size($width, $height)
  if ($saved) {
    $form.Location = New-Object System.Drawing.Point([int]$saved.x, [int]$saved.y)
  } elseif ($note.pos -and $null -ne $note.pos.x -and $null -ne $note.pos.y) {
    $form.Location = New-Object System.Drawing.Point([int]$note.pos.x, [int]$note.pos.y)
  } else {
    $form.Location = Get-DefaultPosition $top
  }
  $form.Tag = [string]$note.id

  $panel = New-Object System.Windows.Forms.Panel
  $panel.Name = 'body'
  $panel.Dock = [System.Windows.Forms.DockStyle]::Fill
  $panel.BackColor = $bg
  $panel.Cursor = [System.Windows.Forms.Cursors]::SizeAll
  $panel.Add_MouseDown({ param($sender, $e) Handle-MouseDown $sender $e })
  $panel.Add_MouseMove({ param($sender, $e) Handle-MouseMove $sender })
  $panel.Add_MouseUp({ param($sender, $e) Handle-MouseUp $sender })
  $panel.Add_MouseWheel({ param($sender, $e) Scroll-By $sender $e.Delta })

  $label = New-Object System.Windows.Forms.Label
  $label.AutoSize = $true
  $label.MaximumSize = New-Object System.Drawing.Size($wrapWidth, 0)
  $label.Location = New-Object System.Drawing.Point(12, 10)
  $label.BackColor = $bg
  $label.ForeColor = $ink
  $label.Font = $font
  $label.Text = $text
  $label.Cursor = [System.Windows.Forms.Cursors]::SizeAll
  $label.Add_MouseDown({ param($sender, $e) Handle-MouseDown $sender $e })
  $label.Add_MouseMove({ param($sender, $e) Handle-MouseMove $sender })
  $label.Add_MouseUp({ param($sender, $e) Handle-MouseUp $sender })
  $label.Add_MouseWheel({ param($sender, $e) Scroll-By $sender $e.Delta })

  $thumb = New-Object System.Windows.Forms.Panel
  $thumb.Name = 'thumb'
  $thumb.Size = New-Object System.Drawing.Size(5, 40)
  $thumb.BackColor = (Blend $ink $bg 0.36)
  $thumb.Cursor = [System.Windows.Forms.Cursors]::Hand
  $thumb.Visible = $false
  $thumb.Add_MouseDown({ param($sender, $e) Start-Thumb-Drag $sender })
  $thumb.Add_MouseMove({ param($sender, $e) Move-Thumb-Drag })
  $thumb.Add_MouseUp({ $script:ThumbDrag = $null })

  $close = New-Object System.Windows.Forms.Button
  $close.Text = [string][char]0x00D7
  $close.Tag = [string]$note.id
  $close.Size = New-Object System.Drawing.Size(18, 16)
  $close.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $close.FlatAppearance.BorderSize = 0
  $close.BackColor = $bg
  $close.ForeColor = $ink
  $close.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Regular)
  $close.TabStop = $false
  $close.Cursor = [System.Windows.Forms.Cursors]::Hand
  $close.Add_Click({ Unpin-Note ([string]$this.Tag) })

  $panel.Controls.Add($label)
  $form.Controls.Add($panel)
  $form.Controls.Add($thumb)
  $form.Controls.Add($close)
  $thumb.BringToFront()
  $close.BringToFront()
  $form.Add_MouseDown({ param($sender, $e) Handle-MouseDown $sender $e })
  $form.Add_MouseMove({ param($sender, $e) Handle-MouseMove $sender })
  $form.Add_MouseUp({ param($sender, $e) Handle-MouseUp $sender })
  $form.Add_MouseWheel({ param($sender, $e) Scroll-By $sender $e.Delta })
  $form.Show()

  $entry = @{
    Form = $form
    Panel = $panel
    Label = $label
    Thumb = $thumb
    Close = $close
    Style = $style
    Offset = 0
  }
  Layout-Note $entry
  return $entry
}

function Sync-Windows {
  $state = Read-State
  if (-not $state) { return }
  $notes = @($state.notes)
  $wanted = @{}
  $stackY = 80
  foreach ($note in $notes) {
    if ($note.desktop -eq $true) {
      $id = [string]$note.id
      $wanted[$id] = $true
      $entry = $script:Forms[$id]
      if (-not $entry) {
        $entry = New-NoteForm $note $stackY
        $script:Forms[$id] = $entry
        $stackY = $entry.Form.Top + $entry.Form.Height + 12
      } elseif ($entry.Form -and -not $entry.Form.IsDisposed) {
        $entry.Label.Text = [string]$note.text
        $style = Style-Of $note
        if ($entry.Style.bg -ne $style.bg) {
          $entry.Style = $style
          $bg = [System.Drawing.ColorTranslator]::FromHtml($style.bg)
          $ink = [System.Drawing.ColorTranslator]::FromHtml($style.ink)
          $entry.Form.BackColor = $bg
          $entry.Panel.BackColor = $bg
          $entry.Label.BackColor = $bg
          $entry.Label.ForeColor = $ink
          $entry.Close.BackColor = $bg
          $entry.Close.ForeColor = $ink
          $entry.Thumb.BackColor = (Blend $ink $bg 0.36)
        }
        Layout-Note $entry
      }
    }
  }
  foreach ($key in @($script:Forms.Keys)) {
    if (-not $wanted.ContainsKey($key)) {
      $entry = $script:Forms[$key]
      try {
        if ($entry.Form) { $entry.Form.Close(); $entry.Form.Dispose() }
      } catch { }
      $script:Forms.Remove($key)
    }
  }
  if ($wanted.Count -eq 0) {
    if (-not $Persist) {
      $script:IdleTicks++
      if ($script:IdleTicks -gt 40) { [System.Windows.Forms.Application]::Exit() }
    }
  } else {
    $script:IdleTicks = 0
  }
}

if ($Unpin) {
  # Headless mode used by tests and by a manual "unpin" from a shortcut.
  Unpin-Note $Unpin
  exit 0
}

$mutex = New-Object System.Threading.Mutex($false, ('Local\DshNotesDesktopWidget' + $InstanceTag))
$owned = $false
try { $owned = $mutex.WaitOne(0) } catch { $owned = $false }
if (-not $owned) { exit 0 }

# Only the instance that owns the mutex publishes its PID, so the Host can tell
# whether a widget is already showing these notes.
$pidFile = Join-Path (Split-Path -Parent $StateFile) 'widget.pid'
try { [System.IO.File]::WriteAllText($pidFile, [string]$PID, (New-Object System.Text.UTF8Encoding($false))) } catch { }

$main = New-Object System.Windows.Forms.Form
$main.Text = 'NotesHost'
$main.ShowInTaskbar = $false
$main.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$main.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
$main.Opacity = 0
$main.Width = 1
$main.Height = 1
$main.Location = New-Object System.Drawing.Point(-32000, -32000)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({ Sync-Windows })
$timer.Start()

Sync-Windows
try {
  [System.Windows.Forms.Application]::Run($main)
} finally {
  try { if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force } } catch { }
  try { $mutex.ReleaseMutex() } catch { }
  try { $mutex.Dispose() } catch { }
}
