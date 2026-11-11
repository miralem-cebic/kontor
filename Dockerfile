# syntax=docker/dockerfile:1
#
# kontor as a container image (ADR 0007): a static file server for dist/. It has no API, no database and no
# volume. The data of a company stays in the folder that the browser opens (File System Access API).
#
#   docker build -t kontor .
#   docker run --rm -p 127.0.0.1:8080:8080 kontor     # then open http://localhost:8080
#
# Anything other than localhost needs HTTPS, or the browser hides the folder picker (see docs/docker.md).

# dist/ is the same for every CPU, so it is built once on the build platform and never under emulation.
FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --ignore-scripts
COPY . .
RUN npm run build

# Only this stage is built per platform: linux/amd64, linux/arm64 (Raspberry Pi, 64-bit) and linux/arm/v7 (32-bit).
FROM nginxinc/nginx-unprivileged:1.30-alpine
LABEL org.opencontainers.image.title="kontor" \
      org.opencontainers.image.description="Local invoicing and cash-basis accounting for self-employed people in Germany" \
      org.opencontainers.image.source="https://github.com/miralem-cebic/kontor" \
      org.opencontainers.image.licenses="MIT"
COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
