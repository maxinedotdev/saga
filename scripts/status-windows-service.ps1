param(
    [string]$ServiceName = "SagaMcpService",
    [string]$Url = "http://127.0.0.1:8080/mcp"
)

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host "Service not found: $ServiceName"
    exit 1
}

Write-Host "Service: $ServiceName"
Write-Host "Status: $($service.Status)"
Write-Host
Write-Host "Process:"
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*dist/server.js*' } | Select-Object ProcessId, ParentProcessId, CommandLine | Format-List
Write-Host
Write-Host "Endpoint check: $Url"
try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method Get -TimeoutSec 5
    Write-Host "HTTP $($response.StatusCode)"
} catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode.value__) {
        Write-Host "HTTP $($_.Exception.Response.StatusCode.value__)"
    } else {
        Write-Host "Endpoint check failed: $($_.Exception.Message)"
    }
}
