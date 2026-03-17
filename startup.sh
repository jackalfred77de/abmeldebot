#!/bin/bash
# startup.sh — Azure App Service startup script for AbmeldeBot
# Installs Python packages, then starts the Node.js bot

echo "🚀 AbmeldeBot startup on Azure..."

APP_DIR="/home/site/wwwroot"
PY_PACKAGES="$APP_DIR/.python_packages"

# Ensure PYTHONPATH is set for all child processes
export PYTHONPATH="$PY_PACKAGES:${PYTHONPATH:-}"

# Check if Python packages are already importable
if python3 -c "import pypdf; import fitz; import reportlab" 2>/dev/null; then
    echo "✅ Python packages already available"
else
    echo "📦 Installing Python packages to $PY_PACKAGES ..."
    mkdir -p "$PY_PACKAGES"

    # Try pip3, then pip, then python3 -m pip — install to --target
    if pip3 install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1; then
        echo "✅ pip3 --target install OK"
    elif pip install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1; then
        echo "✅ pip --target install OK"
    elif python3 -m pip install --target "$PY_PACKAGES" pypdf pymupdf reportlab 2>&1; then
        echo "✅ python3 -m pip --target install OK"
    else
        echo "⚠️ --target install failed, trying system-wide install..."
        pip3 install pypdf pymupdf reportlab 2>&1 || \
        pip install pypdf pymupdf reportlab 2>&1 || \
        python3 -m pip install pypdf pymupdf reportlab 2>&1 || \
        echo "❌ ALL pip install attempts failed!"
    fi

    echo "📋 Contents of $PY_PACKAGES:"
    ls -la "$PY_PACKAGES/" 2>&1 | head -20
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
