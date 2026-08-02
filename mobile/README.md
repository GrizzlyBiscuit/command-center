# Command Center Mobile — Android WebView APK

Goal: a native-feeling Android app that connects to your local Command Center hub while you’re on the same network or via Tailscale.

## Project layout
`C:\Users\mattz\Desktop\Ai\cc-mobile-app`
- `app/src/main/java/com/commandcenter/app/MainActivity.java`
- `app/src/main/AndroidManifest.xml`
- `app/build.gradle`, `settings.gradle`, `build.gradle`

## Setup
1. Install Android Studio
2. Open this folder as a Gradle project
3. If prompted, let it install SDK 35 / build-tools
4. Create `local.properties` with your SDK path:
   `sdk.dir=C:/Users/mattz/AppData/Local/Android/Sdk`
5. Run on device/emulator via Android Studio

## How it connects
- Tailscale hostname first: `http://commandcenter.local:5050`
- Then direct IP: `http://192.168.1.88:5050`
- Cleartext allowed for local domains via `network_security_config.xml`
- External links always open in the real browser
- In Music, **Play on > This device** plays through the phone. **Command Center PC** controls the audio element in the running desktop launcher window.

## Build a release APK
Build > Generate Signed Bundle / APK > APK > debug keystore OK for personal use.
