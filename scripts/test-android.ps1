$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$out=Join-Path $root 'test-results/android-native'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$manager='D:\MuMuPlayer\nx_main\MuMuManager.exe'
$adb='D:\MuMuPlayer\nx_main\adb.exe'
& $manager control -v 0 launch
$limit=[DateTime]::UtcNow.AddMinutes(3)
$ready=$false
while([DateTime]::UtcNow -lt $limit){
  $info=(& $manager info -v 0 | Out-String | ConvertFrom-Json)
  if($info.is_android_started){$ready=$true;break}
  Start-Sleep -Seconds 2
}
if(!$ready){throw 'Android emulator did not finish starting'}
$device='127.0.0.1:'+$info.adb_port
& $adb connect $device
& $manager control -v 0 hide_window
& $adb -s $device install -r (Join-Path $root 'release/Lightning_0.7.0_android.apk')
if($LASTEXITCODE -ne 0){throw 'APK install failed'}
& $adb -s $device push (Join-Path $root 'tests/fixtures/reading-sample.pdf') '/sdcard/Download/Lightning-QA-20261027.pdf'
& $adb -s $device shell am start -n 'com.lightning.pdfreader/.MainActivity'
Start-Sleep -Seconds 3
& $adb -s $device shell screencap -p '/sdcard/Download/Lightning-QA-start.png'
& $adb -s $device pull '/sdcard/Download/Lightning-QA-start.png' (Join-Path $out 'start.png')
& $adb -s $device shell uiautomator dump '/sdcard/Download/Lightning-QA-ui.xml'
& $adb -s $device pull '/sdcard/Download/Lightning-QA-ui.xml' (Join-Path $out 'start.xml')
Write-Output "APK installed and started on $device"
Write-Output 'Keeping this test emulator session alive for app verification.'
$limit=[DateTime]::UtcNow.AddMinutes(45)
while([DateTime]::UtcNow -lt $limit -and !(Test-Path -LiteralPath (Join-Path $out 'stop'))){Start-Sleep -Seconds 2}
& $manager control -v 0 shutdown
