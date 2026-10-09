param(
  [string]$CaptureRoot = 'artifacts/qa/2026-10/events-nested/final-visual/results',
  [string]$OutputRoot = 'artifacts/qa/2026-10/events-nested/native-sheets'
)
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$capturePath = Join-Path $workspacePath $CaptureRoot
$outputPath = Join-Path $workspacePath $OutputRoot
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
Add-Type -AssemblyName System.Drawing
$dirs = Get-ChildItem -LiteralPath $capturePath -Directory | Where-Object {
  $_.Name -like '*chromium' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'rsvp-320-1.png'))
} | Sort-Object { (Get-Item -LiteralPath (Join-Path $_.FullName 'rsvp-320-1.png')).LastWriteTimeUtc }
$scopes = @('en-light', 'en-dark', 'ru-light', 'ru-dark', 'uz-Latn-light', 'uz-Latn-dark', 'uz-Cyrl-light', 'uz-Cyrl-dark')
if ($dirs.Count -ne $scopes.Count) { throw "Expected eight populated event capture folders, got $($dirs.Count)" }
$manifest = @()
for ($index = 0; $index -lt $dirs.Count; $index++) {
  for ($group = 0; $group -lt 2; $group++) {
    $tabs = if ($group -eq 0) { @('rsvp', 'comments', 'items', 'carpool') } else { @('polls', 'photos', 'feedback') }
    $sheet = [Drawing.Bitmap]::new($tabs.Count * 320, 668)
    $graphics = [Drawing.Graphics]::FromImage($sheet)
    $graphics.Clear([Drawing.Color]::White)
    $font = [Drawing.Font]::new('Arial', 12)
    $sources = @()
    for ($tabIndex = 0; $tabIndex -lt $tabs.Count; $tabIndex++) {
      $sourcePath = Join-Path $dirs[$index].FullName "$($tabs[$tabIndex])-320-1.png"
      $source = [Drawing.Bitmap]::new($sourcePath)
      if ($source.Width -ne 320 -or $source.Height -ne 640) { throw "Expected a native 320x640 viewport: $sourcePath" }
      $graphics.DrawString("$($scopes[$index]) $($tabs[$tabIndex])", $font, [Drawing.Brushes]::Black, $tabIndex * 320, 2)
      # This viewing aid retains every original pixel at its native size; it is not a new browser capture.
      $graphics.DrawImageUnscaled($source, $tabIndex * 320, 28)
      $sources += [pscustomobject]@{ tab = $tabs[$tabIndex]; source = $sourcePath.Substring($workspacePath.Length + 1).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLower(); x = 0; y = 0; width = 320; height = 640 }
      $source.Dispose()
    }
    $path = Join-Path $outputPath "$($scopes[$index])-$group.png"
    $sheet.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    $graphics.Dispose()
    $font.Dispose()
    $sheet.Dispose()
    $manifest += [pscustomobject]@{ scope = $scopes[$index]; sheet = $path.Substring($workspacePath.Length + 1).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower(); sources = $sources; pixelReview = 'pending actual opening' }
  }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $outputPath 'manifest.json') -Encoding utf8
