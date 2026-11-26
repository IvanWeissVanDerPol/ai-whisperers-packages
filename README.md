# ai-whisperers-packages

Shared building blocks for AI Whisperers projects: design tokens, a React component library, and Docker Swarm deployment templates.

## Packages

Three independent npm packages — no workspace tooling, so build and publish each one on its own.

| Directory | Package | Contents |
| --- | --- | --- |
| `tokens/` | `@ai-whisperers/tokens` | Colour palettes (navy, dark navy, law firm), CSS custom properties, Tailwind colour maps, animation keyframes. |
| `ui/` | `@ai-whisperers/ui` | React 19 components (CVA + Tailwind): Button, Badge, Card, Skeleton, Heading, Container, Section, AnimateOnScroll. |
| `deploy/` | `@ai-whisperers/deploy` | Dockerfile and docker-compose templates plus `deploy.sh` for shipping Next.js sites to the Swarm. |

## Using the libraries

`npm install @ai-whisperers/tokens @ai-whisperers/ui`, then wire a palette and the animations into Tailwind:

```ts
import { paletteNavy, paletteToTailwindColors, animationKeyframes, animationConfig } from "@ai-whisperers/tokens";
export default { theme: { extend: {
  colors: paletteToTailwindColors(paletteNavy),
  keyframes: animationKeyframes,
  animation: animationConfig,
}}};
```

`paletteToCSS(palette)` returns the same palette as CSS custom properties. The `ui` components use the semantic classes these palettes define (`bg-primary`, …), so include the tokens theme in any project that renders them:

```tsx
import { Button, Card, Section } from "@ai-whisperers/ui";
<Section><Card><Button variant="primary">Get started</Button></Card></Section>
```

## Deploying a site

`deploy.sh` builds a Next.js project, pushes the image to the VPS and deploys it as a Docker Swarm service behind Traefik, with automatic Let's Encrypt certs.

```bash
cd deploy
./deploy.sh <project-name> <domain> [--replicas N] [--memory LIMIT] [--skip-build]
# e.g. ./deploy.sh my-client-site client.ai-whisperers.com --replicas 1 --memory 512M
```

Run it from the root of the project you are deploying — it calls `npm run build` and `docker build .`. The stack expects the external Docker network `agent-net` and serves port 3000; the `.template` files are the standalone versions.

## Building the packages

Each package builds with tsup (ESM + CJS + types): `cd tokens && npm install && npm run build` (or `ui`), and `npm run dev` rebuilds on change.

## Ownership

Maintained by **AI Whisperers** as the shared building blocks for AI Whisperers projects and client sites. Owner: Ivan Weiss van der Pol. Questions and change requests go to the AI Whisperers team (nyx@ai-whisperers.com).
