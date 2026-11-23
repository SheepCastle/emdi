#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <patch|minor|major|X.Y.Z|current> [notes-file]" >&2
  echo "  current: release the version currently in VERSION without bumping" >&2
  exit 1
fi

ARG="$1"
NOTES_FILE="${2:-}"

if [ "$ARG" != "current" ]; then
  "$ROOT/scripts/bump-version.sh" "$ARG"
fi

VER="$(tr -d '[:space:]' < "$ROOT/VERSION")"
TAG="v${VER}"
ZIP_NAME="emdi-${TAG}-macos.zip"
ZIP_PATH="$ROOT/build/$ZIP_NAME"

echo "==> [1/4] Building 엠디 ${TAG} (Universal if supported)..."
EMDI_UNIVERSAL=1 "$ROOT/build.sh"

echo "==> [2/4] Packaging release archive: $ZIP_NAME..."
rm -f "$ZIP_PATH"
ditto -c -k --sequesterRsrc --keepParent "$ROOT/build/엠디.app" "$ZIP_PATH"
ls -lh "$ZIP_PATH"

echo "==> [3/4] Committing, tagging (${TAG}), and pushing..."
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
  git commit -m "release: ${TAG}"
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag ${TAG} already exists; skipping tag creation."
else
  git tag -a "$TAG" -m "Release ${TAG}"
fi
git push origin main --tags

echo "==> [4/4] Publishing GitHub Release ${TAG} with ${ZIP_NAME}..."
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ZIP_PATH" --clobber
  echo "Updated asset on existing release ${TAG}."
else
  if [ -n "$NOTES_FILE" ] && [ -f "$NOTES_FILE" ]; then
    gh release create "$TAG" "$ZIP_PATH" --title "엠디 (emdi) ${TAG}" --notes-file "$NOTES_FILE"
  else
    gh release create "$TAG" "$ZIP_PATH" --title "엠디 (emdi) ${TAG}" --generate-notes
  fi
fi

echo "Done! Released 엠디 ${TAG} with ${ZIP_NAME}."
