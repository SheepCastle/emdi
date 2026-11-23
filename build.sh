#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="엠디.app"
BUILD_DIR="$ROOT/build"
APP_BUNDLE="$BUILD_DIR/$APP_NAME"
INSTALL_PATH="/Applications/$APP_NAME"

echo "1) Building web editor bundle..."
cd "$ROOT/web"
npm run build

echo "2) Creating app bundle structure..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

echo "3) Compiling Swift macOS shell..."
SWIFT_SOURCES=(
  "$ROOT/macos/FileResolver.swift"
  "$ROOT/macos/UpdateManager.swift"
  "$ROOT/macos/main.swift"
)
if [ "${EMDI_UNIVERSAL:-0}" = "1" ]; then
  echo "   (building Universal binary: arm64 + x86_64)"
  swiftc -O -target arm64-apple-macos13.0 \
    -framework AppKit \
    -framework WebKit \
    -framework UniformTypeIdentifiers \
    "${SWIFT_SOURCES[@]}" \
    -o "$BUILD_DIR/emdi-arm64"
  swiftc -O -target x86_64-apple-macos13.0 \
    -framework AppKit \
    -framework WebKit \
    -framework UniformTypeIdentifiers \
    "${SWIFT_SOURCES[@]}" \
    -o "$BUILD_DIR/emdi-x86_64"
  lipo -create "$BUILD_DIR/emdi-arm64" "$BUILD_DIR/emdi-x86_64" \
    -output "$APP_BUNDLE/Contents/MacOS/emdi"
  rm -f "$BUILD_DIR/emdi-arm64" "$BUILD_DIR/emdi-x86_64"
else
  swiftc -O \
    -framework AppKit \
    -framework WebKit \
    -framework UniformTypeIdentifiers \
    "${SWIFT_SOURCES[@]}" \
    -o "$APP_BUNDLE/Contents/MacOS/emdi"
fi

echo "4) Generating AppIcon.icns..."
ICONSET="$BUILD_DIR/AppIcon.iconset"
swift "$ROOT/macos/make_icon.swift" "$ICONSET"
iconutil -c icns "$ICONSET" -o "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

echo "5) Copying Info.plist, CHANGELOG, and web bundle..."
cp "$ROOT/macos/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
cp "$ROOT/CHANGELOG.md" "$APP_BUNDLE/Contents/Resources/CHANGELOG.md"
rm -rf "$APP_BUNDLE/Contents/Resources/web"
mkdir -p "$APP_BUNDLE/Contents/Resources/web"
cp -R "$ROOT/web/dist/." "$APP_BUNDLE/Contents/Resources/web/"

echo "6) Ad-hoc signing and installing to $INSTALL_PATH..."
codesign --force --deep --sign - "$APP_BUNDLE"
rm -rf "$INSTALL_PATH"
cp -R "$APP_BUNDLE" "$INSTALL_PATH"

echo "Done: $INSTALL_PATH"
