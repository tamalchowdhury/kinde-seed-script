// Node 18+ (global fetch)
import fs from "node:fs/promises"

const {
  KINDE_DOMAIN,
  KINDE_CLIENT_ID,
  KINDE_CLIENT_SECRET,
  KINDE_AUDIENCE,
  KINDE_SCOPES,
  CONFIG_PATH,
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
    scope: KINDE_SCOPES,
  })

  const res = await fetch(`https://${KINDE_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })

  if (!res.ok) {
    const text = await res.text() // <-- see why it failed
    throw new Error(`Token error ${res.status}, ${text}`)
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

// Creates a Kinde application
async function createApplicationWithUrls(
  api,
  name,
  type,
  redirects = [],
  logouts = []
) {
  const errors = []
  let appObj = {}

  try {
    appObj = await api.call("POST", "/applications", {
      name,
      type,
    })
  } catch {
    console.log("Cannot create an application, exiting the function")
    return
  }

  const { id } = appObj.application

  try {
    await api.call("POST", `/applications/${id}/auth_redirect_urls`, {
      urls: redirects,
    })
  } catch (error) {
    errors.push("Cannot create redirect urls")
  }

  try {
    await api.call("POST", `/applications/${id}/auth_logout_urls`, {
      urls: logouts,
    })
  } catch (error) {
    errors.push("Cannot create logout urls")
  }

  console.log("Created a Kinde application with id", id)
  if (errors.length) console.log("with some errors", errors)
}

async function createEnvVariable(api, item) {
  try {
    const { key, value, sensitive = false } = item
    await api.call("POST", `/environment_variables`, {
      key,
      value,
      is_secret: sensitive,
    })
    console.log("Created environment variable", item.key)
  } catch {
    console.log("Could not create env variable", item.key)
  }
}

async function createFeatureFlag(api, flag) {
  try {
    await api.call("POST", `/feature_flags`, flag)
    console.log("Created feature flag:", flag.name)
  } catch {
    console.log("Could not create feature flag:", flag.name)
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
//   createApplicationWithUrls(
//     api,
//     cfg.application.name,
//     cfg.application.type,
//     cfg.application.redirectUrls,
//     cfg.application.logoutUrls
//   ),
//   ...(cfg.envVars ?? []).map((v) => createEnvVariable(api, v)),
//   ...(cfg.apis ?? []).map((a) => createApiAndScopes(api, a)),
//   ...(cfg.featureFlags ?? []).map((f) => createFeatureFlag(api, f)),
//   ...(cfg.roles ?? []).map((r) => createRoleAndPermissions(api, r)),
// ])

// Test and nail each endpoint one at a time.
await Promise.all([
  ...(cfg.featureFlags ?? []).map((f) => createFeatureFlag(api, f)),
])

console.log("Kinde seed complete")
