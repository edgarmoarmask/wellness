dnf install git nginx unzip 

# bun
curl -fsSL https://bun.sh/install | sudo BUN_INSTALL=/usr/local bash

# uv
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh

REPO_URL="https://github.com/edgarmoarmask/wellness.git"

mkdir -p "$REPO_DIR" "$WEB_ROOT"
chown "$APP_USER:$APP_USER" "$REPO_DIR" "$WEB_ROOT"
chmod 755 /home "$WEB_ROOT"

sudo -u "$APP_USER" -H env REPO_URL="$REPO_URL" REPO_DIR="$REPO_DIR" VITE_API_URL="$API_URL" bash -euo pipefail <<'USER_STEPS'
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" pull
else
  git clone "$REPO_URL" "$REPO_DIR"
fi
USER_STEPS