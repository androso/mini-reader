# Contributing to Reader Platform

Reader Platform welcomes focused bug fixes, security hardening, documentation
improvements, and features that preserve its compact self-hosted architecture.

## Before opening a pull request

1. Search existing issues and pull requests. Open an issue before proposing a
   large feature or a change to public API, authentication, persistence, or
   deployment boundaries.
2. Keep the default runtime to the API, web application, and PostgreSQL with
   pgvector. Do not introduce mandatory Redis, BullMQ, Chroma, a separate
   worker, or multi-service cloud infrastructure.
3. Never commit uploaded books, database files, environment files, credentials,
   production data, or copyrighted test fixtures.
4. Add focused tests for changed behavior and update the public documentation
   when a command, environment variable, or API contract changes.

## Development workflow

Use Node.js 22 and pnpm 10.11.1. Follow the setup in `README.md`, then run:

```bash
pnpm test
pnpm build
pnpm format:check
pnpm audit --prod --audit-level high
git diff --check
```

Create a topic branch, write a clear commit message, and open a pull request
against `main`. Pull requests must pass the required checks, resolve review
conversations, and keep unrelated changes out of the diff.

## License

By submitting a contribution, you agree that it is your original work, that you
have the right to submit it, and that it is licensed under Apache-2.0 under the
project's normal inbound-equals-outbound contribution terms.

All contributors must follow `CODE_OF_CONDUCT.md`.
