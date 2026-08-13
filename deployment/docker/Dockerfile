FROM node:22-alpine

ENV NODE_ENV=development
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json server.mjs ./
COPY apps ./apps
COPY packages ./packages
COPY database ./database
COPY public ./public
COPY scripts ./scripts

USER node

CMD ["npm", "run", "dev:core"]
