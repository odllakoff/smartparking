param([int]$Instances = 2, [string]$Duration = '60s', [int]$Rate = 500)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$env:PM2_HOME = Join-Path (Get-Location).Path 'data\pm2'
$env:PM2_INSTANCES = "$Instances"
# La contraseña se carga desde .env sin escribirla en argumentos ni resultados.
$passwordLine = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^DEMO_PASSWORD=' } | Select-Object -First 1
$env:DEMO_PASSWORD = $passwordLine.Substring('DEMO_PASSWORD='.Length)
New-Item -ItemType Directory -Force -Path results | Out-Null
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación' }
& node_modules\.bin\pm2.cmd startOrReload ecosystem.config.cjs --only smartparking-audit --update-env
if ($LASTEXITCODE -ne 0) { throw 'Falló el inicio de auditoría' }
& node_modules\.bin\pm2.cmd startOrReload ecosystem.config.cjs --only smartparking-api --update-env
if ($LASTEXITCODE -ne 0) { throw 'Falló PM2' }
$processes = (& node_modules\.bin\pm2.cmd jlist | Out-String | ConvertFrom-Json -AsHashtable)
$currentInstances = @($processes | Where-Object { $_.name -eq 'smartparking-api' }).Count
# PM2 devuelve error si scale recibe la cantidad que ya está ejecutando.
if ($currentInstances -ne $Instances) {
    & node_modules\.bin\pm2.cmd scale smartparking-api $Instances
    if ($LASTEXITCODE -ne 0) { throw 'Falló el escalado de PM2' }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$metadata = @{ timestamp=(Get-Date).ToString('o'); workers=$Instances; duration=$Duration; rate=$Rate; steadyPreAllocatedVUs=300; steadyMaxVUs=300; loadScriptSha256=(Get-FileHash -LiteralPath 'load/queries.js' -Algorithm SHA256).Hash; node=(node --version); k6=(k6 version); cpu=(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors); ramBytes=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory }
$metadata | ConvertTo-Json -Depth 4 | Set-Content "results/$stamp-$Instances-workers-environment.json"
k6 run --env "DURATION=$Duration" --env "RATE=$Rate" --summary-export "results/$stamp-$Instances-workers.json" load/queries.js
if ($LASTEXITCODE -ne 0) { throw 'k6 no cumplió los umbrales; revisar resultados' }
