# Reflect server image (fork addition): the graph server plus the built web
# app, deployed on Fly.io (or any Docker host) with the graph on a volume.
#
# Build the web app BEFORE the image (it needs no Linux toolchain):
#   VITE_REFLECT_REMOTE=1 pnpm --filter @reflect/desktop build

FROM node:24-slim AS build
RUN npm install -g pnpm@11.9.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @reflect/server...
# A self-contained /srv/server: the server package plus its workspace deps
# (core/db/utils travel as source; tsx runs them directly).
RUN pnpm --filter @reflect/server deploy --prod /srv/server

FROM node:24-slim
# git: the backup loop shells out to it. openssh-client: SSH remotes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/server
COPY --from=build /srv/server .
COPY crates/index-schema/migrations /srv/migrations
COPY apps/desktop/dist /srv/web

ENV NODE_ENV=production \
    REFLECT_MIGRATIONS_DIR=/srv/migrations \
    REFLECT_WEB_DIST=/srv/web \
    REFLECT_GRAPH_DIR=/data/graph \
    REFLECT_DATA_DIR=/data/server \
    REFLECT_SECURE_COOKIES=1 \
    PORT=8787

EXPOSE 8787
CMD ["node_modules/.bin/tsx", "src/main.ts"]
