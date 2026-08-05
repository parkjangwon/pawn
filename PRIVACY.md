# Privacy Policy — Pawn

**Last updated:** 2026-08-05  
**Product:** Pawn (desktop AI coding agent)  
**Contact:** parkjangwon1205@gmail.com  
**Homepage:** https://github.com/parkjangwon/pawn

## Overview

Pawn is a **local desktop application**. Optional Google and GitHub connections let the app access your data **on this device only**, so the agent can help you with coding and personal productivity tasks.

## Data we access (optional, after you connect)

If you use **Settings → Connections** and authorize a provider, Pawn may receive:

### Google (read-only by default)
- Basic profile (email, name)
- Google Drive files (list/read/export)
- Google Docs, Sheets, and Slides content
- Gmail messages (read)
- Calendar events (read)
- Tasks (read)

### GitHub
- Account identity (login, email)
- Repository and organization data within the scopes you approve (e.g. `repo`, `read:user`, `user:email`, `read:org`)

You can revoke access at any time in Pawn (**Disconnect**) or in the provider account settings (Google Account / GitHub Applications).

## Where data is stored

- OAuth tokens are stored **only on your computer** under `~/.pawn/` (encrypted with the OS keychain/safe storage when available).
- Pawn **does not operate a backend** that receives your Google/GitHub tokens or Workspace content for its own servers.
- AI model providers (OpenAI, Anthropic, etc.) receive only what you send in chat when you use the agent — that is separate from OAuth token storage and is controlled by your BYOK keys and prompts.

## Data we do not sell

We do not sell your personal data. There is no advertising network in Pawn.

## Third parties

- **Google** and **GitHub** process sign-in under their own policies when you authorize Pawn.
- **LLM API providers** you configure process prompts/completions under their policies when you use the agent.

## Children

Pawn is not directed at children under 13.

## Changes

We may update this policy; the “Last updated” date will change. Continued use after updates means you accept the revised policy.

## Contact

Questions: parkjangwon1205@gmail.com or open an issue at https://github.com/parkjangwon/pawn/issues
