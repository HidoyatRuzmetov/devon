# Official binary images for these releases are no longer available. Build the unchanged,
# reviewed releases from their exact official source commits; go.sum verifies dependencies.
FROM golang:1.26.8-alpine3.24@sha256:8ac98ca534ac3f51e1f420a1dd2c15e74c75cfa0f23f3ad27eb5d7236c349a0c AS source
RUN apk add --no-cache git ca-certificates
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
WORKDIR /src

FROM source AS server-build
RUN git init && git remote add origin https://github.com/minio/minio.git \
    && git fetch --depth=1 origin d0cada583fce88f60cb276ddfb06f5cb16820069 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = d0cada583fce88f60cb276ddfb06f5cb16820069
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -buildvcs=false -ldflags='-s -w' -o /out/minio .

FROM source AS client-build
RUN git init && git remote add origin https://github.com/minio/mc.git \
    && git fetch --depth=1 origin e929f89ceeedc48a45611382be9882db0bf1921d \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = e929f89ceeedc48a45611382be9882db0bf1921d
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -buildvcs=false -ldflags='-s -w' -o /out/mc .

FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS runtime
COPY --from=source /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN addgroup -g 1000 minio && adduser -D -u 1000 -G minio minio \
    && mkdir -p /data /home/minio/.mc \
    && chown -R 1000:1000 /data /home/minio
ENV HOME=/home/minio

FROM runtime AS server
LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.revision="d0cada583fce88f60cb276ddfb06f5cb16820069" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=server-build /out/minio /usr/bin/minio
COPY --from=server-build /src/LICENSE /licenses/minio-LICENSE
EXPOSE 9000 9001
USER 1000:1000
ENTRYPOINT ["minio"]

FROM runtime AS client
LABEL org.opencontainers.image.source="https://github.com/minio/mc" \
      org.opencontainers.image.revision="e929f89ceeedc48a45611382be9882db0bf1921d" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=client-build /out/mc /usr/bin/mc
COPY --from=client-build /src/LICENSE /licenses/mc-LICENSE
USER 1000:1000
ENTRYPOINT ["mc"]
