// Spatial Narrative publish proxy (Cloudflare Worker)
// Holds the GitHub token as a secret so students only need a class code.
// Secrets (wrangler secret put): GITHUB_TOKEN, CLASS_CODE
// Vars (wrangler.toml): OWNER, REPO, BRANCH, ALLOWED_ORIGIN

const MAIN_PATH = 'story/main.twee';
const MEDIA_RE = /^media\/[A-Za-z0-9._-]+$/;
const MAX_FILES = 20;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, X-Class-Code',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) }
  });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function gh(env, path, opts = {}) {
  const headers = {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'spatial-narrative-publish',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch('https://api.github.com/repos/' + env.OWNER + '/' + env.REPO + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, 'GitHub: ' + (data.message || res.status));
  return data;
}

function decodeBase64Utf8(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function handleLoad(env) {
  const data = await gh(env, '/contents/' + MAIN_PATH + '?ref=' + env.BRANCH);
  return json(env, 200, { content: decodeBase64Utf8(data.content), sha: data.sha });
}

async function handlePublish(req, env) {
  const code = req.headers.get('X-Class-Code') || '';
  if (!env.CLASS_CODE || !safeEqual(code, env.CLASS_CODE)) throw new HttpError(401, 'Wrong class code.');

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.files) || body.files.length === 0) throw new HttpError(400, 'No files.');
  if (body.files.length > MAX_FILES) throw new HttpError(400, 'Too many files.');

  // Allow-list: story/main.twee, plus media/<safe-name>. Nothing else.
  for (const f of body.files) {
    if (typeof f.path !== 'string' || typeof f.contentBase64 !== 'string') throw new HttpError(400, 'Bad file entry.');
    if (f.path !== MAIN_PATH && !MEDIA_RE.test(f.path)) throw new HttpError(403, 'Path not allowed: ' + f.path);
  }
  if (!body.files.some(f => f.path === MAIN_PATH)) throw new HttpError(400, MAIN_PATH + ' must be included.');

  const message = (typeof body.message === 'string' && body.message.trim() ? body.message.trim() : 'Update story via authoring tool').slice(0, 200);

  const ref = await gh(env, '/git/ref/heads/' + env.BRANCH);
  const parentSha = ref.object.sha;
  const parent = await gh(env, '/git/commits/' + parentSha);

  // Conflict check: refuse if main.twee changed since the student loaded it.
  if (body.baseSha) {
    const current = await gh(env, '/contents/' + MAIN_PATH + '?ref=' + env.BRANCH);
    if (current.sha !== body.baseSha) {
      throw new HttpError(409, 'story/main.twee changed since you loaded it. Reload, then re-apply your edits.');
    }
  }

  const tree = [];
  let mainBlobSha = null;
  for (const f of body.files) {
    const blob = await gh(env, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: f.contentBase64, encoding: 'base64' })
    });
    if (f.path === MAIN_PATH) mainBlobSha = blob.sha;
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const newTree = await gh(env, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: parent.tree.sha, tree })
  });
  const commit = await gh(env, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] })
  });
  await gh(env, '/git/refs/heads/' + env.BRANCH, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha })
  });

  return json(env, 200, { commit: commit.sha, mainSha: mainBlobSha });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/file') return await handleLoad(env);
      if (req.method === 'POST' && url.pathname === '/publish') return await handlePublish(req, env);
      throw new HttpError(404, 'Not found.');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json(env, status, { error: e.message || 'Server error' });
    }
  }
};
