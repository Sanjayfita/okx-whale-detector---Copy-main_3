$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Repo

Write-Host '============================================================'
Write-Host 'OKX HISTORICAL L2 VIRTUAL-TIME REPLAY'
Write-Host 'Historical output is isolated under data\historical-research.'
Write-Host 'Live order execution remains disabled.'
Write-Host '============================================================'
Write-Host ''
$InputPath = Read-Host 'Path to extracted OKX L2 archive file/folder'
$InstrumentPath = Read-Host 'Path to historical-instruments.json'
$FundingPath = Read-Host 'Optional funding CSV/NDJSON path (press Enter for none)'
$RunId = Read-Host 'Optional run id (press Enter for deterministic default)'
$Fees = Read-Host 'Fees bps per side [default 5]'
$Slippage = Read-Host 'Slippage bps per side [default 2]'
if (-not $Fees) { $Fees = '5' }
if (-not $Slippage) { $Slippage = '2' }

$args = @(
  'run','historical:l2:replay','--',
  '--input',$InputPath,
  '--instruments',$InstrumentPath,
  '--fees-bps',$Fees,
  '--slippage-bps',$Slippage
)
if ($FundingPath) { $args += @('--funding',$FundingPath) }
if ($RunId) { $args += @('--run-id',$RunId) }

& npm.cmd @args
if ($LASTEXITCODE -ne 0) { throw "Historical replay failed with exit code $LASTEXITCODE" }
