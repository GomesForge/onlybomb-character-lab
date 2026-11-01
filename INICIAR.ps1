$ErrorActionPreference = 'Stop'
$simulatorRoot = $PSScriptRoot
$simulatorUrl = 'http://localhost:8768'
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) { throw 'Python não encontrado. Instale Python3 para executar o simulador.' }
$serverAvailable = $false
try { $health = Invoke-RestMethod -Uri "$simulatorUrl/api/health" -TimeoutSec 2; $serverAvailable = $health.tool -eq 'OnlyBomb Character Lab' } catch {}
if (-not $serverAvailable) {
    Start-Process -FilePath $pythonCommand.Source -ArgumentList @('"' + (Join-Path $simulatorRoot 'servidor.py') + '"') -WorkingDirectory $simulatorRoot -WindowStyle Hidden
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 250
        try { $health = Invoke-RestMethod -Uri "$simulatorUrl/api/health" -TimeoutSec 1; if ($health.tool -eq 'OnlyBomb Character Lab') { $serverAvailable = $true; break } } catch {}
    }
}
if (-not $serverAvailable) { throw 'O servidor local não iniciou. Execute python servidor.py nesta pasta para ver o erro.' }
Start-Process $simulatorUrl
