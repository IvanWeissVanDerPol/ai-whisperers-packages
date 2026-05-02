#!/bin/bash
set -euo pipefail

# deploy.sh — Deploy a Next.js site to the AI Whisperers VPS Docker Swarm
# Usage: ./deploy.sh <project-name> <domain> [--replicas N] [--memory LIMIT] [--skip-build]
#
# Examples:
#   ./deploy.sh nicolas-duarte-site nicolas.sunstein.cloud
#   ./deploy.sh my-client-site client.ai-whisperers.com --replicas 1 --memory 512M

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="${1:?Usage: deploy.sh <project-name> <domain> [options]}"
DOMAIN="${2:?Usage: deploy.sh <project-name> <domain> [options]}"
REPLICAS="${3:-2}"
MEMORY_LIMIT="${4:-256M}"
VPS_HOST="root@72.61.44.159"
SKIP_BUILD=false

shift 2
while [[ $# -gt 0 ]]; do
  case $1 in
    --replicas) REPLICAS="$2"; shift 2 ;;
    --memory) MEMORY_LIMIT="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [ "$SKIP_BUILD" = false ]; then
  echo "→ Building Next.js project..."
  npm run build

  echo "→ Building Docker image..."
  docker build -t "$PROJECT_NAME:prod" .
fi

echo "→ Saving and compressing image..."
docker save "$PROJECT_NAME:prod" | gzip > "/tmp/$PROJECT_NAME.tar.gz"

echo "→ Transferring to VPS..."
scp "/tmp/$PROJECT_NAME.tar.gz" "$VPS_HOST:/tmp/"

echo "→ Loading image on VPS..."
ssh "$VPS_HOST" "gunzip -f /tmp/$PROJECT_NAME.tar.gz && docker load < /tmp/$PROJECT_NAME.tar.gz && rm /tmp/$PROJECT_NAME.tar.gz"

echo "→ Writing docker-compose on VPS..."
ROUTER_NAME="${PROJECT_NAME//-/}"
ssh "$VPS_HOST" "mkdir -p /opt/$PROJECT_NAME && cat > /opt/$PROJECT_NAME/docker-compose.yml << DOCKER
version: \"3.8\"

services:
  web:
    image: $PROJECT_NAME:prod
    networks:
      - agent-net
    deploy:
      mode: replicated
      replicas: $REPLICAS
      resources:
        limits:
          memory: ${MEMORY_LIMIT}
          cpus: \"0.5\"
        reservations:
          memory: 128M
          cpus: \"0.25\"
      labels:
        - \"traefik.enable=true\"
        - \"traefik.docker.network=agent-net\"
        - \"traefik.http.routers.${ROUTER_NAME}.rule=Host(\`${DOMAIN}\`)\"
        - \"traefik.http.routers.${ROUTER_NAME}.entrypoints=websecure\"
        - \"traefik.http.routers.${ROUTER_NAME}.tls=true\"
        - \"traefik.http.routers.${ROUTER_NAME}.tls.certresolver=letsencryptresolver\"
        - \"traefik.http.services.${ROUTER_NAME}.loadbalancer.server.port=3000\"
    healthcheck:
      test: [\"CMD\", \"wget\", \"--no-verbose\", \"--tries=1\", \"--spider\", \"http://127.0.0.1:3000/\"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

networks:
  agent-net:
    external: true
DOCKER"

echo "→ Deploying stack..."
ssh "$VPS_HOST" "docker stack rm $PROJECT_NAME 2>/dev/null; sleep 5; cd /opt/$PROJECT_NAME && docker stack deploy -c docker-compose.yml $PROJECT_NAME"

echo "→ Waiting for deploy..."
sleep 10
ssh "$VPS_HOST" "docker service ps ${PROJECT_NAME}_web --format 'table {{.Name}}\t{{.CurrentState}}'"

echo "→ Testing..."
curl -s -o /dev/null -w "HTTP %{http_code}" "https://$DOMAIN/" && echo " — LIVE at https://$DOMAIN/"

echo "→ Cleanup..."
rm -f "/tmp/$PROJECT_NAME.tar.gz"

echo "✅ Deploy complete!"
