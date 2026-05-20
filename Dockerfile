# =============================================================================
# Dockerfile multi-stage pra Dia D Burst
# =============================================================================
# Stage 1: build do Vite (Node)
# Stage 2: servir o build com nginx (leve, ~30MB)
#
# As variaveis VITE_* precisam estar disponiveis NO MOMENTO DO BUILD (sao
# embutidas no bundle JS pelo Vite). No EasyPanel: defina no painel
# "Variaveis de Ambiente" do servico ANTES de implantar.
#
# IMPORTANTE: cada variavel VITE_* precisa ser declarada como ARG e
# convertida em ENV dentro do stage de build, senao o Vite nao acha.
# =============================================================================

# ---------- Stage 1: build ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Declara as build args que EasyPanel passa via --build-arg
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_SERVICE_ROLE_SECRET
ARG VITE_UAZAPI_URL
ARG VITE_UAZAPI_TOKEN
ARG VITE_META_TOKEN_RENAN
ARG VITE_META_ACCOUNT_RENAN
ARG VITE_META_TOKEN_WESLEI
ARG VITE_META_ACCOUNT_WESLEI
ARG VITE_META_TOKEN_ANDRE
ARG VITE_META_ACCOUNT_ANDRE
ARG VITE_MONDAY_TOKEN
ARG VITE_MONDAY_BOARD_ID

# Converte ARGs em ENVs pro `npm run build` enxergar via process.env / import.meta.env
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_SERVICE_ROLE_SECRET=$VITE_SUPABASE_SERVICE_ROLE_SECRET
ENV VITE_UAZAPI_URL=$VITE_UAZAPI_URL
ENV VITE_UAZAPI_TOKEN=$VITE_UAZAPI_TOKEN
ENV VITE_META_TOKEN_RENAN=$VITE_META_TOKEN_RENAN
ENV VITE_META_ACCOUNT_RENAN=$VITE_META_ACCOUNT_RENAN
ENV VITE_META_TOKEN_WESLEI=$VITE_META_TOKEN_WESLEI
ENV VITE_META_ACCOUNT_WESLEI=$VITE_META_ACCOUNT_WESLEI
ENV VITE_META_TOKEN_ANDRE=$VITE_META_TOKEN_ANDRE
ENV VITE_META_ACCOUNT_ANDRE=$VITE_META_ACCOUNT_ANDRE
ENV VITE_MONDAY_TOKEN=$VITE_MONDAY_TOKEN
ENV VITE_MONDAY_BOARD_ID=$VITE_MONDAY_BOARD_ID

# Cache de deps: copia so package.json antes
COPY package.json package-lock.json* ./
RUN npm ci

# Copia o resto e builda
COPY . .

# Agora `npm run build` enxerga todas as VITE_* via import.meta.env
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
