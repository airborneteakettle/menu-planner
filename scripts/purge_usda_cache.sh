#!/usr/bin/env bash
# Purge the USDA lookup cache and restart the app service.
#
# Usage:
#   ./scripts/purge_usda_cache.sh              # purge everything
#   ./scripts/purge_usda_cache.sh milk         # purge one ingredient (search cache)
#   ./scripts/purge_usda_cache.sh --id 1097512 # purge one fdcId (portion cache)
#   ./scripts/purge_usda_cache.sh --no-restart # skip service restart

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$SCRIPT_DIR/../data/menu_planner.db"
SERVICE="menu-planner"
RESTART=true
MODE="all"
TARGET=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-restart) RESTART=false; shift ;;
    --id)         MODE="portion"; TARGET="$2"; shift 2 ;;
    -*)           echo "Unknown option: $1" >&2; exit 1 ;;
    *)            MODE="search"; TARGET="$1"; shift ;;
  esac
done

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [[ ! -f "$DB" ]]; then
  echo "Error: database not found at $DB" >&2
  exit 1
fi

# Use Python's built-in sqlite3 module — always available since the app runs on Python.
db_exec() {
  python3 -c "
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
result = db.execute(sys.argv[2]).fetchone()
db.commit()
db.close()
print(result[0] if result else 0)
" "$DB" "$1"
}

db_run() {
  python3 -c "
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute(sys.argv[2])
db.commit()
db.close()
" "$DB" "$1"
}

# ── Purge ─────────────────────────────────────────────────────────────────────
before=$(db_exec "SELECT COUNT(*) FROM usda_cache;")

case "$MODE" in
  all)
    db_run "DELETE FROM usda_cache;"
    echo "Purged all $before cache entries."
    ;;
  search)
    db_run "DELETE FROM usda_cache WHERE key = 'search:$TARGET';"
    echo "Purged search cache for '$TARGET'."
    ;;
  portion)
    db_run "DELETE FROM usda_cache WHERE key = 'portion:$TARGET';"
    echo "Purged portion cache for fdcId $TARGET."
    ;;
esac

after=$(db_exec "SELECT COUNT(*) FROM usda_cache;")
echo "Cache entries remaining: $after"

# ── Restart service (flushes in-memory L1 cache) ─────────────────────────────
if [[ "$RESTART" == true ]]; then
  if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
    echo "Restarting $SERVICE..."
    sudo systemctl restart "$SERVICE"
    echo "Done."
  else
    echo "Service '$SERVICE' is not running — skipping restart."
  fi
else
  echo "Skipping restart (--no-restart). In-memory cache still holds old data until next restart."
fi
