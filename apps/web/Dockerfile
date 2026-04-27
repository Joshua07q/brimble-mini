FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

EXPOSE 4173
CMD ["npm", "run", "preview"]
