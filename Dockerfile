FROM node:20-slim

RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages pymupdf translators

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

EXPOSE 10000

ENV NODE_ENV=production
ENV PORT=10000
CMD ["node", "dist/index.cjs"]
