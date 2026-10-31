## Password-protect Model Studio

Model Studio supports a single administrator and multiple client accounts. The administrator signs in with the configured MODEL_STUDIO_PASSWORD, then selects Manage clients to add, modify, or delete client accounts. Clients sign in using their client ID and password. Client IDs are unique, case-insensitive usernames containing 3–32 letters, numbers, dots, underscores, or hyphens. Every account currently opens the same studio project collection.

Set the admin password and session signing secret listed in .env.example. For local Vercel development, copy it to .env.local and set the values. For deployment, add them in Vercel Project Settings → Environment Variables, then redeploy:

- MODEL_STUDIO_PASSWORD: at least 8 characters, with at least one letter and one number.
- MODEL_STUDIO_SESSION_SECRET: a separate random secret of at least 32 characters. Generate one with node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))".
- UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN: the REST URL and token for an Upstash Redis database. Client management needs these values to persist accounts across serverless requests.

Client passwords are stored as salted scrypt hashes. Account records are stored in Redis under model-studio:clients; passwords are never returned to the browser. If Redis is not configured, the admin can still sign in, but client account management and client sign-in are unavailable.

For a project deployed from the repository root, set the variables on the root Vercel project. If this folder is deployed as its own Vercel project, set them on that project. Login sessions last eight hours; the Log out button ends the session. Keep credentials in environment settings and do not commit real passwords or tokens.
