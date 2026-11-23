#!/bin/zsh
# Autostart des Webscanner-Workers auf dem Mac (LaunchAgent).  Aufruf: worker/mac.sh install | uninstall | log
set -euo pipefail
DIR="${0:A:h}"
LABEL="de.sbahn.webscanner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/sbahn-webscanner.log"
case "${1:-}" in
  install)
    [[ -f "$DIR/.env" ]] || { echo "worker/.env fehlt (siehe docs/scanner.md)"; exit 1; }
    NODE="$(command -v node)"
    (cd "$DIR" && npm ci --silent && npx playwright install --only-shell chromium)
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>--env-file=.env</string><string>src/main.ts</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
XML
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$PLIST"
    echo "Worker läuft und startet bei der Anmeldung. Der Scanner selbst bleibt AUS, bis du ihn im Dashboard einschaltest."
    ;;
  uninstall)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Autostart entfernt."
    ;;
  log) tail -n 50 -f "$LOG" ;;
  *) echo "Aufruf: worker/mac.sh install | uninstall | log"; exit 1 ;;
esac
