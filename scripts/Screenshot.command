#!/bin/bash
# ------------------------------------------------------------------------------------------
#  Screenshot.command  —  double-click to take screenshots of the page open in the
#  screenshot Chrome window. It asks two questions and does the rest.
#
#    What to capture?   Full page / carousels card by card / both
#    Which widths?      e.g. 1440   or   1440,1024,768,375   or   desktop, tablet, mobile
#
#  For carousels it looks at the page, lists the carousels, sliders and tabbed sections it
#  finds, and asks which ones to capture. Works on any page.
#
#  Results open in Finder when it finishes:  screenshots/<date_time>/<width>w/…@2x.png
#  Drag the files into Figma; the @2x in the name places them at true size, sharp.
#
#  Run Setup.command once before the first use.
#  Advanced options (1x scale, longer waits, crop to the active card) are available by typing  a
#  at the first question. If a carousel isn't found, type  m  when asked which ones, and enter
#  its selectors yourself (Claude can find them for you).
# ------------------------------------------------------------------------------------------

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

PORT=9222
PROFILE="$HOME/.chrome-screenshot-profile"
CHROME_FLAGS=(--remote-debugging-port=$PORT --user-data-dir="$PROFILE" --disable-backgrounding-occluded-windows --disable-renderer-backgrounding)

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
finish() { echo; read -n 1 -s -r -p "Press any key to close this window."; echo; exit "${1:-0}"; }

echo
bold "Page screenshots"
echo

# --- Preconditions -------------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ ! -d node_modules/playwright-core ] || [ ! -d node_modules/pngjs ]; then
  echo "Setup hasn't been run in this folder yet. Double-click  Setup.command  first, then come back."
  finish 1
fi

if ! curl -s --max-time 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "The screenshot Chrome window isn't open."
  read -r -p "Open it now? [Y/n] " yn
  case "$yn" in
    [nN]*) echo "Run Setup.command or open it later, then try again."; finish 1 ;;
  esac
  open -na "Google Chrome" --args "${CHROME_FLAGS[@]}"
  sleep 2
  echo
  echo "In the Chrome window that just opened, go to the page you want and sign in if asked."
  read -r -p "When the page is showing, press Enter to continue… " _
  if ! curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "Still can't reach that Chrome window. Quit all 'screenshot' Chrome windows (Cmd+Q) and try again."
    finish 1
  fi
fi
echo "✓ Screenshot Chrome is open — the page currently showing there will be captured."
echo

# --- Question 1: what -----------------------------------------------------------------------
echo "What do you want to capture?"
echo "  1) The full page                       (default)"
echo "  2) Carousels on the page, card by card    (I'll find them for you)"
echo "  3) Both"
read -r -p "Type 1, 2 or 3 (or  a  for advanced options): " what
what="${what:-1}"

ADVANCED=0
case "$what" in
  a|A) ADVANCED=1; read -r -p "Capture: 1) full page  2) carousels  3) both  [1]: " what; what="${what:-1}" ;;
esac
case "$what" in 1|2|3) ;; *) echo "Please type 1, 2 or 3."; finish 1 ;; esac

# --- Question 2: widths ---------------------------------------------------------------------
echo
echo "Which viewport widths? Numbers separated by commas, or words: desktop, laptop, tablet, mobile."
read -r -p "Widths [1440]: " widths_in
widths_in="${widths_in:-1440}"

WIDTHS=""
IFS=',' read -ra parts <<< "$(echo "$widths_in" | tr ' ' ',')"
for p in "${parts[@]}"; do
  p="$(echo "$p" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [ -z "$p" ] && continue
  case "$p" in
    desktop|xl|xlarge) w=1440 ;;
    laptop|l|large) w=1024 ;;
    tablet|m|medium) w=768 ;;
    mobile|phone|s|small) w=375 ;;
    *[!0-9]*) echo "Didn't understand '$p'. Use numbers like 1440 or words like desktop, tablet, mobile."; finish 1 ;;
    *) w=$p ;;
  esac
  WIDTHS="${WIDTHS:+$WIDTHS,}$w"
done
[ -z "$WIDTHS" ] && WIDTHS=1440

# --- Advanced (optional) --------------------------------------------------------------------
EXTRA_FULL=()
EXTRA_CAR=()
CARD_ONLY=0
if [ "$ADVANCED" = 1 ]; then
  echo
  bold "Advanced options (press Enter to keep the default)"
  read -r -p "Scale factor — 2 = retina, 1 = standard [2]: " scale; scale="${scale:-2}"
  EXTRA_FULL+=(--scale "$scale"); EXTRA_CAR+=(--scale "$scale")
  if [ "$what" != 2 ]; then
    read -r -p "Full page: wait after the viewport grows, in ms [700]: " settle; EXTRA_FULL+=(--settle "${settle:-700}")
    read -r -p "Full page: also save the single stitched image? [Y/n] " sf; case "$sf" in [nN]*) EXTRA_FULL+=(--no-full) ;; esac
  fi
  if [ "$what" != 1 ]; then
    read -r -p "Carousel: crop to the active card only (no neighbours peeking in)? [y/N] " co; case "$co" in [yY]*) CARD_ONLY=1 ;; esac
    read -r -p "Carousel: wait after each click, in ms [1300]: " cs; EXTRA_CAR+=(--settle "${cs:-1300}")
  fi
fi

# --- Carousels: find them and ask which ones ------------------------------------------------
# Parallel arrays, one entry per carousel (bash 3.2 on macOS has no associative arrays).
C_KIND=(); C_SEC=(); C_CTL=(); C_PREV=(); C_COUNT=(); C_CARD=(); C_LABEL=()
add_carousel() { C_KIND+=("$1"); C_SEC+=("$2"); C_CTL+=("$3"); C_PREV+=("$4"); C_COUNT+=("$5"); C_CARD+=("$6"); C_LABEL+=("$7"); }

manual_carousel() {
  echo
  echo "Enter the carousel's selectors (right-click the carousel → Inspect, or ask Claude to find them)."
  read -r -p "Section that wraps the carousel, e.g. section.my-slider: " m_sec
  [ -z "$m_sec" ] && return 1
  read -r -p "Clickable dots/tabs, one per card, e.g. .dots button (leave empty if it only has arrows): " m_tabs
  if [ -n "$m_tabs" ]; then
    add_carousel tabs "$m_sec" "$m_tabs" - - - "$m_sec"
  else
    read -r -p "The 'next' arrow, e.g. .slider-next: " m_next
    [ -z "$m_next" ] && return 1
    read -r -p "The 'previous' arrow (optional, used to rewind to the first card): " m_prev
    add_carousel next "$m_sec" "$m_next" "${m_prev:--}" - - "$m_sec"
  fi
}

if [ "$what" != 1 ]; then
  echo
  echo "Looking for carousels on the page…"
  DETECT_OUT="$(node carousel.js --current --detect 2>&1)"
  FOUND=()
  while IFS=$'\t' read -r tag kind sec ctl prev cnt card label; do
    [ "$tag" = CAROUSEL ] || continue
    FOUND+=("$kind"$'\t'"$sec"$'\t'"$ctl"$'\t'"$prev"$'\t'"$cnt"$'\t'"$card"$'\t'"$label")
  done <<< "$DETECT_OUT"

  if [ "${#FOUND[@]}" -eq 0 ]; then
    echo "$DETECT_OUT" | grep -v '^CAROUSEL' | sed 's/^/  /'
    echo "No carousels found on this page."
    read -r -p "Enter its selectors yourself? [y/N] " yn
    case "$yn" in [yY]*) manual_carousel ;; esac
  else
    echo "Found ${#FOUND[@]}:"
    i=0
    for f in "${FOUND[@]}"; do
      i=$((i + 1))
      IFS=$'\t' read -r kind sec ctl prev cnt card label <<< "$f"
      if [ "$kind" = tabs ]; then how="$cnt cards"
      elif [ "$cnt" != - ]; then how="arrows, about $cnt cards"
      else how="arrows"; fi
      printf '  %d) %s  — %s   (%s)\n' "$i" "$label" "$how" "$sec"
    done
    if [ "${#FOUND[@]}" -eq 1 ]; then
      read -r -p "Capture it? Enter = yes, n = skip, m = enter selectors yourself: " pick
      case "$pick" in [nN]*) pick=none ;; [mM]*) ;; *) pick=all ;; esac
    else
      read -r -p "Which ones? Numbers separated by commas, all, or m to enter selectors yourself [all]: " pick
      pick="${pick:-all}"
    fi
    case "$pick" in
      none) ;;
      m|M) manual_carousel ;;
      *)
        i=0
        for f in "${FOUND[@]}"; do
          i=$((i + 1))
          if [ "$pick" = all ] || [[ ",$(echo "$pick" | tr -d ' ')," == *",$i,"* ]]; then
            IFS=$'\t' read -r kind sec ctl prev cnt card label <<< "$f"
            add_carousel "$kind" "$sec" "$ctl" "$prev" "$cnt" "$card" "$label"
          fi
        done ;;
    esac
  fi

  if [ "${#C_SEC[@]}" -eq 0 ]; then
    if [ "$what" = 2 ]; then echo "No carousel selected, nothing to capture."; finish 1; fi
    echo "No carousel selected; capturing the full page only."
    what=1
  fi
fi

# --- Run ------------------------------------------------------------------------------------
RUN="$(date +%Y-%m-%d_%H-%M-%S)"
echo
bold "Capturing at ${WIDTHS//,/, } px → screenshots/$RUN/"
echo "Keep the screenshot Chrome window open and un-minimised while this runs."
echo

STATUS=0
if [ "$what" = 1 ] || [ "$what" = 3 ]; then
  bold "Full page"
  node screenshot.js --current --width "$WIDTHS" --run-name "$RUN" "${EXTRA_FULL[@]}" || STATUS=1
  echo
fi
if [ "$what" = 2 ] || [ "$what" = 3 ]; then
  USED_LABELS=","
  for ((k = 0; k < ${#C_SEC[@]}; k++)); do
    label="${C_LABEL[$k]}"
    # Two carousels with the same name would overwrite each other's files: number the repeat.
    case "$USED_LABELS" in *",$label,"*) label="$label $((k + 1))" ;; esac
    USED_LABELS="$USED_LABELS$label,"
    bold "Carousel: $label"
    ARGS=(--current --width "$WIDTHS" --run-name "$RUN" --section "${C_SEC[$k]}" --label "$label")
    if [ "${C_KIND[$k]}" = tabs ]; then
      ARGS+=(--tabs "${C_CTL[$k]}")
    else
      ARGS+=(--next "${C_CTL[$k]}")
      [ "${C_PREV[$k]}" != - ] && ARGS+=(--prev "${C_PREV[$k]}")
    fi
    if [ "$CARD_ONLY" = 1 ]; then
      ARGS+=(--card-only)
      [ "${C_CARD[$k]}" != - ] && ARGS+=(--card "${C_CARD[$k]}")
    fi
    node carousel.js "${ARGS[@]}" "${EXTRA_CAR[@]}" || STATUS=1
    echo
  done
fi

# --- Wrap up ---------------------------------------------------------------------------------
if [ -d "screenshots/$RUN" ]; then
  COUNT=$(find "screenshots/$RUN" -name '*.png' | wc -l | tr -d ' ')
  bold "Done — $COUNT image(s) in screenshots/$RUN/"
  echo "In Figma: drag the part…@2x.png files in together, select them, Shift+A, vertical, gap 0."
  echo "(Don't place the _full image in Figma — it's over 4096 px tall and Figma will blur it.)"
  open "screenshots/$RUN"
else
  echo "Nothing was saved."
  STATUS=1
fi

if [ "$STATUS" != 0 ]; then
  echo
  bold "Something went wrong. Common fixes:"
  echo "  • 'Couldn't find a visible tab'  → make the page the visible tab in the screenshot Chrome window."
  echo "  • 'Redirected to … sign in'      → sign in on that page in the screenshot Chrome window, then run again."
  echo "  • 'locator.click: Timeout'       → keep the screenshot Chrome window in front, not minimised, then run again."
  echo "  • 'no element matches'           → that carousel isn't on the page at that width (common on mobile); the other widths are fine."
  echo "  • Anything else                  → copy this window's text and send it to Claude with the guide (page-screenshots-prompt.md)."
fi
finish $STATUS
