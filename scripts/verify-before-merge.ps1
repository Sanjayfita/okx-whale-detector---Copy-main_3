$ErrorActionPreference = "Stop"

function Run-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host $Title -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan

    & $Command

    if ($LASTEXITCODE -ne 0) {
        throw "$Title failed with exit code $LASTEXITCODE."
    }

    Write-Host "PASSED: $Title" -ForegroundColor Green
}

Write-Host ""
Write-Host "OKX Whale Detector - Pre-Merge Verification" -ForegroundColor Yellow

Run-Step "Git working-tree check" {
    $changes = git status --porcelain

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read Git status."
    }

    if ($changes) {
        Write-Host $changes
        throw "Working tree is not clean. Commit or restore changes before continuing."
    }
}

Run-Step "Typecheck, lint, and full test suite" {
    npm.cmd run check
}

Run-Step "Production build" {
    npm.cmd run build
}

Run-Step "Whitespace and conflict-marker check" {
    git diff --check
}

$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$availableScripts = $packageJson.scripts.PSObject.Properties.Name

$simulationScripts = @(
    "alerts:simulate:alignment",
    "alerts:simulate:returns",
    "alerts:simulate:paths",
    "alerts:simulate:targets",
    "alerts:simulate:quality",
    "alerts:simulate:quality-comparison",
    "alerts:simulate:quality-trend",
    "alerts:simulate:quality-trend-persistence",
    "alerts:simulate:quality-trend-comparison"
)

foreach ($simulationScript in $simulationScripts) {
    if ($availableScripts -contains $simulationScript) {
        $scriptName = $simulationScript

        $simulationCommand = {
            npm.cmd run $scriptName
        }.GetNewClosure()

        Run-Step "Simulation: $scriptName" $simulationCommand
    }
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "ALL PRE-MERGE CHECKS PASSED" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green

Write-Host ""
Write-Host "Current branch:" -ForegroundColor Yellow
git branch --show-current

Write-Host ""
Write-Host "Latest commit:" -ForegroundColor Yellow
git log -1 --oneline

Write-Host ""
Write-Host "You may now merge and push manually." -ForegroundColor Green
