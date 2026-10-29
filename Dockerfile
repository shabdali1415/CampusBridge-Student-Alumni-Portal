FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p uploads/avatars
EXPOSE 5000
USER node
CMD ["node", "server.js"]
