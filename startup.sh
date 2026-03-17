#!/bin/bash
# startup.sh — Azure App Service startup script for AbmeldeBot
# Installs Python packages on first run, then starts Node.js bot

echo "🚀 AbmeldeBot startup..."

# Python packages directory (persistent across restarts on Azure)
PY_PKG_DIR="/home/python_packages"

# Check if Python packages are already installed
if python3 -c "import sys; sys.path.insert(0,'$PY_PKG_DIR'); import pypdf; import fitz" 2>/dev/null; then
    echo "✅ Python packages already installed"
else
    echo "📦 Installing Python packages (first run)..."
    pip install pypdf pymupdf reportlab --target "$PY_PKG_DIR" 2>&1 || \
    pip3 install pypdf pymupdf reportlab --target "$PY_PKG_DIR" 2>&1 || \
    python3 -m pip install pypdf pymupdf reportlab --target "$PY_PKG_DIR" 2>&1
    echo "✅ Python packages installed"
fi

# Set PYTHONPATH so python3 finds the packages
export PYTHONPATH="$PY_PKG_DIR:$PYTHONPATH"

# Verify
python3 -c "import pypdf; import fitz; print('✅ Python imports OK: pypdf + pymupdf')" 2>&1 || echo "⚠️ Python import check failed"

# Create pdfs directory
mkdir -p /home/site/wwwroot/pdfs/archive

# Start Node.js bot
echo "🤖 Starting bot.js on port ${PORT:-8080}..."
cd /home/site/wwwroot
node bot.js
