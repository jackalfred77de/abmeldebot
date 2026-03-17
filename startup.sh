#!/bin/bash
# startup.sh — Azure App Service startup script for AbmeldeBot
# Installs Python packages, then starts the Node.js bot

echo "🚀 AbmeldeBot startup on Azure..."

APP_DIR="/home/site/wwwroot"
PY_PACKAGES="$APP_DIR/.python_packages"

# Ensure PYTHONPATH is set for all child processes
export PYTHONPATH="$PY_PACKAGES:${PYTHONPATH:-}"

# Python packages are pre-installed by GitHub Actions into .python_packages/
# Verify they are importable with PYTHONPATH set
if python3 -c "import pypdf; import fitz; import reportlab" 2>/dev/null; then
    echo "✅ Python packages available (pre-deployed)"
else
    echo "⚠️ Pre-deployed packages not found, attempting runtime install..."
    mkdir -p "$PY_PACKAGES"
    pip3 install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1 || \
    python3 -m pip install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1 || \
    pip3 install pypdf pymupdf reportlab 2>&1 || \
    echo "❌ pip install failed! PDF generation will not work."
fi

# Verify imports with PYTHONPATH set
echo "🔍 PYTHONPATH=$PYTHONPATH"
python3 -c "import pypdf; import fitz; import reportlab; print('✅ Python imports OK: pypdf=' + pypdf.__version__)" 2>&1 || echo "⚠️ Python import check failed"

# Create pdfs directories
mkdir -p "$APP_DIR/pdfs/archive"

# Start Node.js bot
echo "🤖 Starting node bot.js..."
cd "$APP_DIR"
node bot.js
