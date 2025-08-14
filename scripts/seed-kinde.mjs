// Node 18+ (global fetch)
import fs from "node:fs/promises"

const {
  KINDE_DOMAIN,
  KINDE_CLIENT_ID,
  KINDE_CLIENT_SECRET,
  KINDE_AUDIENCE,
  KINDE_SCOPES,
  CONFIG_PATH = "./config/prod.json",
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
    const text = await res.text() // <-- see why it failed
    throw new Error(`Token error ${res.status}`)
  }
  const json = await res.json()
  return json.access_token
}

function client(token) {
  const base = `https://${process.env.KINDE_DOMAIN}`
  async function call(method, path, body) {
    const url = new URL(`/api/v1${path}`, base)
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      throw new Error(`${method} ${base} ${path} -> ${res.status}`)
    }
    return res.status === 204 ? null : res.json()
  }
  return { call }
}

// ---- Ensure helpers (shape them to the Management API you have) ----
async function createFeatureFlag(api, flag) {
  try {
    await api.call("POST", `/feature_flags`, flag)
  } catch (err) {
    console.log("Feature flags came with an error", err)
  }
}

async function createApiAndScopes(api, { key, name, scopes = [] }) {
  try {
    await api.call("POST", `/apis`, { key, name })
  } catch {}
  for (const s of scopes) {
    try {
      await api.call("POST", `/apis/${key}/scopes`, { key: s, name: s })
    } catch {}
  }
}

async function createRoleAndPermissions(api, role) {
  try {
    const roleObj = await api.call("POST", `/roles`, {
      key: role.key,
      name: role.name,
    })
    const roleId = roleObj.role.id
  } catch {}

  try {
    for (const p of role.permissions) {
      const permObj = await api.call("POST", `/permissions`, {
        key: p.key,
        name: p.name,
      })
      console.log("Permission object", permObj)
      // Check this part later
      // const { permission } = permObj
      // await api.call("PATCH", `/roles/${roleId}/permissions`, {
      //   permissions: [{ id: permission.id }],
      // })
    }
  } catch {}
  console.log("Created the roles and permissions")
}

async function createApplication(
  api,
  name,
  type,
  redirects = [],
  logouts = []
) {
  const appObj = await api.call("POST", "/applications", {
    name,
    type,
  })
  const { id } = appObj.application

  await api.call("POST", `/applications/${id}/auth_redirect_urls`, {
    urls: redirects,
  })
  await api.call("POST", `/applications/${id}/auth_logout_urls`, {
    urls: logouts,
  })

  console.log("Created application with id", id)
}

async function createEnvVars(api, items) {
  // need some work to do here
  try {
    for (const { key, value, sensitive = false } of items) {
      await api.call("POST", `/environment_variables`, {
        key,
        value,
        is_secret: sensitive,
      })
    }
    console.log("Created environment variables")
  } catch (err) {
    console.log("Could not create env variables")
  }
}

// ---- Run for this env ----
const token = await getToken()
const api = client(token)

// await Promise.all([
//   ...(cfg.apis ?? []).map((a) => ensureApiAndScopes(api, a)),
//   ...(cfg.featureFlags ?? []).map((f) => ensureFeatureFlag(api, f)),
//   ...(cfg.roles ?? []).map((r) => ensureRoleAndPermissions(api, r)),
//   ensureAppRedirects(
//     api,
//     cfg.application.name,
//     cfg.application.type,
//     cfg.application.redirectUris,
//     cfg.application.logoutUris
//   ),
//   ensureEnvVars(api, cfg.envVars ?? []),
// ])

// await Promise.all([
//   createApplication(
//     api,
//     cfg.application.name,
//     cfg.application.type,
//     cfg.application.redirectUrls,
//     cfg.application.logoutUrls
//   ),
//   createEnvVars(api, cfg.envVars ?? []),
//   ...(cfg.apis ?? []).map((a) => createApiAndScopes(api, a)),
//   ...(cfg.featureFlags ?? []).map((f) => createFeatureFlag(api, f)),
//   ...(cfg.roles ?? []).map((r) => createRoleAndPermissions(api, r)),
// ])

// Test and nail each endpoint one at a time.
await Promise.all([
  ...(cfg.featureFlags ?? []).map((f) => createFeatureFlag(api, f)),
])

console.log("Kinde seed complete")
