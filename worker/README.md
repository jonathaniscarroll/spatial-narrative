# Publish proxy (classroom mode)

The authoring tool no longer asks for a GitHub token. Students type a **class code**; this Cloudflare Worker holds the real GitHub token as a secret and makes the commit.

## One-time setup

1. Create a fine-grained GitHub token for `jonathaniscarroll/spatial-narrative` with **Contents: Read and write** only.
2. In this folder:
   ```
   npx wrangler login
   npx wrangler secret put GITHUB_TOKEN
   npx wrangler secret put CLASS_CODE
   npx wrangler deploy
   ```
3. Copy the deployed URL (e.g. `https://spatial-narrative-publish.<you>.workers.dev`) into `PUBLISH_URL` at the top of the script in `author/index.html`, then commit.
4. Give students the class code. Rotate it each term with `wrangler secret put CLASS_CODE`.

## What the Worker allows

- `GET /file` returns the current `story/main.twee` and its blob SHA (no code needed; the repo is public).
- `POST /publish` requires the `X-Class-Code` header. It accepts only `story/main.twee` plus `media/<safe-filename>`, and writes everything as **one commit** to `main` using the Git Data API.
- If `story/main.twee` changed after the student loaded it, the Worker returns 409 instead of overwriting.

## Limits

All students share one `main.twee` and one class code, so everyone with the code can edit the live story. The conflict check prevents silent overwrites but not edits you don't want.
