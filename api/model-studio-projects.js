import { get, del } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { readSession, getAssignedProjects } from "../lib/model-studio-auth.js";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const MAX_FILE_BYTES = 75 * 1024 * 1024;

export default async function projectsHandler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); return response.status(405).json({ error: "Method not allowed." }); }
  if (!sameOrigin(request)) return response.status(403).json({ error: "This request is not allowed." });
  const session = await sessionFor(request);
  if (!session) return response.status(401).json({ error: "Sign in to continue." });
  const action = request.body?.action;
  try {
    if (session.role === "client" && action === "list-client") {
      const assignedIds = new Set((await getAssignedProjects(session)).map((project) => project.id));
      const projects = (await listProjects()).filter((project) => assignedIds.has(project.id));
      return response.status(200).json({ projects });
    }
    if (session.role !== "admin") return response.status(403).json({ error: "Admin access is required." });
    if (action === "list") return response.status(200).json({ projects: await listProjects() });
    if (action === "save") return response.status(200).json(await saveProject(request.body || {}));
    if (action === "discard") { await cleanupUploads(request.body?.files); return response.status(200).json({ ok: true }); }
    if (action === "delete") return response.status(200).json(await deleteProject(request.body?.projectId));
    return response.status(400).json({ error: "Unknown project action." });
  } catch (error) {
    return response.status(error.status || 503).json({ error: error.message || "Project management is unavailable." });
  }
}

async function sessionFor(request) {
  const cookie = (request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("model_studio_session="));
  return readSession(cookie?.slice("model_studio_session=".length) || "", process.env.MODEL_STUDIO_SESSION_SECRET);
}
function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === String(host).split(",")[0].trim(); } catch { return false; }
}
function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_BRANCH || "main";
  if (!token || !repo || !/^[^/]+\/[^/]+$/.test(repo)) throw Object.assign(new Error("Project publishing is not configured. Set GITHUB_TOKEN, GITHUB_REPOSITORY (owner/repo), and GITHUB_BRANCH in Vercel."), { status: 503 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw Object.assign(new Error("Project file storage is not configured. Create a Vercel Blob store and add its BLOB_READ_WRITE_TOKEN to this project."), { status: 503 });
  return { token, repo, branch };
}
async function github(path, options = {}) {
  const { token, repo } = config();
  const response = await fetch(API + "/repos/" + repo + path, { ...options, headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": API_VERSION, "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? "GitHub rejected the token. Check that it has repository Contents read and write access." : response.status === 404 ? "The configured GitHub repository, branch, or file was not found." : (data.message || "GitHub rejected the project update.");
    throw Object.assign(new Error(message), { status: response.status === 409 || response.status === 422 ? 409 : 503 });
  }
  return data;
}
function branchPath(branch) { return branch.split("/").map(encodeURIComponent).join("/"); }
async function readManifest() {
  const { branch } = config();
  const file = await github("/contents/studio-projects.json?ref=" + encodeURIComponent(branch));
  return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
}
function folderFor(project) {
  if (project.folder) {
    if (project.folder.includes("/") || project.folder.includes(String.fromCharCode(92)) || [...project.folder].some((char) => char.charCodeAt(0) < 32) || project.folder === "." || project.folder === "..") throw Object.assign(new Error("A project has an invalid folder path."), { status: 400 });
    return project.folder;
  }
  const decoded = decodeURIComponent(project.model || "");
  if (!decoded.startsWith("assets/studio/")) throw Object.assign(new Error("A project has an invalid asset path."), { status: 400 });
  const folder = decoded.split("/")[2];
  if (!folder || folder === "." || folder === "..") throw Object.assign(new Error("A project has an invalid folder path."), { status: 400 });
  return folder;
}
function publicProject(project) { return { ...project, folder: folderFor(project), cover: project.images?.[0] || "" }; }
async function listProjects() { return (await readManifest()).map(publicProject); }
function cleanTitle(value) {
  if (typeof value !== "string") throw Object.assign(new Error("Enter a project title."), { status: 400 });
  const title = value.trim().slice(0, 80);
  if (!title || /[\/\\\x00-\x1f]/.test(title) || title === "." || title === "..") throw Object.assign(new Error("Use a project title without slashes or control characters."), { status: 400 });
  return title;
}
function slug(value) { return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"; }
function cleanFilename(value) {
  if (typeof value !== "string" || value.length > 180 || value === "." || value === ".." || /[\/\\\x00-\x1f]/.test(value)) throw Object.assign(new Error("Uploaded filenames must be simple file names."), { status: 400 });
  return value;
}
function pathFor(folder, filename) { return "assets/studio/" + folder + "/" + filename; }
function encodedAsset(path) { return path.split("/").map((part) => encodeURIComponent(part)).join("/"); }
function validateFiles(project, files) {
  const images = files.filter((name) => /\.(webp|png|jpe?g)$/i.test(name));
  const models = files.filter((name) => /\.glb$/i.test(name));
  const archives = files.filter((name) => /\.(zip|rar)$/i.test(name));
  if (images.length < 4 || images.length > 5 || models.length !== 2 || archives.length < 1) throw Object.assign(new Error("Each project needs 4 or 5 images, exactly 2 GLB models, and at least one ZIP or RAR archive. Upload files that complete or replace that set."), { status: 400 });
  const sorted = [...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const model = sorted.find((name) => /glb1\.glb$/i.test(name)) || models[0];
  const visibleModel = sorted.find((name) => /glb2\.glb$/i.test(name)) || models.find((name) => name !== model);
  const archive = sorted.find((name) => /\.(zip|rar)$/i.test(name));
  return { ...project, model: encodedAsset(pathFor(project.folder, model)), visibleModel: encodedAsset(pathFor(project.folder, visibleModel)), images: images.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"})).map((name)=>encodedAsset(pathFor(project.folder,name))), downloadArchive: encodedAsset(pathFor(project.folder,archive)) };
}
async function contents(folder) {
  const path = "assets/studio/" + folder;
  return github("/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(config().branch));
}
async function currentCommit() {
  const { branch } = config();
  const ref = await github("/git/ref/heads/" + branchPath(branch));
  const commit = await github("/git/commits/" + ref.object.sha);
  return { ref, commit };
}
async function makeCommit(changes, message) {
  const { branch } = config();
  const { ref, commit } = await currentCommit();
  const tree = await github("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha, tree: changes }) });
  const nextCommit = await github("/git/commits", { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
  await github("/git/refs/heads/" + branchPath(branch), { method: "PATCH", body: JSON.stringify({ sha: nextCommit.sha, force: false }) });
  return { commit: nextCommit.sha, url: nextCommit.html_url };
}
async function cleanupUploads(files) {
  const paths = (Array.isArray(files) ? files : []).map((item) => item?.pathname).filter((pathname) => typeof pathname === "string" && pathname.startsWith("studio-admin/"));
  await Promise.all(paths.map((pathname) => del(pathname, { access: "private" }).catch(() => {})));
}
async function uploadedBlob(item) {
  if (!item || typeof item.pathname !== "string" || !item.pathname.startsWith("studio-admin/")) throw Object.assign(new Error("An uploaded file is invalid or expired."), { status: 400 });
  const result = await get(item.pathname, { access: "private" });
  if (!result || result.statusCode !== 200) throw Object.assign(new Error("An uploaded file could not be retrieved. Please upload it again."), { status: 400 });
  const chunks = [];
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
  const data = Buffer.concat(chunks);
  if (data.length > MAX_FILE_BYTES) throw Object.assign(new Error("Each project file must be 75 MB or smaller to commit to GitHub."), { status: 400 });
  return data;
}
async function commitBlob(path, data) {
  const result = await github("/git/blobs", { method: "POST", body: JSON.stringify({ content: data.toString("base64"), encoding: "base64" }) });
  return { path, mode: "100644", type: "blob", sha: result.sha };
}
async function saveProject(body) {
  const action = body.operation;
  if (action !== "add" && action !== "update") throw Object.assign(new Error("Choose add or update."), { status: 400 });
  const title = cleanTitle(body.title);
  const manifest = await readManifest();
  let index = action === "update" ? manifest.findIndex((project) => project.id === body.projectId) : -1;
  if (action === "update" && index < 0) throw Object.assign(new Error("Project not found. Reload the page and try again."), { status: 404 });
  const folder = action === "update" ? folderFor(manifest[index]) : slug(title);
  if (action === "add" && manifest.some((project) => folderFor(project).toLowerCase() === folder.toLowerCase())) throw Object.assign(new Error("A project with a similar folder name already exists."), { status: 409 });
  let existing = [];
  if (action === "update") existing = await contents(folder);
  const names = new Map((existing || []).filter((item) => item.type === "file").map((item) => [item.name, item.path]));
  const uploads = Array.isArray(body.files) ? body.files : [];
  if (action === "add" && uploads.length < 7) throw Object.assign(new Error("Choose the project images, two GLB models, and a ZIP or RAR archive."), { status: 400 });
  const cleanUploads = uploads.map((item) => ({ pathname: item.pathname, name: cleanFilename(item.name) }));
  if (new Set(cleanUploads.map((item) => item.name.toLowerCase())).size !== cleanUploads.length) throw Object.assign(new Error("Choose each filename only once."), { status: 400 });
  for (const item of cleanUploads) names.set(item.name, pathFor(folder, item.name));
  const project = action === "update" ? { ...manifest[index], title, folder } : { id: slug(title) + "-" + randomUUID().slice(0, 8), title, folder };
  if (action === "add" && manifest.some((entry) => entry.id === project.id)) project.id += "-" + Math.random().toString(36).slice(2, 7);
  const validProject = validateFiles(project, [...names.keys()]);
  const changes = [];
  const staged = cleanUploads.map((item) => item.pathname);
  try {
    for (const item of cleanUploads) {
      const data = await uploadedBlob(item);
      changes.push(await commitBlob(pathFor(folder, item.name), data));
    }
    if (action === "add") {
      for (const [name, filePath] of names) if (!cleanUploads.some((item) => item.name === name)) throw Object.assign(new Error("All files for a new project must be uploaded together."), { status: 400 });
    }
    if (action === "add") manifest.push(validProject); else manifest[index] = validProject;
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    changes.push(await commitBlob("studio-projects.json", manifestBytes));
    const result = await makeCommit(changes, (action === "add" ? "Add" : "Update") + " Model Studio project: " + title);
    await cleanupUploads(staged.map((pathname) => ({ pathname })));
    return { ok: true, project: publicProject(validProject), commit: result.commit, commitUrl: result.url };
  } catch (error) {
    await Promise.all(staged.map((pathname) => del(pathname, { access: "private" }).catch(() => {})));
    throw error;
  }
}
async function deleteProject(projectId) {
  const manifest = await readManifest();
  const index = manifest.findIndex((project) => project.id === projectId);
  if (index < 0) throw Object.assign(new Error("Project not found. Reload the page and try again."), { status: 404 });
  const project = manifest[index];
  const folder = folderFor(project);
  const existing = await contents(folder);
  const changes = existing.filter((item) => item.type === "file").map((item) => ({ path: item.path, mode: "100644", type: "blob", sha: null }));
  manifest.splice(index, 1);
  changes.push(await commitBlob("studio-projects.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n")));
  const result = await makeCommit(changes, "Delete Model Studio project: " + project.title);
  return { ok: true, commit: result.commit, commitUrl: result.url };
}
