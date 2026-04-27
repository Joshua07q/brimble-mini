FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    docker.io \
    git \
    python3 \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://railpack.com/install.sh | sh -s -- --bin-dir /usr/local/bin

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start"]
