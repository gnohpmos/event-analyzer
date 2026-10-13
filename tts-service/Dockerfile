FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production

WORKDIR /app

# Install system dependencies needed for Playwright browser execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json /app/
RUN npm install --production

# Install Chromium and required OS dependencies via Playwright CLI
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

COPY . /app/

EXPOSE 8088

CMD ["node", "src/server.js"]
