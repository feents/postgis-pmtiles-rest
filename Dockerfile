ARG TIPPECANOE_VERSION=2.53.0

FROM debian:bookworm-slim AS tippecanoe-builder
ARG TIPPECANOE_VERSION

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    g++ \
    libsqlite3-dev \
    make \
    zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /tmp
RUN curl -fsSL "https://github.com/felt/tippecanoe/archive/refs/tags/${TIPPECANOE_VERSION}.tar.gz" \
    -o tippecanoe.tar.gz \
  && tar -xzf tippecanoe.tar.gz \
  && make -C "tippecanoe-${TIPPECANOE_VERSION}" -j "$(nproc)"

FROM node:22-bookworm-slim
ARG TIPPECANOE_VERSION

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libsqlite3-0 \
    postgresql-client \
    zlib1g \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=tippecanoe-builder /tmp/tippecanoe-${TIPPECANOE_VERSION}/tippecanoe /usr/local/bin/tippecanoe
COPY package.json ./
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY src ./src

ENV HOST=0.0.0.0 \
  PORT=3000 \
  OUTPUT_DIR=/app/output \
  TIPPECANOE_BIN=tippecanoe \
  PSQL_BIN=psql

RUN mkdir -p /app/output

EXPOSE 3000

CMD ["npm", "start"]
