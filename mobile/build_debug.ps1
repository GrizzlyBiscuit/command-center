$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'C:\Users\mattz\Desktop\Ai\ANDROID STUDIO\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location 'C:\Users\mattz\Desktop\Ai\cc-mobile-app'
cmd.exe /c '.\gradlew.bat --no-daemon assembleDebug'
