#!/bin/bash
# Mac track (independent of the web version): bump MARKETING_VERSION / CURRENT_PROJECT_VERSION in the Xcode project first.
# TEMPORARY distribution: universal Release build, ad-hoc signed (no Developer ID / notarization), packed into a dmg.
# Users open it with right-click -> Open (or: xattr -dr com.apple.quarantine "/Applications/AI ONE STUDIO.app").
# Publish (never as "latest" - the Windows updater reads the latest release's latest.json):
#   gh release create mac-vX.Y.Z build/AI-ONE-STUDIO_X.Y.Z_macOS.dmg --latest=false --title "AI ONE STUDIO macOS X.Y.Z" --notes-file <notes> --repo designloves2/AI-ONE-STUDIO
set -euo pipefail
cd "$(dirname "$0")/../.."
V=$(sed -n 's/.*MARKETING_VERSION = \([^;]*\);.*/\1/p' macos/AIOneStudio.xcodeproj/project.pbxproj | head -1)
rm -rf build/mac && mkdir -p build/mac
xcodebuild -project macos/AIOneStudio.xcodeproj -scheme AIOneStudio -configuration Release \
  -derivedDataPath build/mac ARCHS="arm64 x86_64" ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="" build
APP="build/mac/Build/Products/Release/AI ONE STUDIO.app"
codesign --force --deep --sign - --options runtime --entitlements macos/AIOneStudio/AIOneStudio.entitlements "$APP"
STAGE=build/mac/dmg; rm -rf "$STAGE"; mkdir -p "$STAGE"; cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
OUT="build/AI-ONE-STUDIO_${V}_macOS.dmg"; rm -f build/*.dmg
hdiutil create -volname "AI ONE STUDIO" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
echo "$OUT"; lipo -archs "$APP/Contents/MacOS/AI ONE STUDIO"
