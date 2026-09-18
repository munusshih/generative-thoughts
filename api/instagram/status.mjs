export default function handler(request, response) {
  setCors(request, response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") return response.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const configured = Boolean(
    process.env.INSTAGRAM_USER_ID
      && process.env.INSTAGRAM_ACCESS_TOKEN
      && process.env.PUBLISH_SECRET
      && process.env.BLOB_READ_WRITE_TOKEN
  );

  return response.status(200).json({
    configured,
    username: configured ? process.env.INSTAGRAM_USERNAME || null : null,
  });
}
function setCors(request, response) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
  const requestOrigin = request.headers.origin;
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Publish-Secret");
  response.setHeader("Cache-Control", "no-store");
}
