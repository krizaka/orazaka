# The GPU relay of dev.orazaka.com (docs/DEPLOY_DEV.md § GPU) — a chisel server behind App Platform's TLS.
#
# The GPU droplet (or the Mac's worker) dials OUT to https://dev.orazaka.com/gpu-relay and, through one
# authenticated WebSocket, gets exactly four things and nothing else (the allow-list in entrypoint.sh):
#   forward  rabbitmq:5672   the broker, for the media worker's queue
#   forward  core:8090       the job service, for the worker registry and the output hand-over
#   reverse  :8086           the droplet's sd-server, reachable inside the app as gpu-relay:8086
#   reverse  :8188           the droplet's video pipeline (health probe), gpu-relay:8188
# RabbitMQ is never exposed, the droplet has no public port, and while no GPU is connected gpu-relay:8086
# refuses connections — which is exactly what greys the image capability out.
FROM alpine:3.22
ARG CHISEL_VERSION=1.12.0
ARG CHISEL_SHA256=f3f180f1d93aa72cce4e6386f98cc06569a0146fbd65eb4423cf83e6434bcfe6
RUN apk add --no-cache ca-certificates \
 && wget -qO /tmp/chisel.gz "https://github.com/jpillora/chisel/releases/download/v${CHISEL_VERSION}/chisel_${CHISEL_VERSION}_linux_amd64.gz" \
 && echo "${CHISEL_SHA256}  /tmp/chisel.gz" | sha256sum -c - \
 && gunzip -c /tmp/chisel.gz > /usr/local/bin/chisel && chmod 0755 /usr/local/bin/chisel && rm /tmp/chisel.gz
COPY entrypoint.sh /usr/local/bin/gpu-relay
RUN chmod 0755 /usr/local/bin/gpu-relay
USER nobody
EXPOSE 8080 8086 8188
ENTRYPOINT ["/usr/local/bin/gpu-relay"]
