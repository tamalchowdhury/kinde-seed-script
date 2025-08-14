// Node 18+ (global fetch)
import fs from "node:fs/promises"

const {
  KINDE_DOMAIN,
  KINDE_CLIENT_ID,
  KINDE_CLIENT_SECRET,
  KINDE_AUDIENCE,
  KINDE_SCOPES,
  CONFIG_PATH = "./config/app.json",
} = process.env

if (
  !KINDE_DOMAIN ||
  !KINDE_CLIENT_ID ||
  !KINDE_CLIENT_SECRET ||
  !KINDE_AUDIENCE
) {
  throw new Error("Missing Kinde env vars")
}

const cfg = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"))
const app = cfg.application
if (!app?.key) throw new Error("config.application.key is required")

async function getToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: KINDE_CLIENT_ID,
    client_secret: KINDE_CLIENT_SECRET,
    audience: KINDE_AUDIENCE,
    scope: KINDE_SCOPES, // space-separated
  })

  const res = await fetch(`https://${KINDE_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token error ${res.status}: ${text}`)
  }
  const json = await res.json()
  return json.access_token
}

function client(token) {
  const base = `https://${KINDE_DOMAIN}/api/v1`
  async function call(method, path, body) {
    const url = new URL(path, base)
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`${method} ${path} -> ${res.status} ${text}`)
    }
    return res.status === 204 ? null : res.json()
  }
  return { call }
}

// --- minimal app bootstrap ---
async function ensureApplication(api, { key, name }) {
  // Try create; if it already exists, ignore the conflict
  try {
    await api.call("POST", `/applications`, { key, name })
    console.log(`Created application: ${key}`)
  } catch (e) {
    // If it's a conflict/exists, proceed; otherwise rethrow
    if (!/409|already exists/i.test(String(e))) {
      console.warn(`POST /applications failed; attempting GET: ${e.message}`)
      // Optional: confirm it exists
      await api.call("GET", `/applications/${key}`)
    } else {
      console.log(`Application ${key} already exists`)
    }
  }
}

async function setAppUrls(api, key, redirects = [], logouts = []) {
  if (redirects.length) {
    await api.call("PATCH", `/applications/${key}/redirect_uris`, {
      uris: redirects,
    })
    console.log(`Updated redirect URIs for ${key}`)
  }
  if (logouts.length) {
    await api.call("PATCH", `/applications/${key}/logout_uris`, {
      uris: logouts,
    })
    console.log(`Updated logout URIs for ${key}`)
  }
}

const token = await getToken()
const api = client(token)

await ensureApplication(api, { key: app.key, name: app.name ?? app.key })
await setAppUrls(api, app.key, app.redirectUris ?? [], app.logoutUris ?? [])

console.log("Kinde app seed complete")
