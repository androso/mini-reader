#!/usr/bin/env bash
set -euo pipefail

has_compiler() {
    [ -n "${1:-}" ] && [ -x "$1/bin/java" ] && [ -x "$1/bin/javac" ]
}

if ! has_compiler "${JAVA_HOME:-}"; then
    if has_compiler "/opt/android-studio/jbr"; then
        export JAVA_HOME="/opt/android-studio/jbr"
    elif command -v javac >/dev/null 2>&1; then
        javac_path="$(readlink -f "$(command -v javac)")"
        export JAVA_HOME="${javac_path%/bin/javac}"
    else
        echo "Android builds require JDK 21 with both java and javac." >&2
        echo "Install java-21-openjdk-devel or set JAVA_HOME to Android Studio's JBR." >&2
        exit 1
    fi
fi

export PATH="$JAVA_HOME/bin:$PATH"
exec expo run:android "$@"
