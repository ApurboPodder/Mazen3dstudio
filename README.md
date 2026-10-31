## Password-protect Model Studio

Model Studio supports a single administrator and multiple client accounts. The administrator signs in with the configured MODEL_STUDIO_PASSWORD, then selects Manage clients to add, modify, or delete client accounts. Clients sign in using their client ID and password. Client IDs are unique, case-insensitive usernames containing 3–32 letters, numbers, dots, underscores, or hyphens. Every account currently opens the same studio project collection.

Set the admin password and session signing secret listed in .env.example. For local Vercel development, copy it to .env.local and set the values. For deployment, add them in Vercel Project Settings → Environment Variables, then redeploy:

- MODEL_STUDIO_PASSWORD: at least 8 characters, with at least one letter and one number.
- MODEL_STUDIO_SESSION_SECRET: a separate random secret of at least 32 characters. Generate one with node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))".
- UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN: the REST URL and token for an Upstash Redis database. Client management needs these values to persist accounts across serverless requests.

Client passwords are stored as salted scrypt hashes. Account records are stored in Redis under model-studio:clients; passwords are never returned to the browser. If Redis is not configured, the admin can still sign in, but client account management and client sign-in are unavailable.

For a project deployed from the repository root, set the variables on the root Vercel project. If this folder is deployed as its own Vercel project, set them on that project. Login sessions last eight hours; the Log out button ends the session. Keep credentials in environment settings and do not commit real passwords or tokens.

## Admin project management

Administrators can open **Manage projects** from the studio header to add, modify, or delete projects. Project files are uploaded to a Vercel Blob store, then the server commits them and the updated studio-projects.json to GitHub in one commit. The project must be linked to the same GitHub repository and production branch in Vercel for commits to trigger deployments.

Configure these Vercel Production environment variables:

- GITHUB_TOKEN: a fine-grained personal access token restricted to the project repository with Contents read/write permission. Keep it server-side and private.
- GITHUB_REPOSITORY: owner/repository, such as mazen/model-studio.
- GITHUB_BRANCH: the branch connected to Vercel Production (often main).
- BLOB_READ_WRITE_TOKEN: connect a Vercel Blob store with Private access to this project; Vercel supplies this variable.

The manager accepts 4–5 images, exactly 2 GLB models, and at least one ZIP or RAR archive per project. Files up to 75 MB each can be committed. A new project needs its complete set of required files in one upload; modifying a project can replace or add files while retaining its existing files.
