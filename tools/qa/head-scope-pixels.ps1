param([string]$CaptureRoot = 'artifacts/qa/2026-10/results/head-scope-visual')
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$capturePath = Join-Path $workspacePath $CaptureRoot
$outputPath = Join-Path $workspacePath 'artifacts/qa/2026-10/head-scope/native-sheets'
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
Add-Type -AssemblyName System.Drawing
$dirs = Get-ChildItem -LiteralPath $capturePath -Directory | Sort-Object { (Get-Item -LiteralPath (Join-Path $_.FullName '0-320-1.png')).LastWriteTimeUtc }
$scopes = @('en-light', 'en-dark', 'ru-light', 'ru-dark', 'uz-Latn-light', 'uz-Latn-dark', 'uz-Cyrl-light', 'uz-Cyrl-dark')
$manifest = @()
for ($index = 0; $index -lt $dirs.Count; $index++) {
  $sheet = [Drawing.Bitmap]::new(1920, 668)
  $graphics = [Drawing.Graphics]::FromImage($sheet)
  $graphics.Clear([Drawing.Color]::White)
  $font = [Drawing.Font]::new('Arial', 12)
  $sources = @()
  for ($routeIndex = 0; $routeIndex -lt 6; $routeIndex++) {
    $sourcePath = Join-Path $dirs[$index].FullName "$routeIndex-320-1.png"
    $source = [Drawing.Bitmap]::new($sourcePath)
    $cropTop = if ($routeIndex -eq 5) { [Math]::Min($source.Height - 640, [Math]::Floor($source.Height * 0.5)) } else { 0 }
    $height = [Math]::Min(640, $source.Height - $cropTop)
    $rectangle = [Drawing.Rectangle]::new(0, $cropTop, $source.Width, $height)
    $crop = $source.Clone($rectangle, $source.PixelFormat)
    $graphics.DrawString("$($scopes[$index]) route$routeIndex y=$cropTop", $font, [Drawing.Brushes]::Black, $routeIndex * 320, 2)
    # DrawImageUnscaled retains native CSS pixels; this is a viewing aid, not a new capture.
    $graphics.DrawImageUnscaled($crop, $routeIndex * 320, 28)
    $sources += [pscustomobject]@{ source = $sourcePath.Substring($workspacePath.Length + 1).Replace('\', '/'); x = 0; y = $cropTop; width = $source.Width; height = $height }
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
