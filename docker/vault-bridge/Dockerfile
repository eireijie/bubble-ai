# vault-bridge: the official Bitwarden CLI with a small wrapper, so agents can fill logins from the
# Wisp vault (Vaultwarden) without the password passing through the hub. See bridge.mjs.
FROM node:22-alpine
ARG BW_VERSION=2026.11.1
RUN npm install -g --no-audit --no-fund "@bitwarden/cli@${BW_VERSION}" && npm cache clean --force \
  && adduser -D -u 1000 bridge && mkdir -p /data && chown bridge /data
WORKDIR /app
COPY bridge.mjs connect.html ./
USER bridge
ENV BRIDGE_DATA=/data BRIDGE_PORT=8088
VOLUME ["/data"]
EXPOSE 8088
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8088/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bridge.mjs"]
