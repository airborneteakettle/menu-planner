#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Push latest changes to the production server
#
# Usage (from your local machine, from the repo root):
#   ./scripts/deploy.sh deploy@45.33.32.156
#
# What it does:
#   - git pull on the server
#   - pip install (only if requirements.txt changed)
#   - flask db upgrade (runs any new migrations)
#   - graceful gunicorn restart (zero-downtime via systemctl)
#   - health check — confirms the app responds before finishing
# =============================================================================

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────────
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <user@host>"
  echo "  e.g. $0 deploy@45.33.32.156"
  exit 1
fi

SSH_TARGET="$1"
APP_DIR="/opt/menu-planner"
SERVICE="menu-planner"

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "\n${CYAN}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
fail() { echo -e "${RED}✗ $*${NC}"; exit 1; }

remote() { ssh -o StrictHostKeyChecking=accept-new "$SSH_TARGET" "$@"; }

echo ""
echo "=============================================="
echo "  Menu Planner — Deploy"
echo "  Target : $SSH_TARGET"
echo "  Branch : $(git branch --show-current 2>/dev/null || echo unknown)"
echo "  Commit : $(git log -1 --oneline 2>/dev/null || echo unknown)"
echo "=============================================="

# ── 1. Pull latest code ───────────────────────────────────────────────────────
step "Pulling latest code"
remote "cd $APP_DIR && git pull --ff-only"
ok "Code updated"

# ── 2. Install/update dependencies if requirements changed ───────────────────
step "Checking dependencies"
CHANGED=$(remote "cd $APP_DIR && git diff HEAD@{1} HEAD --name-only 2>/dev/null || echo requirements.txt")
if echo "$CHANGED" | grep -q "requirements.txt"; then
  remote "cd $APP_DIR && venv/bin/pip install --quiet -r requirements.txt gunicorn"
  ok "Dependencies updated"
else
  ok "requirements.txt unchanged — skipping pip install"
fi

# ── 3. Run migrations ─────────────────────────────────────────────────────────
step "Running database migrations"
remote "cd $APP_DIR && venv/bin/flask db upgrade"
ok "Migrations applied"

# ── 4. Restart the app ────────────────────────────────────────────────────────
step "Restarting application"
remote "sudo systemctl restart $SERVICE"
# Give gunicorn a moment to come back up
sleep 2
STATUS=$(remote "sudo systemctl is-active $SERVICE" || echo "failed")
if [[ "$STATUS" != "active" ]]; then
  fail "Service failed to restart — check: ssh $SSH_TARGET 'sudo journalctl -u $SERVICE -n 50'"
fi
ok "Service restarted (status: $STATUS)"

# ── 5. Health check ───────────────────────────────────────────────────────────
step "Health check"
HTTP_CODE=$(remote "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/ --max-time 10" || echo "000")
if [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "302" ]]; then
  ok "App responding (HTTP $HTTP_CODE)"
else
  fail "App not responding — HTTP $HTTP_CODE. Check: ssh $SSH_TARGET 'sudo journalctl -u $SERVICE -n 30'"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Deploy complete!${NC}"
echo ""
