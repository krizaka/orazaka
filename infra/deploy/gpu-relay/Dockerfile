# The GPU relay of dev.orazaka.com (docs/DEPLOY_DEV.md § GPU) — a chisel server behind App Platform's TLS.
#
# The GPU droplet (or the Mac's worker) dials OUT to https://dev.orazaka.com/gpu-relay and, through one
# authenticated WebSocket, gets exactly five things and nothing else (the allow-list in entrypoint.sh):
#   forward  broker-dev.orazaka.com:5671   the TLS broker (VPC), for the media worker's queue — TLS end to end
#   forward  core:8090       the job service, for the worker registry and the output hand-over
#   reverse  :8086           the droplet's sd-server, reachable inside the app as gpu-relay:8086
#   reverse  :8188           the droplet's video pipeline (health probe), gpu-relay:8188
#   reverse  :11434          the droplet's Ollama (chat and vision of the Studios), gpu-relay:11434
# The broker is never exposed (VPC-only Droplet, krizaka/orazaka#70), the GPU droplet has no public port, and while no GPU is connected gpu-relay:8086
# refuses connections — which is exactly what greys the image capability out.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8
ARG CHISEL_VERSION=1.12.0
ARG CHISEL_SHA256=f3f180f1d93aa72cce4e6386f98cc06569a0146fbd65eb4423cf83e6434bcfe6
RUN apk add --no-cache ca-certificates \
 && wget -qO /tmp/chisel.gz "https://github.com/jpillora/chisel/releases/download/v${CHISEL_VERSION}/chisel_${CHISEL_VERSION}_linux_amd64.gz" \
 && echo "${CHISEL_SHA256}  /tmp/chisel.gz" | sha256sum -c - \
 && gunzip -c /tmp/chisel.gz > /usr/local/bin/chisel && chmod 0755 /usr/local/bin/chisel && rm /tmp/chisel.gz
COPY entrypoint.sh /usr/local/bin/gpu-relay
RUN chmod 0755 /usr/local/bin/gpu-relay
USER nobody
EXPOSE 8080 8086 8188 11434
ENTRYPOINT ["/usr/local/bin/gpu-relay"]
