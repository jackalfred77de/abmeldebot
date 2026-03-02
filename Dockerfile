FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --break-system-packages -r requirements.txt

COPY package.json ./
RUN npm install --only=production

COPY . .
RUN mkdir -p pdfs/archive

ENV NODE_ENV=production
ENV PYTHON_PATH=python3

CMD ["node", "bot.js"]
