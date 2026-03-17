#!/bin/bash
# startup.sh — Azure App Service startup script for AbmeldeBot
# Ensures Python packages are available before starting the Node.js bot

echo "🚀 AbmeldeBot startup..."

# Set Python packages path
export PYTHONPATH="/home/site/wwwroot/python_packages:$PYTHONPATH"

# Verify Python is available
if command -v python3 &> /dev/null; then
    echo "✅ Python3 found: $(python3 --version)"
else
    echo "⚠️ Python3 not found!"
fi

# Check if packages are installed
python3 -c "import pypdf; import fitz; print('✅ Python packages OK')" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "⚠️ Python packages missing, installing..."
    pip install --user pypdf pymupdf reportlab 2>/dev/null || pip3 install --user pypdf pymupdf reportlab 2>/dev/null || true
    export PYTHONPATH="$HOME/.local/lib/python3.*/site-packages:$PYTHONPATH"
fi

# Create pdfs directory if it doesn't exist
mkdir -p /home/site/wwwroot/pdfs/archive

# Start Node.js bot
echo "🤖 Starting bot.js..."
node /home/site/wwwroot/bot.js
