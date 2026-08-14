param(
  [switch]$SelfTest,
  [switch]$PreflightOnly,
  [switch]$InstallResumeTask,
  [switch]$RemoveResumeTask
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Repo

$StateDir = Join-Path $Repo 'data\forward-validation'
$StatePath = Join-Path $StateDir 'active-30-day.json'
$BuildMarkerPath = Join-Path $StateDir 'backend-build-source-commit.txt'
$LogDir = Join-Path $env:USERPROFILE 'Desktop\okx-30-day-evidence-logs'
$TaskName = 'OKX 30-Day Evidence Collector'
$LauncherPath = Join-Path $PSScriptRoot 'START-30-DAY-EVIDENCE.cmd'
$SupervisorLogPath = Join-Path $LogDir ('supervisor-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$MutexName = 'Local\OKX_30_DAY_EVIDENCE_SUPERVISOR'

New-Item -ItemType Directory -Force -Path $StateDir,$LogDir | Out-Null

function Write-SupervisorLog([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -LiteralPath $SupervisorLogPath -Value $line -Encoding UTF8
}

function Invoke-NativeExitCode {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][string[]]$Arguments
  )
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $FilePath @Arguments *> $null
    return $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previous
  }
}

function Get-GitHead {
  $head = (& git rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $head) {
    throw 'Could not resolve the current Git HEAD.'
  }
  return $head.Trim()
}

function Assert-CleanWorktree {
  $status = @(& git status --porcelain --untracked-files=normal 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect the Git worktree.'
  }
  if ($status.Count -ne 0) {
    Write-Host 'Git worktree is not clean:'
    $status | ForEach-Object { Write-Host $_ }
    throw 'Git worktree must be clean before starting forward validation.'
  }
}

function Format-Duration([int64]$Milliseconds) {
  $Milliseconds = [Math]::Max(0, $Milliseconds)
  $minutes = [Math]::Floor($Milliseconds / 60000)
  $days = [Math]::Floor($minutes / 1440)
  $hours = [Math]::Floor(($minutes % 1440) / 60)
  $mins = $minutes % 60
  return "${days}d ${hours}h ${mins}m"
}

function Read-JsonFile([string]$Path,[string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label not found: $Path"
  }
  try {
    return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
  }
  catch {
    throw "$Label is invalid JSON: $Path"
  }
}

function Read-ForwardState {
  if (-not (Test-Path -LiteralPath $StatePath)) { return $null }
  return (Read-JsonFile $StatePath '30-day forward-validation state')
}

function Save-ForwardState([string]$EvaluationId,[string]$SourceCommit) {
  $state = [ordered]@{
    schemaVersion = 2
    evaluationId = $EvaluationId
    sourceCommit = $SourceCommit
    repo = $Repo
    updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  }
  $temp = $StatePath + '.tmp-' + [Guid]::NewGuid().ToString('N')
  $state | ConvertTo-Json | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $StatePath -Force
}

function Get-EvaluationManifest([string]$EvaluationId) {
  $path = Join-Path $Repo "data\evaluations\$EvaluationId\manifest.json"
  return (Read-JsonFile $path 'Evidence manifest')
}

function Assert-BackendSourceCompatible([string]$SourceCommit,[string]$CurrentHead) {
  if (-not $SourceCommit) {
    throw 'Evidence manifest sourceCommit is missing.'
  }

  $commitExists = Invoke-NativeExitCode 'git' @('cat-file','-e',("$SourceCommit^{commit}"))
  if ($commitExists -ne 0) {
    throw "Evidence source commit is not available in local Git history: $SourceCommit"
  }

  if ($SourceCommit -eq $CurrentHead) { return }

  $diffExit = Invoke-NativeExitCode 'git' @(
    'diff','--quiet',$SourceCommit,$CurrentHead,'--',
    'src','package.json','package-lock.json','tsconfig.json','web/tsconfig.json'
  )
  if ($diffExit -eq 1) {
    throw "Backend source changed since this evaluation was initialized ($SourceCommit -> $CurrentHead). Start a new evaluation instead of mixing source versions."
  }
  if ($diffExit -ne 0) {
    throw 'Could not verify backend source compatibility with the evidence manifest.'
  }
}

function Ensure-BackendBuild([string]$SourceCommit) {
  $runnerPath = Join-Path $Repo 'dist\tools\runThirtyDayEvidenceCollector.js'
  $marker = $null
  if (Test-Path -LiteralPath $BuildMarkerPath) {
    try { $marker = (Get-Content -LiteralPath $BuildMarkerPath -Raw).Trim() } catch {}
  }

  if ($marker -eq $SourceCommit -and (Test-Path -LiteralPath $runnerPath)) {
    Write-SupervisorLog "Using validated backend build for source $SourceCommit."
    return
  }

  Write-SupervisorLog 'Building backend before starting/resuming the 30-day collector...'
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & npm.cmd run build:backend 2>&1 | ForEach-Object { Write-Host $_ }
    $buildExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previous
  }
  if ($buildExitCode -ne 0) {
    throw 'Backend build failed.'
  }
  Set-Content -LiteralPath $BuildMarkerPath -Value $SourceCommit -Encoding ASCII
  Write-SupervisorLog "Backend build validated for source $SourceCommit."
}

function Test-ScheduledTaskSupport {
  return ($null -ne (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) -and
    ($null -ne (Get-Command New-ScheduledTaskAction -ErrorAction SilentlyContinue)) -and
    ($null -ne (Get-Command New-ScheduledTaskTrigger -ErrorAction SilentlyContinue))
}

function Ensure-LogonResumeTask([switch]$Explicit) {
  if ($env:OKX_DISABLE_LOGON_RESUME -eq '1') {
    if ($Explicit) { Write-Warning 'Logon resume is disabled by OKX_DISABLE_LOGON_RESUME=1.' }
    return $false
  }

  if (-not (Test-ScheduledTaskSupport)) {
    if ($Explicit) {
      Write-Warning 'Windows ScheduledTasks cmdlets are unavailable on this system.'
    } else {
      Write-Warning 'Automatic logon resume is unavailable; the live supervisor will still restart the child process while this window remains open.'
    }
    return $false
  }

  try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $arguments = '/D /C ""' + $LauncherPath + '""'
    $action = New-ScheduledTaskAction -Execute $env:ComSpec -Argument $arguments -WorkingDirectory $Repo
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
    Write-SupervisorLog 'Automatic per-user logon/reboot resume task registered.'
    return $true
  }
  catch {
    Write-Warning ("Could not register optional automatic logon resume: " + $_.Exception.Message)
    Write-SupervisorLog 'Optional logon-resume task registration failed; live supervisor operation will continue.'
    return $false
  }
}

function Remove-LogonResumeTask([switch]$Explicit) {
  if (-not (Test-ScheduledTaskSupport)) {
    if ($Explicit) { Write-Warning 'Windows ScheduledTasks cmdlets are unavailable.' }
    return
  }
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    if ($Explicit) { Write-Host '30-day logon/reboot resume task removed (or it was already absent).' }
  }
  catch {
    if ($Explicit) { Write-Warning ("Could not remove scheduled task: " + $_.Exception.Message) }
  }
}

function Enable-AwakeState {
  try {
    if ($null -eq ('OkxForwardPowerStateV2' -as [type])) {
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OkxForwardPowerStateV2 {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
    }
    $continuous = [Convert]::ToUInt32('80000000',16)
    $systemRequired = [uint32]1
    $result = [OkxForwardPowerStateV2]::SetThreadExecutionState($continuous -bor $systemRequired)
    if ($result -eq 0) {
      Write-Warning 'Windows sleep prevention could not be enabled. Keep the PC awake manually.'
      return $false
    }
    return $true
  }
  catch {
    Write-Warning ("Windows sleep prevention is unavailable: " + $_.Exception.Message)
    return $false
  }
}

function Disable-AwakeState {
  try {
    $continuous = [Convert]::ToUInt32('80000000',16)
    [void][OkxForwardPowerStateV2]::SetThreadExecutionState($continuous)
  } catch {}
}

function Resolve-ExistingEvaluation([object]$State,[string]$CurrentHead) {
  if ($null -eq $State -or -not $State.evaluationId) { return $null }
  $evaluationId = [string]$State.evaluationId
  $manifest = Get-EvaluationManifest $evaluationId
  $manifestCommit = [string]$manifest.sourceCommit
  Assert-BackendSourceCompatible $manifestCommit $CurrentHead
  if ($State.sourceCommit -and ([string]$State.sourceCommit -ne $manifestCommit)) {
    throw 'Forward-validation state sourceCommit does not match the evidence manifest.'
  }
  Save-ForwardState $evaluationId $manifestCommit
  return [pscustomobject]@{
    EvaluationId = $evaluationId
    SourceCommit = $manifestCommit
  }
}

function Initialize-NewEvaluation([string]$CurrentHead) {
  Ensure-BackendBuild $CurrentHead
  $evaluationId = 'forward-30d-' + (Get-Date -Format 'yyyy-MM-dd-HHmmss')
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & node dist\tools\initializeEvidenceEvaluation.js $evaluationId 2>&1 | ForEach-Object { Write-Host $_ }
    $initializeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previous
  }
  if ($initializeExitCode -ne 0) {
    throw 'Could not initialize the 30-day evaluation.'
  }
  $manifest = Get-EvaluationManifest $evaluationId
  $manifestCommit = [string]$manifest.sourceCommit
  if (-not $manifestCommit) { throw 'New evidence manifest did not record sourceCommit.' }
  Assert-BackendSourceCompatible $manifestCommit $CurrentHead
  Save-ForwardState $evaluationId $manifestCommit
  return [pscustomobject]@{
    EvaluationId = $evaluationId
    SourceCommit = $manifestCommit
  }
}

function Invoke-StartupPreflight([switch]$AllowInitialization) {
  Assert-CleanWorktree
  if ($null -eq (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'git.exe is not available.' }
  if ($null -eq (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'node.exe is not available.' }
  if ($null -eq (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd is not available.' }

  $currentHead = Get-GitHead
  $state = Read-ForwardState
  $resolved = Resolve-ExistingEvaluation $state $currentHead

  if ($null -eq $resolved) {
    if (-not $AllowInitialization) {
      Write-SupervisorLog 'Preflight: no active 30-day evaluation exists yet; a normal launch will create one.'
      return $null
    }
    $resolved = Initialize-NewEvaluation $currentHead
  } else {
    Ensure-BackendBuild $resolved.SourceCommit
  }

  return $resolved
}

if ($SelfTest) {
  try {
    if ((Format-Duration 90061000) -ne '1d 1h 1m') {
      throw 'Duration formatting self-test failed.'
    }
    $awake = Enable-AwakeState
    if ($awake) { Disable-AwakeState }
    if (Test-ScheduledTaskSupport) {
      Write-Host 'ScheduledTasks support: available'
    } else {
      Write-Host 'ScheduledTasks support: unavailable (optional; collector can still run)'
    }
    Write-Host '30-DAY SUPERVISOR SELF-TEST: PASS'
    exit 0
  }
  catch {
    Write-Error ("30-day supervisor self-test failed: " + $_.Exception.Message)
    exit 1
  }
}

if ($InstallResumeTask) {
  if (Ensure-LogonResumeTask -Explicit) { exit 0 }
  exit 1
}

if ($RemoveResumeTask) {
  Remove-LogonResumeTask -Explicit
  exit 0
}

if ($PreflightOnly) {
  try {
    $preflight = Invoke-StartupPreflight
    if ($null -eq $preflight) {
      Write-Host '30-DAY SUPERVISOR PREFLIGHT: PASS (no active evaluation yet)'
    } else {
      Write-Host ("30-DAY SUPERVISOR PREFLIGHT: PASS | evaluation={0} | source={1}" -f $preflight.EvaluationId,$preflight.SourceCommit)
    }
    exit 0
  }
  catch {
    Write-Error ("30-day supervisor preflight failed: " + $_.Exception.Message)
    exit 1
  }
}

$mutex = $null
$ownsMutex = $false
$awakeEnabled = $false
$process = $null

try {
  $mutex = New-Object System.Threading.Mutex($false,$MutexName)
  try {
    $ownsMutex = $mutex.WaitOne(0)
  }
  catch [System.Threading.AbandonedMutexException] {
    $ownsMutex = $true
  }
  if (-not $ownsMutex) {
    Write-Host 'Another 30-day evidence supervisor is already running.'
    Write-Host 'No second collector was started.'
    exit 0
  }

  $resolved = Invoke-StartupPreflight -AllowInitialization
  if ($null -eq $resolved) { throw 'Could not resolve or initialize the 30-day evaluation.' }
  $evaluationId = $resolved.EvaluationId
  $sourceCommit = $resolved.SourceCommit

  $awakeEnabled = Enable-AwakeState
  [void](Ensure-LogonResumeTask)

  Write-Host '============================================================'
  Write-Host '30-DAY FORWARD VALIDATION SUPERVISOR'
  Write-Host "Evaluation: $evaluationId"
  Write-Host "Evidence source commit: $sourceCommit"
  Write-Host 'The same evaluation resumes after child-process interruptions.'
  Write-Host 'Incomplete episodes are quarantined; unrelated complete episodes remain valid.'
  Write-Host 'Downtime and coverage gaps are persisted; missing observations are never fabricated.'
  Write-Host 'Windows sleep prevention is active while this supervisor is open when supported.'
  Write-Host 'Press Ctrl+C for an intentional stop. The fixed 30-day target is preserved.'
  Write-Host 'Live order execution remains disabled.'
  Write-Host '============================================================'
  Write-SupervisorLog "Supervisor started for evaluation $evaluationId at source $sourceCommit."

  $consecutiveFastFailures = 0
  while ($true) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $log = Join-Path $LogDir "$evaluationId-$stamp.log"
    $errLog = $log + '.err'
    Write-Host "Starting/resuming collector. Log: $log"
    Write-SupervisorLog "Starting child collector process; stdout=$log stderr=$errLog"

    $childStartedAt = [DateTimeOffset]::UtcNow
    $process = Start-Process -FilePath 'node.exe' -ArgumentList @('dist\tools\runThirtyDayEvidenceCollector.js',$evaluationId) -WorkingDirectory $Repo -RedirectStandardOutput $log -RedirectStandardError $errLog -NoNewWindow -PassThru

    $nextProgress = [DateTimeOffset]::UtcNow.AddMinutes(5)
    while (-not $process.HasExited) {
      Start-Sleep -Seconds 15
      $process.Refresh()
      if ([DateTimeOffset]::UtcNow -ge $nextProgress) {
        $checkpointPath = Join-Path $Repo "data\evaluations\$evaluationId\collector-checkpoint.json"
        if (Test-Path -LiteralPath $checkpointPath) {
          try {
            $checkpoint = Read-JsonFile $checkpointPath 'Collector checkpoint'
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            Write-Host ("30-DAY STATUS | elapsed={0} | remaining={1} | target={2} | session={3}" -f `
              (Format-Duration ($now - [int64]$checkpoint.firstStartedAt)), `
              (Format-Duration ([int64]$checkpoint.targetEndAt - $now)), `
              ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$checkpoint.targetEndAt).UtcDateTime.ToString('o')), `
              $checkpoint.sessionSequence)
          }
          catch {
            Write-Warning 'Could not read checkpoint for this display cycle; collection continues.'
          }
        }
        $nextProgress = [DateTimeOffset]::UtcNow.AddMinutes(5)
      }
    }

    $process.WaitForExit()
    $process.Refresh()
    $runtimeSeconds = ([DateTimeOffset]::UtcNow - $childStartedAt).TotalSeconds
    Write-SupervisorLog "Child collector exited code=$($process.ExitCode) runtimeSeconds=$([Math]::Round($runtimeSeconds,1))."

    $checkpointPath = Join-Path $Repo "data\evaluations\$evaluationId\collector-checkpoint.json"
    if (Test-Path -LiteralPath $checkpointPath) {
      $checkpoint = Read-JsonFile $checkpointPath 'Collector checkpoint'
      if ($checkpoint.completed) {
        Write-Host '30-day collection period complete.'
        Write-SupervisorLog '30-day collection period completed.'
        Remove-LogonResumeTask
        break
      }
    }

    $healthPath = Join-Path $Repo "data\evaluations\$evaluationId\collection-health.json"
    if (Test-Path -LiteralPath $healthPath) {
      $health = Read-JsonFile $healthPath 'Collection health'
      if ($health.status -eq 'UNHEALTHY') {
        throw 'Structural evidence integrity became UNHEALTHY. Supervisor will not restart blindly.'
      }
    }

    if ($runtimeSeconds -lt 30) {
      $consecutiveFastFailures += 1
    } else {
      $consecutiveFastFailures = 0
    }
    if ($consecutiveFastFailures -ge 5) {
      if (Test-Path -LiteralPath $errLog) {
        Write-Host 'Recent collector stderr:'
        Get-Content -LiteralPath $errLog -Tail 40 | ForEach-Object { Write-Host $_ }
      }
      throw 'Collector exited too quickly five consecutive times. Supervisor stopped to avoid an infinite restart loop.'
    }

    Write-Host "Collector exited with code $($process.ExitCode). Resuming SAME evaluation in 10 seconds..."
    Start-Sleep -Seconds 10
  }
}
catch {
  Write-SupervisorLog ("FATAL SUPERVISOR ERROR: " + $_.Exception.Message)
  Write-Error $_.Exception.Message
  exit 1
}
finally {
  if ($awakeEnabled) { Disable-AwakeState }
  if ($ownsMutex -and $null -ne $mutex) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  if ($null -ne $mutex) { $mutex.Dispose() }
}
