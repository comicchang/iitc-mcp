## Summary

<!-- Describe what this PR changes and why. -->

## Type of Change

- [ ] Bug fix
- [ ] New MCP tool or protocol enhancement
- [ ] Refactor / performance / memory improvement
- [ ] Documentation / CI / packaging

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes with zero warnings/errors
- [ ] `npm run build` succeeds (and `dist/server/cli.mjs` is rebuilt if server code changed)
- [ ] `npm test` and `npm run test:smoke` pass
- [ ] Unit tests added or updated for new/changed behavior
- [ ] New destructive tools include `destructiveHint: true` and are gated by `--read-only`
- [ ] Documentation (`README.md` / `README_zh.md` / `SECURITY.md`) updated if behavior changed
