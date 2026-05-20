# =============================================================================
# Dockerfile multi-stage pra Dia D Burst
# =============================================================================
# Stage 1: build do Vite (Node)
# Stage 2: servir o build com nginx (leve, ~30MB)
#
# As variaveis VITE_* precisam estar disponiveis NO MOMENTO DO BUILD (sao
# injetadas no bundle JS). No EasyPanel: defina no painel "Environment"
# do servico antes do deploy.
# =============================================================================

# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Cache de deps: copia so package.json antes
COPY package.json package-lock.json* ./
RUN npm ci

# Copia o resto e builda
COPY . .

# As variaveis VITE_* vem do ambiente (definidas no EasyPanel)
# O Vite as embute no bundle final automaticamente
RUN npm run build

# ---------- Stage 2: nginx servindo o /dist ----------
FROM nginx:alpine

# Substitui config padrao
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copia o build da stage anterior
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# nginx ja inicia automaticamente, mas explicito pra clareza
CMD ["nginx", "-g", "daemon off;"]
