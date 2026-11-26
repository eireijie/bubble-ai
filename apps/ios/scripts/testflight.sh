#!/bin/bash
# Archive Bubble AI for iPhone and upload it to TestFlight. See docs/signing.md.
#   apps/ios/scripts/testflight.sh                      # signs and uploads with the account in Xcode → Settings → Accounts
#   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=~/private_keys/AuthKey_….p8 apps/ios/scripts/testflight.sh   # or with an App Store Connect API key
# APPLE_TEAM_ID defaults to YuVi LLC. BUILD_NUMBER has to go up with each upload; it defaults to the time.
# UPLOAD=0 stops after exporting the .ipa (left in apps/ios/build/testflight).
set -euo pipefail
cd "$(dirname "$0")/.."
team="${APPLE_TEAM_ID:-388D9S7Y7P}"
build="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
out="build/testflight"
rm -rf "$out"; mkdir -p "$out"

auth=(-allowProvisioningUpdates)
if [[ -n "${ASC_KEY_ID:-}" ]]; then
  : "${ASC_ISSUER_ID:?}" "${ASC_KEY_PATH:?}"
  auth+=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

xcodebuild archive -project Wisp.xcodeproj -scheme Wisp -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$out/Wisp.xcarchive" DEVELOPMENT_TEAM="$team" CURRENT_PROJECT_VERSION="$build" "${auth[@]}"

cat > "$out/export.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$team</string>
  <key>destination</key><string>$([[ "${UPLOAD:-1}" == 0 ]] && echo export || echo upload)</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive -archivePath "$out/Wisp.xcarchive" -exportPath "$out/export" -exportOptionsPlist "$out/export.plist" "${auth[@]}"
echo "Bubble AI $(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$out/Wisp.xcarchive/Products/Applications/Wisp.app/Info.plist") ($build) done"
