FROM node:26.8.1-alpine3.23 AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM node:26.8.1-alpine3.23 AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG API_INTERNAL_BASE_URL=http://api:8000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV API_INTERNAL_BASE_URL=$API_INTERNAL_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules

COPY . .
RUN npm run build

FROM node:26.8.1-alpine3.23 AS runner

WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL=/api
ARG API_INTERNAL_BASE_URL=http://api:8000
ENV HOSTNAME=0.0.0.0
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV API_INTERNAL_BASE_URL=$API_INTERNAL_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]
