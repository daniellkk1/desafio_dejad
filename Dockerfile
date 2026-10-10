FROM node:20-alpine

WORKDIR /app

# Instala dependencias primeiro (melhor cache de build)
COPY package.json ./
RUN npm install --omit=dev

# Copia o restante do projeto (HTML + server)
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
