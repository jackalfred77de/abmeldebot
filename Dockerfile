FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev \
    gcc g++ make \
    libmupdf-dev \
    mupdf-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --break-system-packages pypdf==4.3.1
RUN pip3 install --break-system-packages pymupdf==1.24.9

COPY package.json ./
RUN npm install --only=production

COPY . .
RUN mkdir -p pdfs/archive

ENV NODE_ENV=production
ENV PYTHON_PATH=python3

CMD ["node", "bot.js"]
