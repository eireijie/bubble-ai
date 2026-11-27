#!/bin/sh
# Playwright MCP on a Chrome people can watch, started first if it isn't running. Bubble AI hands this
# to agents as their browser tools. With WISP_AGENT set (on the shared computer), that agent's own
# screen and browser profile (wisp-screen); otherwise the main screen's Chrome with its sign-ins.
export DISPLAY=:1
PORT=9222
if [ -n "$WISP_AGENT" ] && command -v wisp-screen >/dev/null 2>&1; then
  eval "$(wisp-screen up "$WISP_AGENT")"
  export DISPLAY WISP_AGENT WISP_CDP_PORT="$CDP_PORT"
  PORT="$CDP_PORT"
fi
up() { curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; }
if ! up; then
  nohup google-chrome about:blank </dev/null >"/tmp/chrome-$PORT.log" 2>&1 &
  for _ in $(seq 1 150); do up && break; sleep 0.1; done
fi
exec playwright-mcp --cdp-endpoint "http://127.0.0.1:$PORT" "$@"
