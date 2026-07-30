# Mentarie mobile

The native iOS and Android client uses Expo SDK 57 and Expo Router.
`pnpm mobile:dev` launches Expo Go. Install Expo Go on a phone, start Metro,
and scan the QR code. LAN is the default; append `-- --tunnel` on restrictive
networks.

iOS Expo Go supports EPUB upload, reading, offline download, progress restore,
and chat. PDF upload, download, and reading are unavailable on iOS. Android PDF
support still requires `pnpm mobile:dev-client` with a development build that
includes the react-native-pdf config plugins.

```bash
cp apps/mobile/.env.template apps/mobile/.env
pnpm mobile:dev
```

Set `EXPO_PUBLIC_API_URL` to an API origin the device can reach. A physical
iPhone needs a phone-reachable HTTPS origin (ATS blocks cleartext except
localhost). The iOS Simulator can use `http://localhost:3000` for a local API.

## Running on device / simulator

For Android PDF viewing, or for a custom development client on either platform:

```bash
pnpm mobile:dev-client
```

Build and install a development client first with EAS or a local native run:

```bash
pnpm --filter @reader/mobile ios
# or from the repo root:
pnpm mobile:ios
```

Android:

```bash
pnpm --filter @reader/mobile android
# or:
pnpm mobile:android
```

`android/` and `ios/` are Continuous Native Generation (CNG) outputs and are
gitignored. The first `expo run:ios` / `expo run:android` prebuilds those native
projects locally.

EAS remains the optional route for standalone/custom-client binaries:

`eas build --profile development --platform ios` or `--platform android`, then
open the Metro session in that client. EAS is not required for iOS Expo Go.

On Linux, `pnpm --filter @reader/mobile android` uses the configured JDK when
it includes `javac`, then falls back to Android Studio's bundled JBR at
`/opt/android-studio/jbr`. If neither is available, install a Java 21
development kit or set `JAVA_HOME` to one before running the command.

Email/password signup and login use rotating mobile sessions. EPUB downloads
contain sanitized server-generated chapters and private derived resources;
PDFs retain the original file on Android. A book becomes available offline only
after its download is complete. Chat deliberately remains online-only.
