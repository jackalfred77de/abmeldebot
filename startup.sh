#!/bin/bash
# startup.sh — Azure App Service startup script for AbmeldeBot
# Installs Python packages persistently under /home, then starts the Node.js bot
set -e

echo "🚀 AbmeldeBot startup on Azure..."
echo "📁 PWD=$(pwd)"
echo "📅 $(date -u)"

APP_DIR="/home/site/wwwroot"
# Use /home/python_packages — /home is persistent across Azure restarts!
PY_PACKAGES="/home/python_packages"
export PYTHONPATH="$PY_PACKAGES:${PYTHONPATH:-}"

# ── Step 1: Ensure Python3 + pip3 are available ──
echo "🐍 Checking Python..."
if ! command -v python3 &>/dev/null; then
    echo "⚠️  python3 not found, installing..."
    apt-get update -qq && apt-get install -y -qq python3 python3-pip >/dev/null 2>&1 || true
fi
python3 --version 2>&1 || echo "❌ python3 still not available"

# ── Step 2: Check if packages already installed (persistent) ──
echo "🔍 Checking Python packages in $PY_PACKAGES ..."
if python3 -c "import sys; sys.path.insert(0,'$PY_PACKAGES'); import pypdf; import fitz; import reportlab; print('✅ Python packages available (persistent): pypdf=' + pypdf.__version__)" 2>/dev/null; then
    echo "✅ Python packages already installed — skipping pip"
else
    echo "📦 Installing Python packages to $PY_PACKAGES ..."
    mkdir -p "$PY_PACKAGES"

    # Try pip3 with --target (preferred — keeps packages in persistent /home)
    if command -v pip3 &>/dev/null; then
        pip3 install --target "$PY_PACKAGES" --upgrade pypdf pymupdf reportlab 2>&1 || true
    elif python3 -m pip --version &>/dev/null; then
        python3 -m pip install --target "$PY_PACKAGES" --upgrade pypdf pymupdf reportlab 2>&1 || true
    else
        # pip not available — install it first
        echo "📦 pip not found, installing pip..."
        apt-get update -qq 2>/dev/null && apt-get install -y -qq python3-pip 2>/dev/null || true
        # Try get-pip.py as final fallback
        if ! command -v pip3 &>/dev/null && ! python3 -m pip --version &>/dev/null 2>&1; then
            echo "📦 Trying get-pip.py..."
            python3 -c "import urllib.request; urllib.request.urlretrieve('https://bootstrap.pypa.io/get-pip.py', '/tmp/get-pip.py')" 2>&1 || true
            python3 /tmp/get-pip.py --break-system-packages 2>&1 || true
        fi
        # Now try again
        if command -v pip3 &>/dev/null; then
            pip3 install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1 || true
        elif python3 -m pip --version &>/dev/null 2>&1; then
            python3 -m pip install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1 || true
        else
            echo "❌ Could not install pip — Python packages will be missing!"
        fi
    fi

    # Verify
    echo "🔍 PYTHONPATH=$PYTHONPATH"
    python3 -c "import sys; sys.path.insert(0,'$PY_PACKAGES'); import pypdf; import fitz; import reportlab; print('✅ Python imports OK: pypdf=' + pypdf.__version__)" 2>&1 || echo "❌ Python import check FAILED"
fi

# ── Step 3: Create pdfs directories ──
mkdir -p "$APP_DIR/pdfs/archive"

# ── Step 4: Start Node.js bot ──
echo "🤖 Starting node bot.js..."
cd "$APP_DIR"
node bot.js
