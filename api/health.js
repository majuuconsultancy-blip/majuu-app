import { handleCors, json, methodNotAllowed } from "./_lib/http.js";

export default function handler(req, res) {
  if (handleCors(req, res, ["GET"])) {
    return;
  }

  if (req.method !== "GET") {
    methodNotAllowed(res, ["GET"]);
    return;
  }

  json(res, 200, { status: "OK", message: "Backend is working." });
}
