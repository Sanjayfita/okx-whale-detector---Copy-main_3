$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Repo
$StateDir = Join-Path $Repo 'data\forward-validation'
$StatePath = Join-Path $StateDir 'active-30-day.json'
$LogDir = Join-Path $env:USERPROFILE 'Desktop\okx-30-day-evidence-logs'
$TaskName = 'OKX 30-Day Evidence Collector'
$LauncherPath = Join-Path $PSScriptRoot 'START-30-DAY-EVIDENCE.cmd'
New-Item -ItemType Directory -Force -Path $StateDir,$LogDir | Out-Null

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OkxForwardPowerState {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
$ES_CONTINUOUS = [Convert]::ToUInt32('80000000',16)
$ES_SYSTEM_REQUIRED = [uint32]1
[void][OkxForwardPowerState]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)

function Save-State([string]$EvaluationId) {
  @{ schemaVersion=1; evaluationId=$EvaluationId; repo=$Repo; updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } |
    ConvertTo-Json | Set-Content -Encoding UTF8 $StatePath
}

function Ensure-LogonResumeTask {
  if ($env:OKX_DISABLE_LOGON_RESUME -eq '1') { return }
  schtasks.exe /Query /TN $TaskName *> $null
  if ($LASTEXITCODE -eq 0) { return }
  $command = '"' + $LauncherPath + '"'
  schtasks.exe /Create /F /SC ONLOGON /TN $TaskName /TR $command /RL LIMITED *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host 'Automatic logon/reboot resume task registered.'
  } else {
    Write-Warning 'Could not register automatic logon resume. Process restarts still auto-resume while this supervisor remains open.'
  }
}

function Remove-LogonResumeTask {
  schtasks.exe /Delete /F /TN $TaskName *> $null
}

function Format-Duration([int64]$Milliseconds) {
  $Milliseconds = [Math]::Max(0, $Milliseconds)
  $minutes = [Math]::Floor($Milliseconds / 60000)
  $days = [Math]::Floor($minutes / 1440)
  $hours = [Math]::Floor(($minutes % 1440) / 60)
  $mins = $minutes % 60
  return "${days}d ${hours}h ${mins}m"
}

$process = $null
try {
  $status = git status --porcelain --untracked-files=normal
  if ($LASTEXITCODE -ne 0 -or $status) { throw 'Git worktree must be clean before starting forward validation.' }
  npm.cmd run build:backend
  if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }

  $evaluationId = $null
  if (Test-Path $StatePath) {
    try { $evaluationId = (Get-Content $StatePath -Raw | ConvertFrom-Json).evaluationId } catch {}
  }
  if (-not $evaluationId) {
    $evaluationId = 'forward-30d-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss')
    node dist\tools\initializeEvidenceEvaluation.js $evaluationId
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the 30-day evaluation.' }
    Save-State $evaluationId
  }

  Ensure-LogonResumeTask

  Write-Host '============================================================'
  Write-Host '30-DAY FORWARD VALIDATION SUPERVISOR'
  Write-Host "Evaluation: $evaluationId"
  Write-Host 'The same evaluation resumes after child-process interruptions.'
  Write-Host 'Best-effort logon resume is enabled for unexpected reboot.'
  Write-Host 'Windows sleep prevention is active only while this supervisor is open.'
  Write-Host 'Press Ctrl+C for an intentional stop. The fixed 30-day target is preserved.'
  Write-Host 'Live order execution remains disabled.'
  Write-Host '============================================================'

  while ($true) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $log = Join-Path $LogDir "$evaluationId-$stamp.log"
    Write-Host "Starting/resuming collector. Log: $log"
    $process = Start-Process -FilePath 'node.exe' -ArgumentList @('dist\tools\runThirtyDayEvidenceCollector.js',$evaluationId) -WorkingDirectory $Repo -RedirectStandardOutput $log -RedirectStandardError ($log + '.err') -NoNewWindow -PassThru

    $nextProgress = [DateTimeOffset]::UtcNow.AddMinutes(5)
    while (-not $process.HasExited) {
      Start-Sleep -Seconds 15
      $process.Refresh()
      if ([DateTimeOffset]::UtcNow -ge $nextProgress) {
        $checkpointPath = Join-Path $Repo "data\evaluations\$evaluationId\collector-checkpoint.json"
        if (Test-Path $checkpointPath) {
          try {
            $checkpoint = Get-Content $checkpointPath -Raw | ConvertFrom-Json
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            Write-Host ("30-DAY STATUS | elapsed={0} | remaining={1} | target={2} | session={3}" -f `
              (Format-Duration ($now - [int64]$checkpoint.firstStartedAt)), `
              (Format-Duration ([int64]$checkpoint.targetEndAt - $now)), `
              ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$checkpoint.targetEndAt).UtcDateTime.ToString('o')), `
              $checkpoint.sessionSequence)
          } catch {
            Write-Warning 'Could not read checkpoint for this display cycle; collection continues.'
          }
        }
        $nextProgress = [DateTimeOffset]::UtcNow.AddMinutes(5)
      }
    }
    $process.WaitForExit()
    $process.Refresh()

    $checkpointPath = Join-Path $Repo "data\evaluations\$evaluationId\collector-checkpoint.json"
    if (Test-Path $checkpointPath) {
      $checkpoint = Get-Content $checkpointPath -Raw | ConvertFrom-Json
      if ($checkpoint.completed) {
        Write-Host '30-day collection period complete.'
        Remove-LogonResumeTask
        break
      }
    }

    $healthPath = Join-Path $Repo "data\evaluations\$evaluationId\collection-health.json"
    if (Test-Path $healthPath) {
      $health = Get-Content $healthPath -Raw | ConvertFrom-Json
      if ($health.status -eq 'UNHEALTHY') {
        throw 'Structural evidence integrity became UNHEALTHY. Supervisor will not restart blindly.'
      }
    }

    Write-Host "Collector exited with code $($process.ExitCode). Resuming same evaluation in 10 seconds..."
    Start-Sleep -Seconds 10
  }
}
finally {
  [void][OkxForwardPowerState]::SetThreadExecutionState($ES_CONTINUOUS)
}
