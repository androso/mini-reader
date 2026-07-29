# Mentarie mobile

The native iOS and Android client uses Expo SDK 57, Expo Router, and a custom
development build. Expo Go is insufficient because the reader includes native
PDF, filesystem, SQLite, and secure-storage modules.

```bash
cp apps/mobile/.env.template apps/mobile/.env
pnpm mobile:dev
```

Set `EXPO_PUBLIC_API_URL` to an API origin the device can reach. Production and
internal preview builds must use HTTPS. Build a development client with
`eas build --profile development --platform ios` or `--platform android`, then
open the Metro session in that client.

On Linux, `pnpm --filter @reader/mobile android` uses the configured JDK when
it includes `javac`, then falls back to Android Studio's bundled JBR at
`/opt/android-studio/jbr`. If neither is available, install a Java 21
development kit or set `JAVA_HOME` to one before running the command.

Email/password signup and login use rotating mobile sessions. EPUB downloads
contain sanitized server-generated chapters and private derived resources;
PDFs retain the original file. A book becomes available offline only after its
download is complete. Chat deliberately remains online-only.
