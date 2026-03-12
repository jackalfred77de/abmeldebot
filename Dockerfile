FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-dev \
    gcc g++ make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install pypdf==4.3.1
RUN pip3 install pymupdf==1.24.9
RUN pip3 install "reportlab>=4.0.0"

COPY package.json ./
RUN npm install --only=production

COPY . .
RUN mkdir -p pdfs/archive

ENV NODE_ENV=production
ENV PYTHON_PATH=python3

CMD ["node", "bot.js"]
