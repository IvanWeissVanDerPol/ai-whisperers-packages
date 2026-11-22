# Deploying a Next.js site to Docker Swarm

The `deploy/` package publishes a Next.js site to the AI Whisperers VPS, where it runs as a
Docker Swarm service behind Traefik. It ships `deploy.sh` (the end-to-end script),
`Dockerfile.template` (a reference Dockerfile) and `docker-compose.template.yml` (a reference
service definition).

## Prerequisites

- **Docker locally** — `docker build` and `docker save` run on your machine.
- **Node.js and npm** in the site project, with a working `build` script.
- **SSH access to the VPS** — the script uses `ssh` and `scp` as root and writes to `/opt/<project>` on the remote host.
- **`VPS_HOST`** — the SSH target of the VPS. `deploy.sh` hardcodes it to `root@72.61.44.159` (`deploy/deploy.sh:16`); change that line to deploy elsewhere.
- **On the VPS** — Docker in Swarm mode, the external network `agent-net`, and Traefik attached to it with a certificate resolver named `letsencryptresolver`.

## What `deploy.sh` does

Run it from the root of the site project:

```bash
./deploy.sh <project-name> <domain> [--replicas N] [--memory LIMIT] [--skip-build]
```

1. **Builds the site and the image.** `npm run build`, then `docker build -t <project>:prod .` in the
   current directory. The project needs a `Dockerfile` like `Dockerfile.template`: a multi-stage
   `node:20-alpine` build that emits the Next.js standalone output, copies `.next/standalone`,
   `.next/static`, `public/` and `content/`, and runs as the non-root `nextjs` user on port 3000 —
   which requires `output: "standalone"` in `next.config`. Use `--skip-build` to reuse an image that
   already exists locally.
2. **Packages the image.** `docker save <project>:prod | gzip > /tmp/<project>.tar.gz`.
3. **Transfers and loads it.** `scp` the tarball to the VPS, then `gunzip` it, `docker load` it and
   delete the remote copy.
4. **Writes the compose file.** The script expands the compose template with the project name,
   domain, replica count and memory limit, and writes `/opt/<project>/docker-compose.yml` on the
   VPS. It renders the template inline rather than reading the file at runtime, so keep both in
   sync when you edit either one.
5. **Deploys the stack.** `docker stack rm <project>` (failure ignored), then `docker stack deploy
   -c docker-compose.yml <project>`. The stack is replaced, so every deploy causes a short
   downtime.
6. **Waits and tests.** A 10-second pause, then `docker service ps` and a `curl` against
   `https://<domain>/`. The local tarball is deleted at the end.

## The compose template

`deploy/docker-compose.template.yml` defines one replicated service, `web`, running the image
`<project>:prod`. `deploy.sh` fills in its placeholders: `PROJECT_NAME`, `DOMAIN`, `ROUTER_NAME`
(the project name without dashes, which namespaces the Traefik labels), `REPLICAS` (default 2),
`MEMORY_LIMIT` (default `256M`), `CPU_LIMIT` (`0.5`), `MEMORY_RESERVE` (`128M`) and `CPU_RESERVE`
(`0.25`). A healthcheck runs `wget` against `http://127.0.0.1:3000/` every 30 seconds.

## The `agent-net` network and Traefik routing

The service joins the external Docker network `agent-net`, shared with the Traefik container on the VPS
and created beforehand with `docker network create agent-net`, so Traefik reaches it without exposing ports.

Traefik discovers the service through labels:

- `traefik.enable=true` — registers the service with the proxy.
- `traefik.docker.network=agent-net` — the network Traefik should use.
- `traefik.http.routers.<router>.rule=Host(\`<domain>\`)` — routes only that host.
- `traefik.http.routers.<router>.entrypoints=websecure` — serves it over HTTPS.
- `traefik.http.routers.<router>.tls=true` and
  `traefik.http.routers.<router>.tls.certresolver=letsencryptresolver` — issue the certificate
  through the resolver named `letsencryptresolver` in Traefik's static config.
- `traefik.http.services.<router>.loadbalancer.server.port=3000` — the container port.

## Verifying the deployment

```bash
docker stack ps <project>              # replicas running
docker service ps <project>_web         # task states: Running vs unhealthy
docker service logs -f <project>_web    # application logs
docker network inspect agent-net        # service attached to the shared network
curl -I https://<domain>/               # expect HTTP 200
```

If a task stays unhealthy, the `wget` healthcheck against port 3000 is failing — check the service
logs. If the domain does not resolve or the certificate is wrong, check the Traefik container's logs.
