FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY baseline-harness.js ./

EXPOSE 3000
CMD ["node", "baseline-harness.js"]

