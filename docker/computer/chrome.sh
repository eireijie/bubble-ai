#!/bin/sh
# Google Chrome the way Bubble AI's VMs run it, however it's opened (the dock, a link, an agent):
#   --no-sandbox     containers don't give Chrome user namespaces; --test-type hides the bar about it
#   a profile of its own, because Chrome refuses its debugging port on the default profile; the
#   port listens only inside the VM, for the agents' browser tools (Playwright MCP)
#   on an agent's own screen (wisp-screen), that agent's profile and debugging port
#   maximized, so agents and people see the whole page above the dock
PROFILE=/home/wisp/.config/wisp-browser
PORT=9222
if [ -n "$WISP_AGENT" ] && [ -n "$WISP_CDP_PORT" ]; then
  PROFILE="/home/wisp/.config/wisp-browser-agents/$WISP_AGENT"
  PORT="$WISP_CDP_PORT"
fi
exec /opt/google/chrome/google-chrome \
  --no-sandbox --test-type --no-first-run --no-default-browser-check --password-store=basic \
  --start-maximized --user-data-dir="$PROFILE" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port="$PORT" "$@"
