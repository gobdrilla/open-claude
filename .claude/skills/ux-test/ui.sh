#!/usr/bin/env bash
# UI driver for the ux-test skill (Linux, X11 or XWayland via GDK_BACKEND=x11). Needs xdotool and ImageMagick.
#   shot <file.png>               screenshot of the window
#   keys <key...>                 xdotool key names, e.g. ctrl+1 alt+2 F1 Escape ctrl+shift+e
#   click|rclick|hover <x> <y>    pixel position inside the last screenshot
#   size <w> <h>                  window size in pixels
set -euo pipefail
id=$(xdotool search --onlyvisible --name "L'Atelier de Claude" | head -1 || true)
[ -n "$id" ] || { echo "Atelier window not found (on Wayland start the app with GDK_BACKEND=x11)" >&2; exit 1; }
xdotool windowactivate --sync "$id" 2>/dev/null || xdotool windowfocus --sync "$id"
sleep 0.25
case "$1" in
  shot) import -window "$id" "$2" && echo "$2 ($(xdotool getwindowgeometry "$id" | sed -n 's/.*Geometry: //p'))" ;;
  keys) shift; xdotool key --clearmodifiers "$@" ;;
  click) xdotool mousemove --window "$id" "$2" "$3" click 1 ;;
  rclick) xdotool mousemove --window "$id" "$2" "$3" click 3 ;;
  hover) xdotool mousemove --window "$id" "$2" "$3" ;;
  size) xdotool windowsize "$id" "$2" "$3" ;;
  *) echo "unknown command $1" >&2; exit 2 ;;
esac
sleep 0.4
