$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = '~\Desktop\Ai\ANDROID STUDIO\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location '~\Desktop\Ai\cc-mobile-app'
cmd.exe /c '.\gradlew.bat --no-daemon assembleDebug'
