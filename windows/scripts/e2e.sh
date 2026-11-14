#!/usr/bin/env bash
# Runs the real-Electron end-to-end test on Linux (needs xvfb). Two launches share one profile folder, so
# the second one proves that bookmarks and window size survive an app restart.
set -u
cd "$(dirname "$0")/.."
ELECTRON=node_modules/electron/dist/electron
UD="$(mktemp -d)"
FLAGS="--no-sandbox"                      # needed only when running as root (CI containers); the app itself sets sandbox:true
[ "${NPTEL_E2E_SANDBOX:-0}" = "1" ] && FLAGS=""
rc=0
for phase in 1 2; do
  xvfb-run -a "$ELECTRON" $FLAGS --disable-gpu test/e2e/main-e2e.js --phase=$phase --user-data="$UD" 2>&1 | grep -E "^E2E" || rc=1
  [ "${PIPESTATUS[0]}" = "0" ] || rc=1
done
rm -rf "$UD"
exit $rc
