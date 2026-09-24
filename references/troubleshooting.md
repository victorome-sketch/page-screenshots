# Troubleshooting

Match the symptom the person reports (or the terminal output they paste) and give the fix directly. Each of these has actually happened.

## Launchers (Setup.command / Screenshot.command)

| Symptom | Cause | Fix |
|---|---|---|
| Double-clicking does nothing, or "…could not be executed because you do not have appropriate access privileges" | The executable permission was stripped when the file was shared loose (Drive, Slack) | Right-click → Open once; or in Terminal `chmod +x ~/path/*.command`. `Setup.command` fixes `Screenshot.command` automatically. Share the folder as a zip to avoid it |
| "…cannot be opened because it is from an unidentified developer" | Gatekeeper on a downloaded file | Right-click → Open, then Open in the dialog. Only needed once |
| `Setup hasn't been run in this folder yet` | `node_modules` missing in that folder. If Setup *did* run and said "Packages installed", an older Setup let npm install into a parent folder with a `package.json` (usually the home folder: `~/node_modules`) | Copy the skill's current `Setup.command` into the folder (it writes a local `package.json` and verifies the install) and double-click it again. `~/node_modules` can stay; it's harmless |
| `Node.js is not installed on this Mac` | No Node | Install from the page Setup opens (macOS installer, LTS), rerun Setup |
| The screenshot Chrome opens but `Screenshot.command` says it still can't reach it | An older screenshot Chrome (without the debugging port) is still running, or another app uses port 9222 | Quit every Chrome window that uses the screenshot profile (Cmd+Q), run Setup again |
| The Terminal window closes immediately | It ran to the end (or failed) and the "press any key" was hit | Run it again and read the text before pressing a key; paste the text to Claude if unclear |

## Setup and environment (Terminal path)

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module '/Users/…/screenshot.js'` | Terminal is not in the connected folder | `cd` into the folder first. If the folder name has spaces, escape them: `cd ~/Projects/My\ Screenshots` |
| `Missing dependencies. In this folder run: npm install playwright-core pngjs` | `npm install` ran somewhere else (often the home folder) | Run the install *after* the `cd`, in the same Terminal |
| `No Chrome with remote debugging found on port 9222` | The debug Chrome isn't running | Run the `open -na "Google Chrome" --args …` line from the command block |
| The `open` command opens a tab in their normal Chrome instead of a new window | The debug profile is already running, or they dropped the `--user-data-dir` flag | Quit the debug Chrome (Cmd+Q in that window) and rerun the full line, flags included |
| Captured a sign-in page / `Redirected to …` a login URL | Not signed in inside the debug Chrome (it has its own profile) | Open the page in the debug Chrome window, sign in once, rerun |
| `zsh: no such file or directory: screenshots/…` | They pasted a folder diagram or explanatory text into the Terminal | Only the command lines go in Terminal; resend the block alone |

## Quality problems

| Symptom | Cause | Fix |
|---|---|---|
| Blurry in Figma | The tall `_full@2x.png` was placed (Figma downsamples anything over 4096 px) — or the file is 1x | Use the `part…@2x.png` slices. Check pixel width with `check_run.py`: it should be viewport × 2 |
| Files are 1x (1440 px wide instead of 2880) | Scale factor was reset — usually a script edit that added `setViewportSize` | Restore the skill's version of the script; the header comment explains the rule |
| Headings overlap / a section is collapsed / content missing in the full page | The page hadn't finished re-laying out when captured | Rerun with `--settle 1500` (or higher). If the terminal printed `note: page height changed…`, the page uses `vh` units and needs a per-site tweak — look at the page before promising a fix |
| A jump-link bar or floating button sits on top of the content | Sticky/fixed element not detected (unusual positioning) | For carousel captures the script hides sticky/fixed elements; if one slipped through, find its selector and hide it via a small script edit, or crop in Figma |
| Carousel card is mid-transition (half faded, two cards overlapping) | Slide animation slower than the wait | `--settle 2000` |
| Neighbouring cards peek into each carousel shot and that's unwanted | Default captures the section at full viewport width | `--card-only` (set `--card` to the active card's selector if it isn't `.card-active`) |
| Hero carousel/marquee shows a different frame each run | It's an infinite animation; the script pauses it wherever it is | Expected. If one exact frame matters, capture the section with carousel mode or crop in Figma |

## Carousel mode

| Symptom | Cause | Fix |
|---|---|---|
| `No carousels found on this page` | The carousel is built lazily, sits in an iframe, or uses markup detection doesn't know | Scroll the page once and rerun. Otherwise find the selectors (`finding-selectors.md`) and have them type `m` / `y` at the launcher prompt, or give the Terminal line. Iframes aren't supported: open the iframe's URL directly |
| The list shows something that isn't a carousel (a tabbed widget, a stepper) | Detection is deliberately broad: ARIA tabs and generic dots count | Tell them to pick only the numbers they want |
| A carousel is missing from the list, others are found | Its controls don't look like dots/tabs/arrows | Type `m` at "Which ones?" and enter the selectors |
| `came out identical to the one before` | The dots are decorative (not clickable, e.g. Swiper without `clickable`) | Use arrow mode: `m`, the section, leave dots empty, then the next/prev arrows |
| Arrow mode captured 30 cards | Loop detection didn't trigger (the visible content never repeated exactly, e.g. autoplay changing it) | `--max <n>` with the real card count |
| Arrow mode: `only one state found` | The next click did nothing (window covered, wrong selector) | Keep the Chrome window in front; check the `--next` selector |
| `locator.click: Timeout … performing click action` | Chrome stops acknowledging mouse input while its window is covered or minimised | Relaunch the debug Chrome with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding` (in the standard launch line) and keep the window un-minimised. The script also brings it to the front and falls back to direct events |
| `card N did not respond to the click` | The component ignores both real and synthetic clicks in that state, or the wrong `--tabs` selector | Confirm the selectors with a real click in the browser tools (see `finding-selectors.md`); check the tab isn't disabled at that viewport |
| `no element matches --section` / `--tabs` | Selector typo, or the section renders differently at that viewport (e.g. becomes an accordion on mobile) | Inspect at that width; some components need a different selector per breakpoint, or don't exist as a carousel on mobile at all — say so |
| Only two states captured | `--tabs` points at next/previous arrows | Point it at the per-card controls (dots, tabs, thumbnails) |
| Cards captured but all show the first slide | Clicks landed but the transition hadn't started, or the tablist scrolls and the click hit the wrong spot | Increase `--settle`; confirm `aria-selected` moves in the browser tools |

## Reading terminal output

A healthy run looks like:

```
Saving to screenshots/2026-09-17_14-23-56/
→ https://…/about/  (using open tab)

1440px viewport → screenshots/2026-09-17_14-23-56/1440w/
  6 cards: alex, sam, priya, jordan, lee, maria
  saved 1440w/about_meet-the-team_1440w_card1of6_alex@2x.png
  …
```

For full-page runs the last line reports `1440×13878 css px @2x → 2880px wide, 41.2 MB total`. Anything other than `2880px wide` for a 1440 viewport at 2x means the scale factor didn't take.
