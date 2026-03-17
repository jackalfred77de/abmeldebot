#!/bin/bash
# startup.sh — Azure App Service startup script for AbmeldeBot
# Installs Python packages on first run, then starts the Node.js bot

echo "🚀 AbmeldeBot startup on Azure..."

APP_DIR="/home/site/wwwroot"
PY_PACKAGES="$APP_DIR/.python_packages"

# Check if Python packages are already installed
if python3 -c "import pypdf; import fitz" 2>/dev/null; then
    echo "✅ Python packages already available"
else
    echo "📦 Installing Python packages..."
    pip3 install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1 || \
    pip install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1 || \
    python3 -m pip install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1
    echo "✅ Python packages installed to $PY_PACKAGES"
fi

# Set PYTHONPATH
export PYTHONPATH="$PY_PACKAGES:$PYTHONPATH"

# Verify
python3 -c "import pypdf; import fitz; print('✅ Python imports OK: pypdf + fitz')" 2>&1 || echo "⚠️ Python import check failed"

# Create pdfs directories
mkdir -p "$APP_DIR/pdfs/archive"

# Start Node.js bot
echo "🤖 Starting node bot.js..."
cd "$APP_DIR"
node bot.js
