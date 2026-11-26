#!/bin/sh
# Runs a command again after it fails, for steps that download things: a DNS or network hiccup
# (EAI_AGAIN inside a VM engine, say) passes on its own. Up to 5 tries, waiting longer each time.
n=1
until "$@"; do
  [ "$n" -ge 5 ] && exit 1
  echo "retry: '$*' failed (try $n of 5), trying again in $((n * 10))s" >&2
  sleep $((n * 10))
  n=$((n + 1))
done
