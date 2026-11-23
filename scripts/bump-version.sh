#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT/VERSION"
INFO_PLIST="$ROOT/macos/Info.plist"
PKG_JSON="$ROOT/web/package.json"
README_FILE="$ROOT/README.md"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <patch|minor|major|X.Y.Z>" >&2
  exit 1
fi

ARG="$1"
CUR="$(tr -d '[:space:]' < "$VERSION_FILE")"
IFS='.' read -r MAJ MIN PAT <<< "$CUR"

case "$ARG" in
  patch) NEXT="${MAJ}.${MIN}.$((PAT + 1))" ;;
  minor) NEXT="${MAJ}.$((MIN + 1)).0" ;;
  major) NEXT="$((MAJ + 1)).0.0" ;;
  *)
    if [[ ! "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "Invalid version: $ARG (expected patch, minor, major, or X.Y.Z)" >&2
      exit 1
    fi
    NEXT="$ARG"
    ;;
esac

printf '%s\n' "$NEXT" > "$VERSION_FILE"

python3 - "$INFO_PLIST" "$PKG_JSON" "$README_FILE" "$NEXT" <<'PY'
import json, plistlib, re, sys
info_path, pkg_path, readme_path, next_ver = sys.argv[1:5]

with open(info_path, "rb") as f:
    plist = plistlib.load(f)
plist["CFBundleShortVersionString"] = next_ver
cur_build = int(str(plist.get("CFBundleVersion", "1")))
plist["CFBundleVersion"] = str(cur_build + 1)
with open(info_path, "wb") as f:
    plistlib.dump(plist, f, sort_keys=False)

with open(pkg_path, "r", encoding="utf-8") as f:
    pkg = json.load(f)
pkg["version"] = next_ver
with open(pkg_path, "w", encoding="utf-8") as f:
    json.dump(pkg, f, ensure_ascii=False, indent=2)
    f.write("\n")

with open(readme_path, "r", encoding="utf-8") as f:
    readme = f.read()
readme = re.sub(r"^# 엠디 \(emdi\) v[0-9]+\.[0-9]+\.[0-9]+", f"# 엠디 (emdi) v{next_ver}", readme, count=1, flags=re.M)
with open(readme_path, "w", encoding="utf-8") as f:
    f.write(readme)

print(f"Bumped version -> v{next_ver} (build {cur_build + 1})")
PY
