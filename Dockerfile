# syntax=docker/dockerfile:1

FROM node:alpine AS builder

WORKDIR /workspace

# Install build dependencies
COPY ["package.json", "package-lock.json*", "./"]
RUN npm install

# Build static files
COPY . .
RUN npm run build

# Install production dependencies
RUN npm ci --production

ENV NODE_ENV=production
CMD ["node", "-r", "@graffiticode/tracing", "build/src/app.js"]
