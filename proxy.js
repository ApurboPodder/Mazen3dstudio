import { next } from "@vercel/functions";
import { readSession, getAssignedProjects } from "./lib/model-studio-auth.js";

export default async function proxy(request) {
  const url = new URL(request.url);
  if (url.pathname === "/login.html" || url.pathname === "/login.js" || url.pathname === "/api/model-studio-auth" || url.pathname === "/api/model-studio-project-upload") return next();
  const cookie = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("model_studio_session="));
  const session = await readSession(cookie?.slice("model_studio_session=".length) || "", process.env.MODEL_STUDIO_SESSION_SECRET);
  if (session) {
    if (["/admin.html", "/admin-projects.html"].includes(url.pathname) && session.role !== "admin") return Response.redirect(new URL("/", url.origin), 302);
    if (session.role === "client") {
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return new Response("Not found", { status: 404 }); }
      if (pathname === "/studio-projects.json") return new Response("Not found", { status: 404 });
      if (pathname === "/assets/studio" || pathname.startsWith("/assets/studio/")) {
        const folder = pathname.split("/")[3];
        if (!folder) return new Response("Not found", { status: 404 });
        try {
          const allowed = await getAssignedProjects(session);
          if (!allowed.some((project) => project.folder === folder)) return new Response("Not found", { status: 404 });
        } catch { return new Response("Project access is temporarily unavailable", { status: 503 }); }
      }
    }
    return next();
  }
  const loginUrl = new URL("/login.html", url.origin);
  loginUrl.searchParams.set("next", url.pathname + url.search);
  return Response.redirect(loginUrl, 302);
}
