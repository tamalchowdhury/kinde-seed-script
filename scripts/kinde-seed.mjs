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
  console.log("Creating application...")

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

  console.log("Creating auth redirect URLs...")

  try {
    await api.call("POST", `/applications/${id}/auth_redirect_urls`, {
      urls: redirects,
    })
  } catch (error) {
    errors.push("Cannot create redirect urls")
  }

  console.log("Creating auth logout URLs...")

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
  console.log("Creating envioronment variable...")

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

async function createApiAndScopes(api, { name, audience, scopes = [] }) {
  console.log("Creating API and Scopes...")

  let apiObj = null

  try {
    apiObj = await api.call("POST", `/apis`, { name, audience })
    apiObj.name = name
    console.log("Created API:", name)
  } catch {
    console.log("Error creating API:", name)
    return
  }

  // You will need a Kinde paid plan
  // To add scope to your API
  for (const s of scopes) {
    try {
      await api.call("POST", `/apis/${apiObj.api.id}/scopes`, {
        key: s,
        description: s,
      })
      console.log(`Created scope "${s}" to the API ${apiObj.name}`)
    } catch (error) {
      console.log("Error creating scope:", s)
    }
  }
}

async function createRoleAndPermissions(api, role) {
  console.log("Creating roles and permissions...")

  let roleObj = null

  try {
    roleObj = await api.call("POST", `/roles`, {
      key: role.key,
      name: role.name,
    })
    roleObj.name = role.name
    console.log("Created role:", role.name)
  } catch {
    console.log("Error creating role:", role.name)
    console.log("Exiting.")

    return
  }

  const permObjs = []
  let permObj = null

  for (const p of role.permissions) {
    try {
      permObj = await api.call("POST", `/permissions`, {
        key: p.key,
        name: p.name,
      })
      permObj.name = p.name
      console.log("Permission created:", p.name)
      permObjs.push(permObj)
    } catch {
      console.log("Error creating the permission:", p.name)
    }
  }

  for (const perm of permObjs) {
    const { id } = perm.permission
    try {
      await api.call("PATCH", `/roles/${roleObj.role.id}/permissions`, {
        permissions: [{ id }],
      })
      console.log(
        `Added the permission "${perm.name}" to the role ${roleObj.name}`
      )
    } catch {
      console.log("Error creating the permission")
    }
  }
}

// Token and create the client
const token = await getToken()
const api = client(token)

// Destructuring the values
const { name, type, redirectUrls, logoutUrls } = cfg.application
const { envVars, apis, featureFlags, roles } = cfg

// Execute the script
await Promise.all([
  createApplicationWithUrls(api, name, type, redirectUrls, logoutUrls),
  ...(envVars ?? []).map((v) => createEnvVariable(api, v)),
  ...(apis ?? []).map((a) => createApiAndScopes(api, a)),
  ...(featureFlags ?? []).map((f) => createFeatureFlag(api, f)),
  ...(roles ?? []).map((r) => createRoleAndPermissions(api, r)),
])

console.log("Kinde seed complete")
