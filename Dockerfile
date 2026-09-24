# Verwaltungsassistent: App-Server und Whisper-Bruecke aus einem Image.
# Abhaengigkeiten werden beim Bauen installiert (nicht bei jedem Start),
# ohne Postinstall-Skripte, und der Prozess laeuft als Nutzer "node".
#
#   docker build -t verwaltung .
#   docker run --rm -p 127.0.0.1:4115:4115 -e HOST=0.0.0.0 verwaltung
#   docker run --rm verwaltung node scripts/whisper-bruecke.mjs
FROM node:22-slim

WORKDIR /app

# Nur Manifest zuerst: Layer-Cache fuer npm ci.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund 2>/dev/null \
  || npm install --omit=dev --ignore-scripts --no-audit --no-fund

# Quellcode, Wissensbasis, Skripte. .dockerignore haelt .env, .git, Tests
# und Doku fern.
COPY --chown=node:node . .

# RAG-Korpus aus der Wissensbasis erzeugen (dist/chunks.jsonl).
RUN node scripts/build-chunks.mjs && chown -R node:node dist

USER node
ENV HOST=0.0.0.0 PORT=4115 NODE_ENV=production
EXPOSE 4115 4116

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4115)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/server.mjs"]
