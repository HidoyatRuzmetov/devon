# Windows service install for infra/sentinel (systemd/devon-sentinel.service's counterpart).
# Devon (WorkPortal) itself is designed to run on Linux (TECH-SPEC's Compose deployment); this script
# exists because the task brief for EPIC-013 names it explicitly, and a Windows-hosted evaluation or
# single-machine pilot deployment still needs the pause/wipe console to have a real host process to
# talk to, not just a systemd unit that assumes Linux.
#
# sc.exe (native, no NSSM/node-windows dependency -- ADR-011's "dependency-free by design" extends to
# the install tooling, not just the service code) registers a plain Win32 service whose binary path is
# the Node executable plus this script's arguments. Node's own process does not implement the Windows
# Service Control Protocol (SCM start/stop/pause callbacks) -- `sc.exe stop` sends a stop signal the
# OS honours for process termination purposes (Node exits), but a graceful `SIGTERM`-style drain like
# systemd's is not guaranteed the same way it is on Linux; document this to the operator rather than
# claim parity the underlying platform does not actually provide.
#
# Usage (run as Administrator):
#   powershell -ExecutionPolicy Bypass -File install-service.ps1 -InstallDir "C:\devon\infra\sentinel"
#   powershell -ExecutionPolicy Bypass -File install-service.ps1 -Uninstall

param(
  [string]$InstallDir = "C:\devon\infra\sentinel",
  [string]$ServiceName = "DevonSentinel",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Run this script from an elevated (Administrator) PowerShell prompt."
  exit 1
}

if ($Uninstall) {
  Write-Host "Stopping and removing service '$ServiceName' ..."
  sc.exe stop $ServiceName | Out-Null
  Start-Sleep -Seconds 2
  sc.exe delete $ServiceName
  Write-Host "Done. Nothing under $InstallDir or C:\ProgramData\devon-sentinel was touched."
  exit 0
}

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
  Write-Error "node.exe not found on PATH. Install Node >=22.11 first (see infra/README.md)."
  exit 1
}

$mainScript = Join-Path $InstallDir "src\main.mjs"
if (-not (Test-Path $mainScript)) {
  Write-Error "$mainScript not found. Copy infra/sentinel into $InstallDir first (same layout as the Linux systemd install: infra/README.md#sentinel)."
  exit 1
}

# %ProgramData%\devon-sentinel mirrors /var/lib/devon-sentinel and /var/log/devon-sentinel.log on
# Linux; %ProgramData%\devon holds the equivalent of /etc/devon/sentinel.conf. Neither is world- or
# even user-readable by default under ProgramData's own ACLs, which is the closest Windows equivalent
# of the Linux config file's required 0600/root ownership -- an operator who needs stricter isolation
# should tighten these ACLs explicitly with icacls, which this script does not attempt to second-guess.
$configDir = "C:\ProgramData\devon"
$dataDir = "C:\ProgramData\devon-sentinel"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$configPath = Join-Path $configDir "sentinel.conf"
$logPath = Join-Path $dataDir "devon-sentinel.log"
$noncePath = Join-Path $dataDir "nonces.log"
# TECH-SPEC §11's %ProgramData%-based wipe log path for a Windows host.
$wipeLogPath = Join-Path $dataDir "devon-wipe.log"

# Set at Machine scope, not `$env:` (session-local): a Windows service starts in its own process,
# spawned by the SCM at boot, and inherits only the machine/user environment block, never whatever
# this installer script happened to have set for itself. `$env:` here would silently produce a
# service that falls back to config.mjs's Linux-shaped defaults (/etc/devon/sentinel.conf, ...), which
# do not exist on this platform.
[Environment]::SetEnvironmentVariable("SENTINEL_CONFIG_PATH", $configPath, "Machine")
[Environment]::SetEnvironmentVariable("SENTINEL_LOG_PATH", $logPath, "Machine")
[Environment]::SetEnvironmentVariable("SENTINEL_NONCE_STORE_PATH", $noncePath, "Machine")
[Environment]::SetEnvironmentVariable("SENTINEL_WIPE_LOG_PATH", $wipeLogPath, "Machine")

if (-not (Test-Path $configPath)) {
  Write-Warning "$configPath does not exist yet. Generate a keypair (node ..\scripts\keygen.mjs) and create it before starting the service -- see infra\sentinel\sentinel.conf.example."
}

$binPath = "`"$nodeExe`" `"$mainScript`""
Write-Host "Registering service '$ServiceName' -> $binPath"

$existing = sc.exe query $ServiceName 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Service already exists; stopping and reconfiguring it."
  sc.exe stop $ServiceName | Out-Null
  Start-Sleep -Seconds 2
  sc.exe config $ServiceName binPath= $binPath start= auto | Out-Null
} else {
  sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "Devon Sentinel (pause/wipe host executor)" | Out-Null
}

sc.exe description $ServiceName "Loopback-only, ed25519-signed host command executor for Devon (WorkPortal)'s pause/wipe switches. See infra/README.md." | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

Write-Host "Starting service '$ServiceName' ..."
sc.exe start $ServiceName

Write-Host ""
Write-Host "Config file:      $configPath"
Write-Host "Log file:         $logPath"
Write-Host "Wipe log file:    $wipeLogPath"
Write-Host "Uninstall with:   powershell -ExecutionPolicy Bypass -File install-service.ps1 -Uninstall"
Write-Host ""
Write-Host "Note: sc.exe registers a plain Win32 service; Node does not implement the Windows Service"
Write-Host "Control Protocol, so a 'net stop'/'sc stop' terminates the process rather than draining it"
Write-Host "the way systemd's SIGTERM handling does on Linux (see this script's header comment)."
