# launches the api server. activates .venv, installs deps if requirements.txt
# changed, optionally syncs games for a user, then starts uvicorn with reload.
#
# usage:
#     .\run.ps1                  start api server
#     .\run.ps1 -Sync MooMooTNT  sync that user's games first

param(
    [string]$Sync = ""
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Cyan
    python -m venv .venv
}
& ".venv\Scripts\Activate.ps1"

# only reinstall if requirements.txt is newer than the marker file
$marker = ".venv\.deps-installed"
if (-not (Test-Path $marker) -or
    (Get-Item "requirements.txt").LastWriteTime -gt (Get-Item $marker).LastWriteTime) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    pip install -q -r requirements.txt
    New-Item -ItemType File -Path $marker -Force | Out-Null
}

if ($Sync -ne "") {
    Write-Host "Syncing games for $Sync..." -ForegroundColor Cyan
    python fetch_games.py $Sync
}

Write-Host ""
Write-Host "Starting API server at http://localhost:8000" -ForegroundColor Green
Write-Host "Interactive docs: http://localhost:8000/docs" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""
uvicorn api:app --reload
