# Bubble AI for Android

Bubble AI on Android phones and tablets. It pairs with Bubble AI on your computer by scanning a QR code, then shows Bubble AI's own phone layout (chats, agents, requests that need your OK, watching or taking over computers) in a web view, signed in with the sign-in the pairing gave it.

## Pair it

1. In Bubble AI on your computer, open **Settings → Computers → Phone** and click **Start pairing**.
2. In the app, tap **Scan QR code** (Google's scanner from Play services reads it; Bubble AI itself never gets camera access). Scanning with the camera app also works: the code is a `wisp://pair` link, which opens Bubble AI.
3. Check that both screens show the same six digits and click **Yes, pair it** on the computer.

The phone must be able to reach the computer: the same Wi-Fi, Tailscale, or a public address (see [Deploying](../../docs/deploy.md)). Plain `http://` is allowed, since most Bubble AI hubs live on a home network. Without a camera (like in the emulator), click **Copy pairing link** on the computer and choose **Paste link**, or send it with `adb shell am start -a android.intent.action.VIEW -d '"wisp://pair?..."'`.

Signing out in Bubble AI, or signing the phone out from the computer (**Settings → Security → Sign-ins**), brings the app back to the pairing screen.

## Notifications

The app can tell you about agent replies, @mentions, approvals and agents that need you on their computer while it's closed, through Firebase Cloud Messaging. It's optional and **the person running the hub sets it up**: make a Firebase project and give the hub its service-account key (see [Push notifications for the Android app](../../docs/deploy.md#push-notifications-for-the-android-app)). Nothing about Firebase is baked into this app (no `google-services.json`, no Gradle plugin): after you sign in, the hub hands the app its project's client settings, the app starts Firebase with them, and uploads its push token to the hub. A hub without Firebase set up gets no prompts and no pushes.

On Android 13 and newer the app asks to allow notifications once, after Bubble AI has loaded and only if the hub can send them. **Settings → Notifications** (inside the app) shows the status and has a test button. Tapping a notification opens that chat, approval or computer. A notification isn't shown while the app is open on screen. Notifications are split into Messages, Approvals and Needs-you-on-a-computer channels you can tune in Android's settings.

## Build it

Needs JDK 17 or newer and the Android SDK (platform 35). With Homebrew:

```bash
brew install openjdk@21 && brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=~/Library/Android/sdk
sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-35" "build-tools;35.0.0"
cd apps/android && ./gradlew assembleDebug    # app/build/outputs/apk/debug/app-debug.apk
```

Install it on a phone with USB debugging on: `adb install -r app/build/outputs/apk/debug/app-debug.apk`, or send the APK to the phone and open it (Android asks to allow installing from that app).

Release builds (`./gradlew assembleRelease`) are signed with the release key when `ANDROID_KEYSTORE_PATH` (plus the password and alias variables below) points at one, and with the debug key otherwise, so testers can still sideload them. Tagged releases attach `Bubble-AI-android.apk` through [`android-release.yml`](../../.github/workflows/android-release.yml); you can also run that workflow by hand to get the APK as a workflow artifact. Without a release key the APK is labelled "debug-signed test build", and since each CI run has its own debug key, testers must uninstall before installing a newer one.

### Release key

To sign every release with the same key (needed for updates to install over each other, and for Google Play), make a keystore once and keep it safe (losing it means a new app listing):

```bash
keytool -genkeypair -v -keystore bubble-ai-release.jks -alias bubble-ai -keyalg RSA -keysize 4096 -validity 10000
base64 -i bubble-ai-release.jks | tr -d '\n' | pbcopy
```

Then add these repository secrets (GitHub → Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the keystore, base64 on one line (what the second command copied) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `bubble-ai` (the `-alias` above) |
| `ANDROID_KEY_PASSWORD` | the key password; leave it out if it's the same as the keystore's |

Locally: `ANDROID_KEYSTORE_PATH=/path/to/bubble-ai-release.jks ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=bubble-ai ./gradlew assembleRelease`.

Google Play also needs Play App Signing (upload this key as the upload key), a target SDK Play currently accepts, and (for new personal developer accounts) a 14-day closed test with 12 testers.

## Not yet

- Per-kind notification switches inside Bubble AI (use Android's own notification channels for now), and the unread count as an app badge.
- Watching an agent's computer uses the web app's viewer, which works but isn't tuned for touch like the iPhone app's.
