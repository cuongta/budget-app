#!/bin/sh
# Install (or update) budget-app into /Applications.
#
# Downloads the .dmg from the latest GitHub release with curl. Unlike a
# browser, curl doesn't add the com.apple.quarantine flag, so macOS opens the
# unsigned app without needing `xattr -d com.apple.quarantine`.
#
# Usage:
#   ./install.sh                    latest GitHub release
#   ./install.sh path/to/app.dmg    a local .dmg (e.g. from `make release`)
#
# A public repo needs no token. If the repo is private, set GITHUB_TOKEN, or log
# in once with `gh auth login` and the token is picked up from gh.
#
# Env:
#   GITHUB_TOKEN   token with read access to the repo (private repos only)
#   INSTALL_DIR    where to put the app (default: /Applications)

set -eu

REPO="cuongta/budget-app"
APP="budget-app.app"
INSTALL_DIR="${INSTALL_DIR:-/Applications}"

tmp=$(mktemp -d)
mnt="$tmp/mnt"
cleanup() {
  hdiutil detach "$mnt" -quiet 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

# --- 1. get the .dmg -------------------------------------------------------

if [ $# -ge 1 ]; then
  dmg="$1"
  [ -f "$dmg" ] || { echo "No such file: $dmg" >&2; exit 1; }
else
  token="${GITHUB_TOKEN:-}"
  if [ -z "$token" ] && command -v gh >/dev/null 2>&1; then
    token=$(gh auth token 2>/dev/null || true)
  fi
  # curl with the token (if any) and GitHub API headers
  gh_curl() {
    if [ -n "$token" ]; then
      curl -fsSL -H "Authorization: Bearer $token" "$@"
    else
      curl -fsSL "$@"
    fi
  }

  release="$tmp/release.json"
  if ! gh_curl -H "Accept: application/vnd.github+json" \
    -o "$release" "https://api.github.com/repos/$REPO/releases/latest"; then
    echo "Couldn't read the latest release of $REPO." >&2
    [ -z "$token" ] && echo "If the repo is private, set GITHUB_TOKEN or run 'gh auth login'." >&2
    exit 1
  fi

  # read a value from the release JSON (plutil ships with macOS and reads JSON)
  json() { plutil -extract "$1" raw -o - "$release" 2>/dev/null; }

  # find the first .dmg asset
  i=0
  asset_url=""
  while name=$(json "assets.$i.name"); do
    case "$name" in
      *.dmg)
        asset_url=$(json "assets.$i.url")
        break
        ;;
    esac
    i=$((i + 1))
  done
  [ -n "$asset_url" ] || { echo "No .dmg in the latest release." >&2; exit 1; }

  echo "Downloading $name ($(json tag_name))"
  dmg="$tmp/app.dmg"
  # the API asset URL works for private repos; octet-stream asks for the file itself
  gh_curl -H "Accept: application/octet-stream" --progress-bar -o "$dmg" "$asset_url"
fi

# --- 2. copy the app out of the .dmg ---------------------------------------

hdiutil attach "$dmg" -nobrowse -readonly -quiet -mountpoint "$mnt"
[ -d "$mnt/$APP" ] || { echo "$APP not found in the .dmg" >&2; exit 1; }

# only the installed copy matters (a `make dev` build can keep running)
if pgrep -qf "$INSTALL_DIR/$APP/Contents/MacOS/"; then
  echo "Quit budget-app first, then run this again." >&2
  exit 1
fi

rm -rf "${INSTALL_DIR:?}/$APP"
cp -R "$mnt/$APP" "$INSTALL_DIR/"

# a local .dmg may have been downloaded with a browser: clear the flag just in case
xattr -dr com.apple.quarantine "$INSTALL_DIR/$APP" 2>/dev/null || true

echo "Installed $INSTALL_DIR/$APP"
