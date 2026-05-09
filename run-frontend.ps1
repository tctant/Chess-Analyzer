# launches the vite dev server. installs npm deps on first run.
# backend should be running separately via .\run.ps1 since vite proxies
# /api/* to localhost:8000.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
Set-Location -Path "frontend"

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies (this takes a minute the first time)..." -ForegroundColor Cyan
    npm install
}

Write-Host ""
Write-Host "Starting frontend at http://localhost:5173" -ForegroundColor Green
Write-Host "Make sure the backend is also running (.\run.ps1 in another terminal)." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

npm run dev
