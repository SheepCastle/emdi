#!/usr/bin/env bash
set -euo pipefail

REPO="SheepCastle/emdi"
APP_NAME="엠디.app"
DEST_APP="/Applications/${APP_NAME}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Error: 엠디 (emdi) is currently a native macOS app (macOS 13+)." >&2
  exit 1
fi

echo "==> Checking latest release of 엠디 (emdi)..."
RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")"

DOWNLOAD_URL="$(python3 -c '
import json, sys
data = json.loads(sys.stdin.read())
for asset in data.get("assets", []):
    name = asset.get("name", "")
    if name.endswith("-macos.zip"):
        print(asset["browser_download_url"])
        break
' <<< "$RELEASE_JSON")"

TAG_NAME="$(python3 -c '
import json, sys
data = json.loads(sys.stdin.read())
print(data.get("tag_name", "latest"))
' <<< "$RELEASE_JSON")"

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Error: Could not find macOS release archive in latest GitHub release." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ZIP_FILE="${TMP_DIR}/emdi-macos.zip"
echo "==> Downloading 엠디 ${TAG_NAME}..."
curl -fL --progress-bar "$DOWNLOAD_URL" -o "$ZIP_FILE"

echo "==> Extracting ${APP_NAME}..."
ditto -x -k "$ZIP_FILE" "$TMP_DIR/extracted"

SRC_APP="${TMP_DIR}/extracted/${APP_NAME}"
if [ ! -d "$SRC_APP" ]; then
  SRC_APP="$(find "$TMP_DIR/extracted" -maxdepth 2 -name "*.app" | head -n 1)"
fi

if [ -z "$SRC_APP" ] || [ ! -d "$SRC_APP" ]; then
  echo "Error: ${APP_NAME} not found inside archive." >&2
  exit 1
fi

# Close running instance if any
if pgrep -x "emdi" >/dev/null 2>&1; then
  echo "==> Closing running 엠디..."
  osascript -e 'tell application "엠디" to quit' >/dev/null 2>&1 || true
  sleep 1
fi

echo "==> Installing to ${DEST_APP}..."
if [ -w "/Applications" ]; then
  rm -rf "$DEST_APP"
  ditto "$SRC_APP" "$DEST_APP"
else
  sudo rm -rf "$DEST_APP"
  sudo ditto "$SRC_APP" "$DEST_APP"
fi

echo "==> Registering with macOS LaunchServices..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST_APP" >/dev/null 2>&1 || true

echo ""
echo "Done! 엠디 ${TAG_NAME} is installed at ${DEST_APP}."
echo "Open it from Spotlight / Applications, or run: open -a 엠디"
