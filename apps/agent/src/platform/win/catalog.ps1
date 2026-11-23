# Lista las apps del menú Inicio de Windows (Get-StartApps) como JSON por stdout: [{ "appId": "...", "name": "..." }].
# No recibe nada de afuera.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$apps = @(Get-StartApps | ForEach-Object { [pscustomobject]@{ appId = [string]$_.AppID; name = [string]$_.Name } })
ConvertTo-Json -InputObject $apps -Compress
