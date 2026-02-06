param(
    [string]$ServiceName = "SagaMcpService"
)

$ErrorActionPreference = "Stop"

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Service not found: $ServiceName"
    exit 0
}

sc.exe stop $ServiceName | Out-Null
Start-Sleep -Seconds 1
sc.exe delete $ServiceName | Out-Null

Write-Host "Uninstalled Windows service: $ServiceName"
