#requires -Version 5.1
<#
  dev-install.ps1 — sync this checkout into an installed DSH profile.

  Iterate on the plugin without uninstalling/reinstalling it:

    1. edit the plugin in this repository
    2. run this script (it replaces the installed copy with the checkout)
    3. fully quit DSH (tray icon included) and start it again

  The script swaps the whole package directory instead of overwriting files in
  place: pnpm installs packages as hardlinks into its content-addressable store,
  and writing through those links would corrupt the store shared by other
  profiles.

  Usage:
    pwsh -File scripts\dev-install.ps1
    pwsh -File scripts\dev-install.ps1 -ProfileName desktop
    pwsh -File scripts\dev-install.ps1 -DshHome 'D:\custom-dsh-home'
    pwsh -File scripts\dev-install.ps1 -UpdateDependency

  -UpdateDependency also points the profile's package.json dependency at this
  checkout (file:<repo>), so a later "update/repair" in the Plugins page does
  not quietly reinstall a published tarball. Off by default: the plugin manager
  owns that manifest, and changing it is a deliberate choice.
#>
[CmdletBinding()]
param(
  [string]$ProfileName = 'desktop',
  [string]$DshHome = '',
  [switch]$UpdateDependency
)

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repo 'package.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "not a plugin checkout: $repo"
}

if (-not $DshHome) {
  if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME } else { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
}
$profileDir = Join-Path $DshHome "profiles\$ProfileName"
if (-not (Test-Path -LiteralPath $profileDir)) {
  throw "DSH profile not found: $profileDir (start DSH once so the profile exists)"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$target = Join-Path $profileDir "node_modules\$($manifest.name)"
$staging = "$target.__staging"

Write-Host "==> dev-install $($manifest.name) $($manifest.version)"
Write-Host "    source : $repo"
Write-Host "    target : $target"

$items = @(
  'package.json',
  'cordis.patch.yml',
  'lib',
  'locale',
  'icon.svg',
  'assets',
  'README.md',
  'README.en.md',
  'CHANGELOG.md',
  'LICENSE'
)

if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
foreach ($item in $items) {
  $source = Join-Path $repo $item
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination $staging -Recurse -Force
  }
}

# Swap the directory so the installed files are fresh inodes, never pnpm store
# hardlinks written through in place.
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
Move-Item -LiteralPath $staging -Destination $target

if ($UpdateDependency) {
  $profileManifestPath = Join-Path $profileDir 'package.json'
  $profileManifest = Get-Content -LiteralPath $profileManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $profileManifest.dependencies) {
    $profileManifest | Add-Member -MemberType NoteProperty -Name dependencies -Value ([pscustomobject]@{})
  }
  $spec = 'file:' + ($repo -replace '\\', '/')
  $dependencies = $profileManifest.dependencies
  if ($dependencies.PSObject.Properties.Name -contains $manifest.name) {
    $dependencies.($manifest.name) = $spec
  } else {
    $dependencies | Add-Member -MemberType NoteProperty -Name $manifest.name -Value $spec
  }
  $profileManifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $profileManifestPath -Encoding UTF8
  Write-Host "==> profile dependency -> $spec"
}

$installed = Get-Content -LiteralPath (Join-Path $target 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "==> installed version: $($installed.version)"
Write-Host "==> done. Fully quit DSH (tray icon included) and start it again."
Write-Host "    Host and Client JavaScript is loaded at process start, so a restart is required."
