param([string]$CaptureRoot = 'artifacts/qa/2026-10/goals/final-fifty-one/results')
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$capturePath = Join-Path $workspacePath $CaptureRoot
$outputPath = Join-Path $workspacePath 'artifacts/qa/2026-10/goals/native-sheets'
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
Add-Type -AssemblyName System.Drawing
$dirs = Get-ChildItem -LiteralPath $capturePath -Directory | Where-Object Name -Like '*goals-visual*chromium' | Sort-Object { (Get-Item -LiteralPath (Join-Path $_.FullName 'populated-320-1.png')).LastWriteTimeUtc }
$scopes = @('en-light', 'en-dark', 'ru-light', 'ru-dark', 'uz-Latn-light', 'uz-Latn-dark', 'uz-Cyrl-light', 'uz-Cyrl-dark')
if ($dirs.Count -ne $scopes.Count) { throw "Expected eight locale/theme folders, got $($dirs.Count)" }
$manifest = @()
for ($index = 0; $index -lt $dirs.Count; $index++) {
  $sheet = [Drawing.Bitmap]::new(1280, 668)
  $graphics = [Drawing.Graphics]::FromImage($sheet)
  $graphics.Clear([Drawing.Color]::White)
  $font = [Drawing.Font]::new('Arial', 12)
  $sources = @()
  $files = @('populated-320-1.png', 'populated-320-1.png', 'create-320-1.png', 'conflict-320-1.png')
  for ($panel = 0; $panel -lt 4; $panel++) {
    $sourcePath = Join-Path $dirs[$index].FullName $files[$panel]
    $source = [Drawing.Bitmap]::new($sourcePath)
    if ($source.Width -ne 320) { throw "Expected native 320px width: $sourcePath" }
    $cropTop = if ($panel -eq 1) { [Math]::Max(0, $source.Height - 640) } else { 0 }
    $height = [Math]::Min(640, $source.Height - $cropTop)
    $rectangle = [Drawing.Rectangle]::new(0, $cropTop, 320, $height)
    $crop = $source.Clone($rectangle, $source.PixelFormat)
    $graphics.DrawString("$($scopes[$index]) $panel y=$cropTop", $font, [Drawing.Brushes]::Black, $panel * 320, 2)
    $graphics.DrawImageUnscaled($crop, $panel * 320, 28)
    $sources += [pscustomobject]@{ source = $sourcePath.Substring($workspacePath.Length + 1).Replace('\', '/'); x = 0; y = $cropTop; width = 320; height = $height }
    $crop.Dispose()
    $source.Dispose()
  }
  $path = Join-Path $outputPath "$($scopes[$index]).png"
  $sheet.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $font.Dispose()
  $sheet.Dispose()
  $manifest += [pscustomobject]@{ scope = $scopes[$index]; sheet = $path.Substring($workspacePath.Length + 1).Replace('\', '/'); sources = $sources; pixelReview = 'pending actual viewing' }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputPath 'manifest.json') -Encoding utf8
