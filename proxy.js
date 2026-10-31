import { next } from "@vercel/functions";
import { readSession } from "./lib/model-studio-auth.js";

export default async function proxy(request) {
  const url = new URL(request.url);
  if (url.pathname === "/login.html" || url.pathname === "/login.js" || url.pathname === "/api/model-studio-auth") return next();
  const cookie = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("model_studio_session="));
  const session = await readSession(cookie?.slice("model_studio_session=".length) || "", process.env.MODEL_STUDIO_SESSION_SECRET);
  if (session) {
    if (url.pathname === "/admin.html" && session.role !== "admin") return Response.redirect(new URL("/", url.origin), 302);
    return next();
  }
  const loginUrl = new URL("/login.html", url.origin);
  loginUrl.searchParams.set("next", url.pathname + url.search);
  return Response.redirect(loginUrl, 302);
}
