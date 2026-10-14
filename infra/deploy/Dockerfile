# ==============================================================================
# Orazaka dev runtime — the JVM services of dev.orazaka.com in ONE image (docs/DEPLOY_DEV.md)
# ------------------------------------------------------------------------------
# Built by DigitalOcean App Platform from this repository (dockerfile_path: infra/deploy/Dockerfile,
# context: the repository root). The platform is one repository per component, so the image clones
# every repository listed in orazaka.workspace.json at its default branch — exactly what CI does —
# and builds the five services the dev environment runs, without tests (CI ran them).
# Redeploy with `doctl apps create-deployment <app> --force-rebuild`: a cached clone layer would
# otherwise keep yesterday's code.
# ==============================================================================

# ── 1. Sources: every repository of the workspace, shallow ───────────────────
FROM node:22-alpine AS sources
RUN apk add --no-cache git
WORKDIR /workspace
COPY . .
RUN node scripts/workspace.mjs clone --depth 1

# ── 2. Build the five services and what they depend on ───────────────────────
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY --from=sources /workspace /workspace
RUN \
    ./mvnw -B -ntp -q install \
      -DskipTests -DskipITs=true -Dspotless.check.skip=true -Dexec.skip=true \
      -Dskip.npm=true -Dskip.installnodenpm=true \
      -Dmaven.javadoc.skip=true -Dmaven.source.skip=true -Dgpg.skip=true \
      -pl orazaka-apps/services/orazaka-edge,krizaka/krizaka-users/krizaka-users-service,orazaka-apps/services/orazaka-conversation-service,orazaka-apps/services/orazaka-studio/orazaka-studio-service,orazaka-apps/services/orazaka-job-service \
      -am \
 && mkdir -p /out \
 && cp orazaka-apps/services/orazaka-edge/target/orazaka-edge-*[0-9T].jar /out/edge.jar \
 && cp krizaka/krizaka-users/krizaka-users-service/target/krizaka-users-service-*[0-9T].jar /out/users.jar \
 && cp orazaka-apps/services/orazaka-conversation-service/target/orazaka-conversation-service-*[0-9T].jar /out/conversation.jar \
 && cp orazaka-apps/services/orazaka-studio/orazaka-studio-service/target/orazaka-studio-service-*[0-9T].jar /out/studio.jar \
 && cp orazaka-apps/services/orazaka-job-service/target/orazaka-job-service-*[0-9T].jar /out/job.jar \
 && cp -r orazaka-packs /out/orazaka-packs

# ── 3. Runtime: a JRE, the jars, one supervisor ──────────────────────────────
FROM eclipse-temurin:21-jre
RUN groupadd --system orazaka && useradd --system --gid orazaka --create-home orazaka
WORKDIR /app
COPY --from=build /out/ /app/
COPY infra/deploy/run-services.sh /app/run-services.sh
RUN chmod 0755 /app/run-services.sh && mkdir -p /app/var/logs /app/var/orazaka-uploads && chown -R orazaka:orazaka /app
USER orazaka
EXPOSE 8088
ENTRYPOINT ["/app/run-services.sh"]
