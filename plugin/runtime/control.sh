#!/bin/sh
# This is only invoked by declared Ervisio plugin commands.
set -eu
SERVICE=ervisio-browser-robots.service
SETUP=ervisio-browser-robots-setup.service
BASE=/var/lib/ervisio/plugins/robots/runtime
case "${1:-}" in
  status)
    printf 'service='; systemctl show "$SERVICE" --value --property=ActiveState 2>/dev/null || printf 'unknown\n'
    printf 'setup='; systemctl show "$SETUP" --value --property=SubState 2>/dev/null || printf 'unknown\n'
    printf 'socket='; if [ -S /run/ervisio-browser-robots/control.sock ]; then echo present; else echo missing; fi
    ;;
  logs)
    echo '=== Installation ==='
    journalctl -u "$SETUP" --no-pager -n 60 -o cat 2>&1 || :
    echo '=== Runtime ==='
    journalctl -u "$SERVICE" --no-pager -n 40 -o cat 2>&1 || :
    ;;
  install|repair)
    [ "$(id -u)" -eq 0 ] || { echo 'Administrator unlock required' >&2; exit 1; }
    command -v systemctl >/dev/null || { echo 'systemd required' >&2; exit 1; }
    if [ ! -f "$BASE/install.sh" ]; then
      echo 'Plugin files missing in /var/lib/ervisio/plugins/robots/runtime. Install the plugin through the marketplace first.' >&2
      exit 1
    fi
    state=$(systemctl show "$SETUP" --value --property=SubState 2>/dev/null || :)
    if [ "$state" = running ] || [ "$state" = start ]; then echo 'Installation already running'; exit 0; fi
    systemctl stop "$SETUP" >/dev/null 2>&1 || :
    systemctl reset-failed "$SETUP" >/dev/null 2>&1 || :
    systemd-run --unit=ervisio-browser-robots-setup --description='Install or repair Ervisio Browser Robots' --remain-after-exit -- /bin/sh "$BASE/install.sh"
    echo 'Installation started in systemd. It continues if the browser tab closes.'
    ;;
  *) echo 'Unsupported operation' >&2; exit 2 ;;
esac
