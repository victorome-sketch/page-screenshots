#!/bin/bash
# ------------------------------------------------------------------------------------------
#  Setup.command  —  double-click this ONCE to get ready for taking screenshots.
#
#  What it does:
#    1. Checks that Node.js is installed (opens the download page if it isn't).
#    2. Installs the two small packages the scripts need (playwright-core, pngjs).
#    3. Opens a separate "screenshot" Chrome window. It has its own profile, so your
#       everyday Chrome is untouched. You sign in to the site there once; it stays signed in.
#
#  Afterwards: open the page you want in that Chrome window, then double-click Screenshot.command.
# ------------------------------------------------------------------------------------------

cd "$(dirname "$0")" || exit 1

# Make sure common Node install locations are on the PATH even when launched by double-click.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

PORT=9222
PROFILE="$HOME/.chrome-screenshot-profile"
CHROME_FLAGS=(--remote-debugging-port=$PORT --user-data-dir="$PROFILE" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding)

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
finish() { echo; read -n 1 -s -r -p "Press any key to close this window."; echo; exit "${1:-0}"; }

echo
bold "Screenshot setup"
echo "Folder: $(pwd)"
echo

# 1. Node ---------------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed on this Mac. It is a free, one-time install."
  echo "Opening the download page — pick the macOS installer (LTS), install it, then double-click Setup.command again."
  open "https://nodejs.org/en/download"
  finish 1
fi
echo "✓ Node.js $(node -v) found"

# 2. Packages ------------------------------------------------------------------------------
if [ ! -d node_modules/playwright-core ] || [ ! -d node_modules/pngjs ]; then
  echo "Installing the two packages the scripts need (takes a few seconds)…"
  # A package.json here pins the install to this folder. Without it, npm climbs to the nearest
  # parent that has one (e.g. your home folder) and installs there instead.
  [ -f package.json ] || echo '{ "name": "page-screenshots", "private": true }' > package.json
  if ! npm install --prefix "$(pwd)" --no-fund --no-audit --silent playwright-core pngjs; then
    echo "✗ The install failed. Check your internet connection and try again."
    finish 1
  fi
  if [ ! -d node_modules/playwright-core ] || [ ! -d node_modules/pngjs ]; then
    echo "✗ npm finished but the packages aren't in this folder. Copy this window's text and send it to Claude."
    finish 1
  fi
fi
echo "✓ Packages installed"

# Make sure the other launcher is double-clickable (permissions get lost when files are shared).
chmod +x Screenshot.command 2>/dev/null && echo "✓ Screenshot.command is ready to double-click"

# 3. Screenshot Chrome ---------------------------------------------------------------------
if curl -s --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "✓ The screenshot Chrome window is already open"
elif [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  echo "✗ Google Chrome is not installed. Install it from https://www.google.com/chrome/ and run Setup again."
  finish 1
else
  echo "Opening the screenshot Chrome window…"
  open -na "Google Chrome" --args "${CHROME_FLAGS[@]}"
  sleep 2
  echo "✓ Opened. It is a separate Chrome with its own profile; your normal Chrome is untouched."
fi

echo
bold "Setup done. Next:"
echo "  1. In the Chrome window that just opened, go to the page you want to capture and sign in."
echo "  2. Leave that page showing, then double-click  Screenshot.command  in this folder."
finish 0
