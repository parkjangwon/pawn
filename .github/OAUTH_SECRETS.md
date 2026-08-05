# OAuth client credentials (Google / GitHub)

Pawn embeds Desktop OAuth client IDs at **build time**. Users only see **Connect** in Settings — no developer Client ID form.

Desktop client secrets are not true server secrets (they ship inside the app binary), but we still keep them **out of the git tree** so public clones and PRs never see them.

## Priority (main process)

1. Runtime env `PAWN_*` (rare)
2. Optional `~/.pawn/oauth-clients.json` (power-user / migration)
3. Build-time embed (`__PAWN_OAUTH__` from electron-vite `define`)

## Local development

```bash
cp .env.example .env
# fill PAWN_GOOGLE_CLIENT_ID / SECRET and PAWN_GITHUB_CLIENT_ID / SECRET
npm run dev
```

Or keep `~/.pawn/oauth-clients.json` (already used if you connected once):

```json
{
  "googleClientId": "...",
  "googleClientSecret": "...",
  "githubClientId": "...",
  "githubClientSecret": "..."
}
```

## GitHub Actions (release)

Repo → **Settings → Secrets and variables → Actions** → add:

| Secret | Description |
|--------|-------------|
| `PAWN_GOOGLE_CLIENT_ID` | Google OAuth Desktop client ID |
| `PAWN_GOOGLE_CLIENT_SECRET` | Google client secret |
| `PAWN_GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `PAWN_GITHUB_CLIENT_SECRET` | GitHub client secret |

`.github/workflows/release.yml` passes these into `npm run build` on tag `v*` / `workflow_dispatch` only — **not** on pull_request.

CLI:

```bash
gh secret set PAWN_GOOGLE_CLIENT_ID -b '....apps.googleusercontent.com'
gh secret set PAWN_GOOGLE_CLIENT_SECRET -b 'GOCSPX-...'
gh secret set PAWN_GITHUB_CLIENT_ID -b 'Ov23...'
gh secret set PAWN_GITHUB_CLIENT_SECRET -b '...'
```

## Rotating

1. Regenerate secret in Google Cloud / GitHub Developer settings  
2. Update Actions secrets (and your local `.env`)  
3. Cut a new release so installers pick up the new embed  

## Cost

OAuth app registration for personal Desktop use is free. No Pawn backend or paid Google/GitHub product is required for Connect.
