# print-to-calendar backend (Hono + better-sqlite3)
FROM node:20-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 のネイティブビルドに必要
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Tokyo
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# DBはボリュームマウント想定（/app/data）
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["node", "dist/index.js"]
