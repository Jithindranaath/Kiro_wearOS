#!/usr/bin/env bash
#
# Build a signed, installable Wear OS release APK locally.
#
#   scripts/wear-release.sh
#
# Requires wear/keystore.properties (gitignored). If it is missing, this script
# prints the keytool command to create a keystore and stops — it will not invent
# a password or commit one for you.
#
# Output: wear/app/build/outputs/apk/release/app-release.apk, signature verified.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
wear_dir="$repo_root/wear"
props="$wear_dir/keystore.properties"

: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
export ANDROID_HOME

if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "ANDROID_HOME does not exist: $ANDROID_HOME" >&2
  echo "Set ANDROID_HOME to your Android SDK location and retry." >&2
  exit 1
fi

if [[ ! -f "$props" ]]; then
  cat >&2 <<EOF
Missing $props

A release APK must be signed or Android will refuse to install it. Create a
keystore once, keep it safe, and reuse it for every future release — a new key
means users have to uninstall before they can upgrade.

  cd "$wear_dir"
  keytool -genkeypair -v -keystore aibou-release.jks -alias aibou \\
          -keyalg RSA -keysize 4096 -validity 10000

Then copy keystore.properties.example to keystore.properties and fill in the
password you chose. Both aibou-release.jks and keystore.properties are
gitignored.
EOF
  exit 1
fi

cd "$wear_dir"
./gradlew --no-daemon :app:lintDebug :app:assembleRelease

apk="$(find app/build/outputs/apk/release -name '*.apk' -print -quit)"
if [[ -z "$apk" ]]; then
  echo "No APK produced." >&2
  exit 1
fi

if [[ "$apk" == *unsigned* ]]; then
  echo "Built $apk but it is UNSIGNED — check the storeFile path in keystore.properties." >&2
  exit 1
fi

apksigner="$(find "$ANDROID_HOME/build-tools" -name apksigner -print 2>/dev/null | sort -r | head -1)"
if [[ -n "$apksigner" ]]; then
  "$apksigner" verify --print-certs "$apk"
else
  echo "apksigner not found under $ANDROID_HOME/build-tools — skipping verification." >&2
fi

printf '\nInstallable APK: %s (%s)\n' "$wear_dir/$apk" "$(du -h "$apk" | cut -f1)"
printf 'Install with: adb install -r "%s"\n' "$wear_dir/$apk"
