import { handleUpload } from "@vercel/blob/client";
import { readSession } from "../lib/model-studio-auth.js";

const allowedTypes = ["image/webp", "image/png", "image/jpeg", "model/gltf-binary", "application/octet-stream", "application/zip", "application/x-zip-compressed", "application/x-rar-compressed", "application/vnd.rar"];

export default async function uploadHandler(request, response) {
  if (request.method !== "POST") { response.setHeader("Allow", "POST"); return response.status(405).json({ error: "Method not allowed." }); }
  try {
    const result = await handleUpload({
      body: request.body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const cookie = (request.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith("model_studio_session="));
        const session = await readSession(cookie?.slice("model_studio_session=".length) || "", process.env.MODEL_STUDIO_SESSION_SECRET);
        if (session?.role !== "admin") throw new Error("Admin access is required to upload project files.");
        if (typeof pathname !== "string" || !pathname.startsWith("studio-admin/")) throw new Error("Invalid project upload path.");
        return { access: "private", addRandomSuffix: true, allowedContentTypes: allowedTypes };
      },
      onUploadCompleted: async () => {},
    });
    return response.status(200).json(result);
  } catch (error) {
    return response.status(400).json({ error: error.message || "Upload could not be authorized." });
  }
}
