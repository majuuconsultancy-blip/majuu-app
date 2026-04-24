import { Buffer } from "node:buffer";

function safeString(value, max = 400) {
  return String(value || "").trim().slice(0, max);
}

function applyCorsHeaders(req, res, methods = []) {
  const origin = safeString(req?.headers?.origin, 1000) || "*";
  const allowMethods = Array.from(
    new Set(
      ["OPTIONS", ...(Array.isArray(methods) ? methods : [])]
        .map((value) => safeString(value, 20).toUpperCase())
        .filter(Boolean)
    )
  );

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", allowMethods.join(", "));
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function json(res, status, payload) {
  res.status(Number(status || 200) || 200).json(payload);
}

export function methodNotAllowed(res, allowed = []) {
  if (Array.isArray(allowed) && allowed.length) {
    res.setHeader("Allow", allowed.join(", "));
  }
  json(res, 405, {
    ok: false,
    message: "Method not allowed.",
  });
}

export function handleCors(req, res, methods = []) {
  applyCorsHeaders(req, res, methods);
  if (safeString(req?.method, 20).toUpperCase() !== "OPTIONS") {
    return false;
  }
  res.status(204).end();
  return true;
}

export async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || "")));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

export function buildAbsoluteUrl(req, pathname = "/") {
  const safePath = safeString(pathname, 600) || "/";
  const protoHeader = safeString(req.headers?.["x-forwarded-proto"], 40).toLowerCase();
  const hostHeader = safeString(req.headers?.["x-forwarded-host"] || req.headers?.host, 300);
  const protocol = protoHeader === "http" ? "http" : "https";
  if (!hostHeader) {
    return safePath.startsWith("/") ? safePath : `/${safePath}`;
  }
  return `${protocol}://${hostHeader}${safePath.startsWith("/") ? safePath : `/${safePath}`}`;
}

export function getBearerToken(req) {
  const authHeader = safeString(req.headers?.authorization || req.headers?.Authorization, 4000);
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return safeString(authHeader.slice(7), 4000);
}
