$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $Repo

function Write-Section([string]$Text) {
  Write-Host ''
  Write-Host '============================================================'
  Write-Host $Text
  Write-Host '============================================================'
}

function Invoke-Native {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$File,
    [Parameter(Mandatory=$true)][string[]]$Arguments
  )

  Write-Section $Name
  & $File @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$Name failed with exit code $exitCode"
  }
  Write-Host "PASS: $Name"
}

function Get-GitHead {
  $head = (& git.exe rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $head) {
    throw 'Could not resolve current Git HEAD.'
  }
  return $head
}

function Remove-KnownTemporaryLauncher {
  $temporaryPath = Join-Path $Repo 'FIX-30DAY-AND-START.ps1'
  if (-not (Test-Path -LiteralPath $temporaryPath)) { return }

  & git.exe ls-files --error-unmatch -- 'FIX-30DAY-AND-START.ps1' *> $null
  if ($LASTEXITCODE -eq 0) {
    throw 'FIX-30DAY-AND-START.ps1 is tracked unexpectedly; refusing to delete it.'
  }

  Remove-Item -LiteralPath $temporaryPath -Force
  Write-Host 'Removed obsolete untracked FIX-30DAY-AND-START.ps1.'
}

function Assert-CleanWorktree {
  $status = @(& git.exe status --porcelain --untracked-files=normal)
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect Git worktree.'
  }
  if ($status.Count -ne 0) {
    Write-Host 'Git worktree is not clean:'
    $status | ForEach-Object { Write-Host $_ }
    throw 'Refusing to start forward validation with source changes in the worktree.'
  }
}

function Archive-IncompatibleActiveEvaluation([string]$CurrentHead) {
  $stateDir = Join-Path $Repo 'data\forward-validation'
  $statePath = Join-Path $stateDir 'active-30-day.json'
  $archiveDir = Join-Path $stateDir 'archive'
  $buildMarkerPath = Join-Path $stateDir 'backend-build-source-commit.txt'

  New-Item -ItemType Directory -Force -Path $stateDir,$archiveDir | Out-Null
  if (-not (Test-Path -LiteralPath $statePath)) { return }

  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  if (-not $state.evaluationId) {
    throw 'active-30-day.json has no evaluationId.'
  }

  $evaluationId = [string]$state.evaluationId
  $manifestPath = Join-Path $Repo "data\evaluations\$evaluationId\manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Active evaluation manifest is missing: $manifestPath"
  }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $sourceCommit = [string]$manifest.sourceCommit
  if (-not $sourceCommit) {
    throw 'Active evaluation manifest has no sourceCommit.'
  }

  if ($sourceCommit -eq $CurrentHead) {
    Write-Host "Existing active evaluation is source-compatible: $evaluationId"
    return
  }

  Write-Section 'ARCHIVING PRE-FIX ACTIVE EVALUATION'
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safeEvaluationId = $evaluationId -replace '[^A-Za-z0-9._-]','_'
  $archivedStatePath = Join-Path $archiveDir "active-30-day-$safeEvaluationId-$stamp.json"
  Move-Item -LiteralPath $statePath -Destination $archivedStatePath

  $record = [ordered]@{
    schemaVersion = 1
    evaluationId = $evaluationId
    originalSourceCommit = $sourceCommit
    replacementSourceCommit = $CurrentHead
    archivedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    reason = 'Pre-fix engineering evaluation archived before starting the validated bounded-deadline collector. Evidence preserved and never merged with the new source version.'
    archivedPointer = $archivedStatePath
  }

  $record |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $archiveDir "abandoned-$safeEvaluationId-$stamp.json") -Encoding UTF8

  Remove-Item -LiteralPath $buildMarkerPath -Force -ErrorAction SilentlyContinue
  Write-Host "Archived active pointer for: $evaluationId"
  Write-Host 'The evidence directory itself was preserved.'
}

Write-Section 'OKX 30-DAY VALIDATE + START WORKFLOW'

if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) {
  throw "Git repository not found: $Repo"
}

Remove-KnownTemporaryLauncher
Assert-CleanWorktree
$currentHead = Get-GitHead
Write-Host "Frozen candidate source: $currentHead"

Archive-IncompatibleActiveEvaluation $currentHead

Invoke-Native 'TYPECHECK' 'npm.cmd' @('run','typecheck')
Invoke-Native 'LINT' 'npm.cmd' @('run','lint')
Invoke-Native '30-DAY TIMER REGRESSION TEST' 'npm.cmd' @(
  'test','--','test/EvidenceCollectorDeadline.test.ts'
)
Invoke-Native 'FULL PROJECT TEST SUITE' 'npm.cmd' @('test')
Invoke-Native 'PRODUCTION BUILD' 'npm.cmd' @('run','build')
Invoke-Native 'EVIDENCE SMOKE TEST' 'npm.cmd' @('run','evidence:smoke')
Invoke-Native 'GIT DIFF CHECK' 'git.exe' @('diff','--check')

if ((Get-GitHead) -ne $currentHead) {
  throw 'Git HEAD changed during validation.'
}
Assert-CleanWorktree

$stateDir = Join-Path $Repo 'data\forward-validation'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
Set-Content -LiteralPath (Join-Path $stateDir 'backend-build-source-commit.txt') -Value $currentHead -Encoding ASCII

$supervisor = (Resolve-Path (Join-Path $PSScriptRoot 'START-30-DAY-EVIDENCE.ps1')).Path

Invoke-Native 'SUPERVISOR SELF-TEST' 'powershell.exe' @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File',$supervisor,'-SelfTest'
)
Invoke-Native 'SUPERVISOR PREFLIGHT' 'powershell.exe' @(
  '-NoProfile','-ExecutionPolicy','Bypass','-File',$supervisor,'-PreflightOnly'
)

Write-Section 'ALL VALIDATION PASSED - STARTING 30-DAY FORWARD VALIDATION'
Write-Host "Frozen source commit: $currentHead"
Write-Host 'A source-consistent evaluation will now start/resume.'
Write-Host 'Keep this VS Code terminal open.'
Write-Host 'Do not edit or commit source in this checkout during the active evaluation.'
Write-Host 'Live order execution remains disabled.'
Write-Host ''

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$supervisor"
$supervisorExit = $LASTEXITCODE
if ($supervisorExit -ne 0) {
  throw "30-day supervisor stopped with exit code $supervisorExit"
}
