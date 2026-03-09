# Contributing to APD

Thank you for your interest in contributing! APD is an opinionated personal tool that I've opened to the community. Contributions that improve reliability, performance, or usability are very welcome.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Conventions](#commit-conventions)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Issues](#reporting-issues)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to abide by its terms.

---

## Getting Started

1. **Fork** the repository and clone your fork locally.
2. Install dependencies — requires **Node.js ≥ 18** and npm.

```bash
git clone https://github.com/giancarloerra/apd.git
cd apd
npm install
cp .env.example .env
# Fill in .env with your Upstash credentials and API keys
npm run dev
```

3. Create a feature branch from `main`:

```bash
git checkout -b feat/my-feature
```

---

## Development Workflow

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start frontend (Vite) + backend (nodemon) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checks |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run build` | Production build |

### Useful tips

- **Frontend** (React + TypeScript) lives in `src/` and is bundled by Vite.
- **Backend** (Express, Node.js ES modules) lives in `server/`.
- The sky dashboard (`public/skychart.html`) and settings page (`public/settings.html`) are self-contained HTML files — keep them self-contained.
---

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

**Types:**

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style / formatting (no logic change) |
| `refactor` | Code restructuring with no behaviour change |
| `test` | Adding or improving tests |
| `chore` | Build, tooling, dependency updates |
| `perf` | Performance improvement |

Examples:

```
feat(skychart): add magnitude filter for NGC catalog
fix(auth): prevent open-redirect in login page
docs: add Railway deployment guide
```

Releases are automated with [`release-it`](https://github.com/release-it/release-it) and version bump follows [Semantic Versioning](https://semver.org/).

---

## Submitting a Pull Request

1. Make sure your branch is up to date with `main`.
2. Run `npm run lint && npm run typecheck && npm test` — all must pass.
3. Keep PRs focused: one feature or fix per PR.
4. Fill in the pull request template fully.
5. Reference any related issue with `Closes #<issue-number>` in the PR description.
6. Be patient — this is a personal project maintained in spare time!

---

## Reporting Issues

Before opening an issue, please check if it already exists. When filing a new issue, use the appropriate template:

- 🐛 **Bug report** — unexpected behaviour, crashes, bad data
- 💡 **Feature request** — ideas for new functionality
- 📖 **Documentation** — anything unclear or missing in the docs

---

## Licence

By contributing you agree that your contributions will be licensed under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later), the same licence as the project.
