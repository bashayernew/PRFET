#!/usr/bin/env bash
# PRFET — one-time iOS project bootstrap.
#
#   bash scripts/ios-setup.sh
#
# Generates the native iOS project, then patches in every Info.plist permission
# string the app's plugins need and the privacy manifest Apple requires.
# Safe to re-run: each step checks before acting.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

# ── Preflight ────────────────────────────────────────────────────────────────
say "Checking prerequisites"
[ "$(uname)" = "Darwin" ] || die "iOS builds require macOS."
command -v node >/dev/null || die "Node not found. Run: brew install node@22"
xcodebuild -version >/dev/null 2>&1 || die "Xcode not ready. Open Xcode once to finish installing its components."
command -v pod >/dev/null || die "CocoaPods not found. Run: sudo gem install cocoapods"
echo "Node $(node -v) · $(xcodebuild -version | head -1) · CocoaPods $(pod --version)"

[ -d node_modules ] || { say "Installing dependencies"; npm install; }

# ── Generate the native project ──────────────────────────────────────────────
if [ -d ios ]; then
  say "ios/ already exists — skipping 'cap add', syncing instead"
else
  say "Generating the iOS project"
  npx cap add ios
fi

say "Syncing web assets and plugins into the native project"
npx cap sync ios

PLIST="$ROOT/ios/App/App/Info.plist"
[ -f "$PLIST" ] || die "Info.plist not found at $PLIST — did 'cap add ios' fail?"
PB=/usr/libexec/PlistBuddy

# ── Permission strings ───────────────────────────────────────────────────────
# iOS kills the app on the spot if it requests a permission with no usage string,
# and App Review rejects vague ones. Each line below maps to a plugin in use.
say "Adding Info.plist permission strings"

set_str() {
  local key="$1" val="$2"
  if $PB -c "Print :$key" "$PLIST" >/dev/null 2>&1; then
    $PB -c "Set :$key $val" "$PLIST"
  else
    $PB -c "Add :$key string $val" "$PLIST"
  fi
  echo "  · $key"
}

set_str NSCameraUsageDescription \
  "PRFET uses your camera so you can take photos and videos for your posts, stories, and chats."
set_str NSMicrophoneUsageDescription \
  "PRFET uses your microphone for voice messages and audio and video calls."
set_str NSPhotoLibraryUsageDescription \
  "PRFET needs access to your photos so you can share them in posts, stories, and messages."
set_str NSPhotoLibraryAddUsageDescription \
  "PRFET saves photos and videos you download to your library."
set_str NSLocationWhenInUseUsageDescription \
  "PRFET uses your location to show people and businesses near you and to calculate distance."
set_str NSBluetoothAlwaysUsageDescription \
  "PRFET uses Bluetooth to discover other PRFET users nearby when you enable nearby discovery."
set_str NSBluetoothPeripheralUsageDescription \
  "PRFET uses Bluetooth to discover other PRFET users nearby when you enable nearby discovery."

# Arabic is the primary language; make the app declare it properly.
set_str CFBundleDevelopmentRegion "ar"

# ── Privacy manifest ─────────────────────────────────────────────────────────
# Required by Apple. Declares what data is collected and why certain
# "required reason" APIs are used. A missing or wrong manifest is an
# automatic upload rejection from App Store Connect.
say "Writing the privacy manifest"
MANIFEST="$ROOT/ios/App/App/PrivacyInfo.xcprivacy"
cat > "$MANIFEST" <<'XCPRIVACY'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>

  <key>NSPrivacyCollectedDataTypes</key>
  <array>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeEmailAddress</string>
      <key>NSPrivacyCollectedDataTypeLinked</key><true/>
      <key>NSPrivacyCollectedDataTypeTracking</key><false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypePhoneNumber</string>
      <key>NSPrivacyCollectedDataTypeLinked</key><true/>
      <key>NSPrivacyCollectedDataTypeTracking</key><false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeName</string>
      <key>NSPrivacyCollectedDataTypeLinked</key><true/>
      <key>NSPrivacyCollectedDataTypeTracking</key><false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypePreciseLocation</string>
      <key>NSPrivacyCollectedDataTypeLinked</key><true/>
      <key>NSPrivacyCollectedDataTypeTracking</key><false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypePhotosorVideos</string>
      <key>NSPrivacyCollectedDataTypeLinked</key><true/>
      <key>NSPrivacyCollectedDataTypeTracking</key><false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeAudioData</string>
      <key>NSPrivacyCollectedDataTypeLinked</key><true/>
      <key>NSPrivacyCollectedDataTypeTracking</key><false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeUserContent</string>
      <key>NSPrivacyCollectedDataTypeLinked</key><true/>
      <key>NSPrivacyCollectedDataTypeTracking</key><false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypePurchaseHistory</string>
      <key>NSPrivacyCollectedDataTypeLinked</key><true/>
      <key>NSPrivacyCollectedDataTypeTracking</key><false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array><string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array>
    </dict>
  </array>

  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>CA92.1</string></array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>C617.1</string></array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryDiskSpace</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>E174.1</string></array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategorySystemBootTime</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>35F9.1</string></array>
    </dict>
  </array>
</dict>
</plist>
XCPRIVACY
echo "  · $MANIFEST"

say "Done"
cat <<'NEXT'

The privacy manifest must be added to the Xcode target manually, once:

  1. npx cap open ios
  2. In the left sidebar, select the App project, then the App target
  3. Build Phases -> Copy Bundle Resources -> "+" -> add PrivacyInfo.xcprivacy

Then set your signing team under Signing & Capabilities, and add the
Push Notifications capability while you are there.

NEXT
