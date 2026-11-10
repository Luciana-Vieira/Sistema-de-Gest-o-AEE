# Imagem de produção do Vértice Gestão (Node 22, sem dependências nativas).
FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN npm run build && mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npm run migrate && npm start"]
