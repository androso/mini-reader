# Reader web application

This package contains the Next.js frontend for Reader Platform. Run it through
the workspace root so its shared EPUB package is built first.

```bash
cp apps/web/.env.template apps/web/.env
pnpm web:dev
```

The development server listens on <http://localhost:3001> and calls the API at
`NEXT_PUBLIC_API_URL`. The production container leaves that variable empty so
Caddy serves the web application and `/api/*` from one HTTPS origin.

Useful package commands:

```bash
pnpm --filter @reader/web test
pnpm --filter @reader/web build
```

Repository-wide setup, security boundaries, contribution rules, and deployment
instructions live in the root [README](../../README.md).
