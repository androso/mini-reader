#!/usr/bin/env bash
set -euo pipefail

if ! command -v xcodebuild >/dev/null 2>&1; then
    echo "iOS builds require macOS with Xcode (xcodebuild) installed." >&2
    echo "Use EAS Build for cloud iOS builds: eas build --profile development --platform ios" >&2
    exit 1
fi

if ! command -v pod >/dev/null 2>&1; then
    echo "CocoaPods (pod) is required for iOS native dependencies." >&2
    echo "Install with: sudo gem install cocoapods   or   brew install cocoapods" >&2
    exit 1
fi

exec expo run:ios "$@"
