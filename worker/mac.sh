#!/bin/zsh
# Webscanner-Worker auf dem Mac: Autostart (LaunchAgent) und Schalter „Mac wach halten“.
# Aufruf: worker/mac.sh install | uninstall | log | wach ein|aus|status|app
set -euo pipefail
DIR="${0:A:h}"
LABEL="de.sbahn.webscanner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
AWAKE="de.sbahn.wachhalten"
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
  wach)
    awake_on() { launchctl print "gui/$UID/$AWAKE" >/dev/null 2>&1 }
    case "${2:-status}" in
      # Läuft bis zum Ausschalten, Abmelden oder Neustart. Ändert keine Systemeinstellung.
      ein) awake_on || launchctl submit -l "$AWAKE" -- /usr/bin/caffeinate -i -s ;;
      aus) awake_on && launchctl remove "$AWAKE" ;;
      status) ;;
      app)
        osacompile -o "$DIR/../Mac wach halten.app" "$DIR/wachhalten.applescript"
        echo "Erstellt: ${DIR:h}/Mac wach halten.app"
        exit 0 ;;
      *) echo "Aufruf: worker/mac.sh wach ein | aus | status | app"; exit 1 ;;
    esac
    for _ in {1..20}; do
      case "${2:-}" in ein) awake_on && break ;; aus) awake_on || break ;; *) break ;; esac
      sleep 0.1
    done
    awake_on && echo "Mac wach halten: EIN" || echo "Mac wach halten: AUS"
    ;;
  *) echo "Aufruf: worker/mac.sh install | uninstall | log | wach"; exit 1 ;;
esac
