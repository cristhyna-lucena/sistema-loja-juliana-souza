FROM golang:1.25-alpine AS build
ARG MINIO_COMMIT=7aac2a2c5b7c882e68c1ce017d8256be2feea27f
ENV CGO_ENABLED=0 GOMAXPROCS=2
RUN apk add --no-cache ca-certificates git
ADD https://github.com/minio/minio/archive/${MINIO_COMMIT}.tar.gz /tmp/minio.tar.gz
RUN mkdir /src && tar -xzf /tmp/minio.tar.gz -C /src --strip-components=1
WORKDIR /src
RUN go build -p 2 -trimpath -ldflags="-s -w" -o /out/minio .
FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /licenses/minio-LICENSE
COPY --from=build /src/NOTICE /licenses/minio-NOTICE
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
