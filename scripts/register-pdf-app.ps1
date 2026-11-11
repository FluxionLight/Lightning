param([string]$Executable = 'F:\Lightning\release\Lightning-0.6.0-windows-x64\Lightning.exe')
$ErrorActionPreference = 'Stop'
$exe = (Resolve-Path -LiteralPath $Executable).ProviderPath
if ([System.IO.Path]::GetFileName($exe) -ne 'Lightning.exe') { throw 'Expected the Lightning executable' }
if (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $exe) 'pdfium.dll'))) { throw 'Missing PDFium library' }
$progId = 'com.lightning.pdfreader.pdf'
$command = '"' + $exe + '" "%1"'
$icon = '"' + $exe + '",0'
$backup = [ordered]@{
    recordedAt = (Get-Date).ToString('o')
    previousPdfProgId = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice' -ErrorAction SilentlyContinue).ProgId
    executable = $exe
    registeredProgId = $progId
}
$backupPath = Join-Path (Split-Path -Parent $PSScriptRoot) ('test-results\pdf-association-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
[System.IO.File]::WriteAllText($backupPath,($backup | ConvertTo-Json),[System.Text.UTF8Encoding]::new($false))
function Set-UserValue([string]$Path,[string]$Name,[object]$Value,[Microsoft.Win32.RegistryValueKind]$Kind=[Microsoft.Win32.RegistryValueKind]::String) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Path)
    try { $key.SetValue($Name,$Value,$Kind) } finally { $key.Dispose() }
}
Set-UserValue "Software\Classes\$progId" '' 'Lightning PDF 文档'
Set-UserValue "Software\Classes\$progId" 'FriendlyTypeName' 'PDF 文档'
Set-UserValue "Software\Classes\$progId\DefaultIcon" '' $icon
Set-UserValue "Software\Classes\$progId\shell\open\command" '' $command
Set-UserValue 'Software\Classes\Applications\Lightning.exe' 'FriendlyAppName' 'Lightning'
Set-UserValue 'Software\Classes\Applications\Lightning.exe\SupportedTypes' '.pdf' ''
Set-UserValue 'Software\Classes\Applications\Lightning.exe\shell\open\command' '' $command
Set-UserValue 'Software\Classes\.pdf\OpenWithProgids' $progId ([byte[]]@()) ([Microsoft.Win32.RegistryValueKind]::None)
Set-UserValue 'Software\Lightning\Capabilities' 'ApplicationName' 'Lightning'
Set-UserValue 'Software\Lightning\Capabilities' 'ApplicationDescription' '本地 PDF 阅读器'
Set-UserValue 'Software\Lightning\Capabilities' 'ApplicationIcon' $icon
Set-UserValue 'Software\Lightning\Capabilities\FileAssociations' '.pdf' $progId
Set-UserValue 'Software\RegisteredApplications' 'Lightning' 'Software\Lightning\Capabilities'
# Register the app as a candidate. Windows Settings owns the protected default choice.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LightningAssociationNotify {
    [DllImport("shell32.dll")] public static extern void SHChangeNotify(uint e,uint f,IntPtr a,IntPtr b);
}
'@
[LightningAssociationNotify]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)
[ordered]@{registered=$progId;executable=$exe;previousDefault=$backup.previousPdfProgId;backup=$backupPath} | ConvertTo-Json
