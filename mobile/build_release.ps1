$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'C:\Users\mattz\Desktop\Ai\ANDROID STUDIO\jbr'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$env:CC_RELEASE_KEYSTORE = 'C:\Users\mattz\.cc-release.jks'
$env:CC_RELEASE_KEY_PASSWORD = 'change-me-later'
$env:CC_RELEASE_KEY_ALIAS = 'cc'
Set-Location 'C:\Users\mattz\Desktop\Ai\cc-mobile-app'
cmd.exe /c '.\gradlew.bat --no-daemon assembleRelease'
