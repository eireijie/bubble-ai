#!/bin/bash
# Each agent's own screen on the shared computer: a virtual display of its own (:10 and up) with the
# same desktop and dock, a VNC server for it (port 5900 + display, inside the VM only) and a Chrome
# profile of its own (debugging port 9300 + display), so agents work side by side instead of taking
# turns on one screen. Bubble AI starts a screen when an agent first needs it and stops it when it
# has been left alone for a while; the agent's browser profile (its sign-ins) stays in the home folder.
#
#   wisp-screen up <agent>            start it if needed; prints DISPLAY=… VNC_PORT=… CDP_PORT=… PROFILE=…
#   wisp-screen down <agent> [force]  stop it (without force: not while its browser tools are connected)
#   wisp-screen list                  "<agent> <display>" for each screen that is up
#
# Background processes get /dev/null for every stream, so `docker exec` (and `$(wisp-screen up …)`)
# return as soon as the screen is up.
set -e
DIR=/tmp/wisp-screens
mkdir -p "$DIR"
RES="${RESOLUTION:-1280x800}"
SHARED_PROFILE="$HOME/.config/wisp-browser"
AGENTS_PROFILES="$HOME/.config/wisp-browser-agents"

slug() { printf '%s' "$1" | tr -cd 'A-Za-z0-9_-' | cut -c1-64; }
# a process that is running (a zombie, which nobody reaps in here, doesn't count)
live() { [ -n "$1" ] && s=$(ps -o stat= -p "$1" 2>/dev/null) && [ -n "$s" ] && [ "${s#Z}" = "$s" ]; }
pidof_file() { cat "$DIR/$1" 2>/dev/null || true; }
info() { echo "DISPLAY=:$1 VNC_PORT=$(($1 + 5900)) CDP_PORT=$(($1 + 9300)) PROFILE=$AGENTS_PROFILES/$2"; }

stop_display() {
  n=$1
  for f in vnc session x; do
    p=$(pidof_file "$n.$f")
    [ -n "$p" ] && kill "$p" 2>/dev/null || true
  done
  # its Chrome and anything else still drawing on it
  pkill -f -- "--remote-debugging-port=$((n + 9300))" 2>/dev/null || true
  sleep 0.3
  p=$(pidof_file "$n.x")
  [ -n "$p" ] && kill -9 "$p" 2>/dev/null || true
  rm -f "$DIR/$n.vnc" "$DIR/$n.session" "$DIR/$n.x" "/tmp/.X$n-lock" "/tmp/.X11-unix/X$n"
}

cmd="$1"
agent=$(slug "$2")
case "$cmd" in
  up)
    [ -n "$agent" ] || { echo "usage: wisp-screen up <agent>" >&2; exit 2; }
    exec 9>"$DIR/.lock"
    flock 9
    n=$(cat "$DIR/agent-$agent" 2>/dev/null || true)
    if [ -n "$n" ]; then
      if live "$(pidof_file "$n.x")" && live "$(pidof_file "$n.vnc")"; then info "$n" "$agent"; exit 0; fi
      stop_display "$n"
      rm -f "$DIR/agent-$agent"
    fi
    # the lowest display no other agent (or anything else) has
    n=10
    while [ -e "/tmp/.X11-unix/X$n" ] || [ -e "/tmp/.X$n-lock" ] || grep -qx "$n" "$DIR"/agent-* 2>/dev/null; do
      n=$((n + 1))
      [ "$n" -le 99 ] || { echo "too many screens on this computer" >&2; exit 1; }
    done
    # its own browser profile, starting from the shared one the first time (so sign-ins made
    # before agents had screens of their own carry over); after that each agent keeps its own
    profile="$AGENTS_PROFILES/$agent"
    if [ ! -d "$profile" ]; then
      mkdir -p "$profile"
      if [ -d "$SHARED_PROFILE" ]; then
        tar -C "$SHARED_PROFILE" --exclude='Singleton*' --exclude='*Cache*' --exclude='DevToolsActivePort' -cf - . 2>/dev/null | tar -C "$profile" -xf - 2>/dev/null || true
      fi
    fi
    setsid Xvfb ":$n" -screen 0 "${RES}x24" -nolisten tcp -dpi 96 </dev/null >/dev/null 2>&1 9>&- &
    echo $! > "$DIR/$n.x"
    i=0
    until xdpyinfo -display ":$n" >/dev/null 2>&1; do
      i=$((i + 1))
      [ "$i" -lt 100 ] || { stop_display "$n"; echo "the screen didn't come up" >&2; exit 1; }
      sleep 0.1
    done
    # the same desktop as the main screen; Chrome opened on it (the dock, a link) uses the agent's profile
    DISPLAY=":$n" WISP_AGENT="$agent" WISP_CDP_PORT=$((n + 9300)) setsid dbus-launch --exit-with-session startxfce4 </dev/null >"/tmp/xfce-$n.log" 2>&1 9>&- &
    echo $! > "$DIR/$n.session"
    setsid x11vnc -display ":$n" -localhost -rfbport $((n + 5900)) -forever -shared -nopw -noxdamage -quiet </dev/null >"/tmp/x11vnc-$n.log" 2>&1 9>&- &
    echo $! > "$DIR/$n.vnc"
    echo "$n" > "$DIR/agent-$agent"
    # VNC answering before anyone connects
    i=0
    until (echo >"/dev/tcp/127.0.0.1/$((n + 5900))") 2>/dev/null || [ "$i" -ge 50 ]; do i=$((i + 1)); sleep 0.1; done
    info "$n" "$agent"
    ;;
  down)
    [ -n "$agent" ] || { echo "usage: wisp-screen down <agent> [force]" >&2; exit 2; }
    exec 9>"$DIR/.lock"
    flock 9
    n=$(cat "$DIR/agent-$agent" 2>/dev/null || true)
    [ -n "$n" ] || exit 0
    # its browser tools are still connected (a run is using it): leave it
    if [ "$3" != "force" ] && pgrep -f -- "cdp-endpoint http://127.0.0.1:$((n + 9300))" >/dev/null 2>&1; then echo busy; exit 0; fi
    stop_display "$n"
    rm -f "$DIR/agent-$agent"
    ;;
  list)
    for f in "$DIR"/agent-*; do
      [ -e "$f" ] || continue
      n=$(cat "$f")
      live "$(pidof_file "$n.x")" && echo "${f##*/agent-} $n"
    done
    ;;
  *)
    echo "usage: wisp-screen up|down|list <agent>" >&2
    exit 2
    ;;
esac
