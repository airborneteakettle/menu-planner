#!/usr/bin/env bash
# =============================================================================
# setup_server.sh — First-time Linode setup for menu-planner
#
# Run this ONCE on a fresh Ubuntu 24.04 server after:
#   1. Creating the Linode and noting its IP
#   2. Pointing your domain's A record to that IP
#   3. Copying your SSH public key to root@<IP>
#
# Usage (from your local machine):
#   chmod +x scripts/setup_server.sh
#   ./scripts/setup_server.sh deploy@45.33.32.156 menu-planner.charaska.com
#
# What it does:
#   - Hardens SSH (no root login, no password auth)
#   - Installs nginx, python3, certbot
#   - Clones the repo to /opt/menu-planner
#   - Creates a Python virtualenv and installs dependencies
#   - Prompts you for secrets and writes /opt/menu-planner/.env
#   - Creates the data/ directory and runs database migrations
#   - Installs and starts the systemd service
#   - Configures nginx as a reverse proxy
#   - Obtains a Let's Encrypt TLS certificate
# =============================================================================

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────────
if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <user@host> <domain>"
  echo "  e.g. $0 deploy@45.33.32.156 menu-planner.charaska.com"
  exit 1
fi

SSH_TARGET="$1"   # e.g. deploy@45.33.32.156
DOMAIN="$2"       # e.g. menu-planner.charaska.com
REPO="https://github.com/airborneteakettle/menu-planner.git"
APP_DIR="/opt/menu-planner"
SERVICE="menu-planner"

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
step()  { echo -e "\n${CYAN}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }

# Helper: run a command on the remote server
remote() { ssh -o StrictHostKeyChecking=accept-new "$SSH_TARGET" "$@"; }

# ── Collect secrets locally before touching the server ────────────────────────
echo ""
echo "=============================================="
echo "  Menu Planner — Server Setup"
echo "  Target : $SSH_TARGET"
echo "  Domain : $DOMAIN"
echo "=============================================="
echo ""
warn "You will be prompted for secrets. They are written only to the server."
echo ""

read -rp  "USDA_API_KEY   : " USDA_API_KEY
read -rsp "RESEND_API_KEY : " RESEND_API_KEY; echo
read -rp  "MAIL_FROM      [accounts@${DOMAIN}]: " MAIL_FROM
MAIL_FROM="${MAIL_FROM:-accounts@${DOMAIN}}"
read -rp  "Certbot e-mail (for TLS cert renewal notices): " CERTBOT_EMAIL

# Generate a production SECRET_KEY
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))" 2>/dev/null \
             || openssl rand -hex 32)

echo ""
step "Secrets collected — starting server setup"

# ── 1. System packages ────────────────────────────────────────────────────────
step "Installing system packages"
remote "sudo apt-get update -qq && \
        sudo apt-get install -y -qq python3 python3-pip python3-venv nginx git ufw certbot python3-certbot-nginx"
ok "Packages installed"

# ── 2. Firewall ───────────────────────────────────────────────────────────────
step "Configuring firewall"
remote "sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw --force enable"
ok "Firewall enabled (OpenSSH + Nginx Full)"

# ── 3. Harden SSH ─────────────────────────────────────────────────────────────
step "Hardening SSH"
remote "sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && \
        sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && \
        sudo systemctl restart ssh"
ok "Root login and password auth disabled"

# ── 4. Clone repo ─────────────────────────────────────────────────────────────
step "Cloning repository"
remote "sudo mkdir -p $APP_DIR && sudo chown \$(whoami):\$(whoami) $APP_DIR"
remote "git clone $REPO $APP_DIR || (cd $APP_DIR && git pull)"
ok "Repository cloned to $APP_DIR"

# ── 5. Python virtualenv ──────────────────────────────────────────────────────
step "Creating virtualenv and installing dependencies"
remote "cd $APP_DIR && \
        python3 -m venv venv && \
        venv/bin/pip install --quiet -r requirements.txt gunicorn"
ok "Dependencies installed"

# ── 6. Write .env ─────────────────────────────────────────────────────────────
step "Writing .env"
remote "cat > $APP_DIR/.env << 'ENVEOF'
SECRET_KEY=${SECRET_KEY}
USDA_API_KEY=${USDA_API_KEY}
RESEND_API_KEY=${RESEND_API_KEY}
MAIL_FROM=${MAIL_FROM}
ENVEOF
chmod 600 $APP_DIR/.env"
ok ".env written (chmod 600)"

# ── 7. Database ───────────────────────────────────────────────────────────────
step "Running database migrations"
remote "cd $APP_DIR && \
        mkdir -p data && \
        venv/bin/flask db upgrade"
ok "Database initialised"

# ── 8. Log directory ──────────────────────────────────────────────────────────
step "Creating log directory"
remote "sudo mkdir -p /var/log/$SERVICE && \
        sudo chown \$(whoami):\$(whoami) /var/log/$SERVICE"
ok "Logs → /var/log/$SERVICE"

# ── 9. systemd service ────────────────────────────────────────────────────────
step "Installing systemd service"
remote "sudo tee /etc/systemd/system/${SERVICE}.service > /dev/null << 'SVCEOF'
[Unit]
Description=Menu Planner Flask App
After=network.target

[Service]
User=$(echo $SSH_TARGET | cut -d@ -f1)
Group=$(echo $SSH_TARGET | cut -d@ -f1)
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${APP_DIR}/venv/bin/gunicorn \\
    --workers 2 \\
    --threads 2 \\
    --bind 127.0.0.1:8000 \\
    --access-logfile /var/log/${SERVICE}/access.log \\
    --error-logfile /var/log/${SERVICE}/error.log \\
    \"app:create_app()\"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF"

remote "sudo systemctl daemon-reload && \
        sudo systemctl enable $SERVICE && \
        sudo systemctl start $SERVICE"
ok "systemd service enabled and started"

# ── 10. nginx config ──────────────────────────────────────────────────────────
step "Configuring nginx"
remote "sudo tee /etc/nginx/sites-available/$SERVICE > /dev/null << 'NGINXEOF'
server {
    listen 80;
    server_name ${DOMAIN};

    location /static/ {
        alias ${APP_DIR}/app/static/;
        expires 7d;
        add_header Cache-Control \"public, immutable\";
    }

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINXEOF"

remote "sudo ln -sf /etc/nginx/sites-available/$SERVICE \
                    /etc/nginx/sites-enabled/$SERVICE && \
        sudo nginx -t && \
        sudo systemctl reload nginx"
ok "nginx configured and reloaded"

# ── 11. TLS certificate ───────────────────────────────────────────────────────
step "Obtaining TLS certificate from Let's Encrypt"
remote "sudo certbot --nginx \
            --non-interactive \
            --agree-tos \
            --email $CERTBOT_EMAIL \
            -d $DOMAIN"
ok "TLS certificate installed"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}=============================================="
echo -e "  Setup complete!"
echo -e "  https://${DOMAIN}"
echo -e "==============================================${NC}"
echo ""
echo "Next step — create your first user account:"
echo "  ssh $SSH_TARGET 'cd $APP_DIR && venv/bin/flask create-user <username>'"
echo ""
warn "Save your SECRET_KEY somewhere safe:"
echo "  $SECRET_KEY"
