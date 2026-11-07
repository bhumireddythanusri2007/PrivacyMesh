param(
    [string]$EnvFile = ".env",
    [string]$OutputFile = "kubernetes/01-secrets.yaml",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Environment file not found: $EnvFile"
}

if ((Test-Path -LiteralPath $OutputFile) -and -not $Force) {
    throw "Output already exists. Review it first, then rerun with -Force to overwrite."
}

$required = @(
    "POSTGRES_PASSWORD",
    "APP_DB_PASSWORD",
    "JWT_SECRET_KEY",
    "GRAFANA_ADMIN_PASSWORD"
)

$values = @{}

foreach ($key in $required) {
    $matches = @(Get-Content -LiteralPath $EnvFile | Where-Object {
        $_ -match "^\s*$([regex]::Escape($key))\s*="
    })

    if ($matches.Count -ne 1) {
        throw "$key must appear exactly once in $EnvFile."
    }

    $value = ($matches[0] -split "=", 2)[1].Trim().Trim('"').Trim("'")

    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$key is empty."
    }

    if ($value -match '[\r\n]') {
        throw "$key contains an invalid newline."
    }

    $values[$key] = $value
}

function ConvertTo-YamlString([string]$Value) {
    return '"' + $Value.Replace('\', '\\').Replace('"', '\"') + '"'
}

$manifest = @"
apiVersion: v1
kind: Secret
metadata:
  name: privacymesh-secrets
  namespace: privacymesh
  labels:
    app.kubernetes.io/name: privacymesh
type: Opaque
stringData:
  POSTGRES_PASSWORD: $(ConvertTo-YamlString $values["POSTGRES_PASSWORD"])
  APP_DB_PASSWORD: $(ConvertTo-YamlString $values["APP_DB_PASSWORD"])
  JWT_SECRET_KEY: $(ConvertTo-YamlString $values["JWT_SECRET_KEY"])
  GRAFANA_ADMIN_PASSWORD: $(ConvertTo-YamlString $values["GRAFANA_ADMIN_PASSWORD"])
"@

$directory = Split-Path -Parent $OutputFile
if ($directory -and -not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

Set-Content -LiteralPath $OutputFile -Value $manifest -Encoding utf8

Write-Host "Kubernetes secrets manifest generated successfully."
Write-Host "Secret values were not displayed."
