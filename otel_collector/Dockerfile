FROM otel/opentelemetry-collector:0.160.0@sha256:e495787f07dbe432ce763ebaf5bc3d113850e9eee2250ade7a3da6a882d0d69a

COPY otel-collector.yaml /etc/otelcol-contrib/config.yaml

CMD ["--config=/etc/otelcol-contrib/config.yaml"]