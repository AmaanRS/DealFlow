FROM otel/opentelemetry-collector@sha256:0e5de4ea2076f13e8a471411403ba49f9dda49f4e07962cad4f380fc7e667f01

COPY otel-collector.yaml /etc/otelcol-contrib/config.yaml

CMD ["--config=/etc/otelcol-contrib/config.yaml"]