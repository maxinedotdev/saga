param(
    [string]$ServiceName = "SagaMcpService",
    [string]$DisplayName = "Saga MCP Server",
    [string]$RuntimeDir = "",
    [string]$NodeBin = "",
    [string]$ServerJs = "",
    [string]$ConfigToml = ""
)

$ErrorActionPreference = "Stop"

if (-not $RuntimeDir) {
    $RuntimeDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
if (-not $NodeBin) {
    $NodeBin = (Get-Command node).Source
}
if (-not $ServerJs) {
    $ServerJs = Join-Path $RuntimeDir "dist/server.js"
}
if (-not $ConfigToml) {
    $ConfigToml = Join-Path $HOME ".saga/saga.toml"
}

if (-not (Test-Path $NodeBin)) {
    throw "Node binary not found: $NodeBin"
}
if (-not (Test-Path $ServerJs)) {
    throw "Saga server not found: $ServerJs"
}
if (-not (Test-Path $ConfigToml)) {
    throw "Saga config not found: $ConfigToml"
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    sc.exe stop $ServiceName | Out-Null
    Start-Sleep -Seconds 1
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

$binPath = "`"$NodeBin`" `"$ServerJs`" --config `"$ConfigToml`""
sc.exe create $ServiceName binPath= "$binPath" start= auto DisplayName= "$DisplayName" | Out-Null
sc.exe start $ServiceName | Out-Null

Write-Host "Installed and started Windows service: $ServiceName"
Write-Host "Command: $binPath"
