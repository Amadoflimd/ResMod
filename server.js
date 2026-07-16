const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const util = require("node:util");

const gunzip = util.promisify(zlib.gunzip);
const inflate = util.promisify(zlib.inflate);
const brotliDecompress = util.promisify(zlib.brotliDecompress);
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ENABLE_GOOGLE_SIGNIN = (process.env.ENABLE_GOOGLE_SIGNIN || "false").toLowerCase() === "true";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
     req.on("error", reject);
  });
}

async function decompressBody(body, encoding) {
  if (!encoding) return body;
  const enc = encoding.toLowerCase();
  try {
    if (enc === "gzip") return await gunzip(body);
    if (enc === "deflate") return await inflate(body);
    if (enc === "br") return await brotliDecompress(body);
  } catch {
    // If decompression fails, return the raw bytes.
  }
  return body;
}

// ===== SESSIONS & AUTH =====
const sessions = new Map();
const jwksCache = { keys: {}, fetchedAt: 0 };

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name && rest.length > 0) cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function signValue(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function setSessionCookie(res, sessionId) {
  const signature = signValue(sessionId);
  res.setHeader(
    "Set-Cookie",
    `resmod_session=${sessionId}.${signature}; Path=/; HttpOnly; SameSite=Lax`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "resmod_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const value = cookies.resmod_session;
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot === -1) return null;
  const sessionId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (signature !== signValue(sessionId)) return null;
  return sessions.get(sessionId) || null;
}

function createSession(user) {
  const sessionId = crypto.randomBytes(24).toString("base64url");
  sessions.set(sessionId, { user, createdAt: Date.now() });
  return sessionId;
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function fetchJson(urlStr) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.get(parsed, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error("Invalid JSON response"));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("Timeout")));
  });
}

async function getGooglePublicKey(kid) {
  const now = Date.now();
  if (now - jwksCache.fetchedAt > 60 * 60 * 1000 || !jwksCache.keys[kid]) {
    const data = await fetchJson("https://www.googleapis.com/oauth2/v3/certs");
    jwksCache.keys = {};
    for (const key of data.keys || []) {
      if (key.kid) jwksCache.keys[key.kid] = key;
    }
    jwksCache.fetchedAt = now;
  }
  const jwk = jwksCache.keys[kid];
  if (!jwk) throw new Error("Unable to find matching public key");
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

async function verifyGoogleIdToken(idToken) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");

  const header = JSON.parse(base64UrlDecode(parts[0]).toString("utf8"));
  const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf8"));

  if (header.alg !== "RS256") throw new Error("Unsupported algorithm");
  if (!header.kid) throw new Error("Missing key id");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("Token expired");
  if (payload.iss && !["https://accounts.google.com", "accounts.google.com"].includes(payload.iss)) {
    throw new Error("Invalid issuer");
  }
  if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) {
    throw new Error("Invalid audience");
  }
  if (!payload.sub) throw new Error("Missing subject");

  const publicKey = await getGooglePublicKey(header.kid);
  const data = `${parts[0]}.${parts[1]}`;
  const signature = base64UrlDecode(parts[2]);
  const valid = crypto.verify("RSA-SHA256", data, publicKey, signature);
  if (!valid) throw new Error("Invalid token signature");

  return payload;
}

// ===== CLOUD SYNC (Postgres-backed providers: Neon, Aiven, etc.) =====
function sanitizeIdentifier(name) {
  return (name || "resmod_data").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 63);
}

async function pgUpsert(connectionString, table, userId, payload) {
  let pg;
  try {
    pg = require("pg");
  } catch {
    throw new Error("PostgreSQL driver (pg) is not installed. Run: npm install pg");
  }
  const safeTable = sanitizeIdentifier(table);
  const { Client } = pg;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${safeTable} (
        user_id TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await client.query(
      `INSERT INTO ${safeTable} (user_id, payload) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET payload = $2, updated_at = CURRENT_TIMESTAMP`,
      [userId, JSON.stringify(payload)]
    );
  } finally {
    await client.end();
  }
}

async function pgSelect(connectionString, table, userId) {
  let pg;
  try {
    pg = require("pg");
  } catch {
    throw new Error("PostgreSQL driver (pg) is not installed. Run: npm install pg");
  }
  const safeTable = sanitizeIdentifier(table);
  const { Client } = pg;
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`SELECT payload FROM ${safeTable} WHERE user_id = $1`, [userId]);
    return result.rows[0]?.payload || null;
  } finally {
    await client.end();
  }
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function proxyRequest(clientRes, requestData) {
  return new Promise((resolve) => {
    const { targetUrl, method, headers, body, followRedirects, timeout } = requestData;

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      clientRes.writeHead(400, { "Content-Type": "application/json" });
      clientRes.end(JSON.stringify({ error: "Invalid URL", details: "The provided URL is not valid." }));
      return resolve();
    }

    const isHttps = parsedUrl.protocol === "https:";
    const transport = isHttps ? https : http;

    const reqHeaders = { ...headers };
    if (body && !reqHeaders["content-length"] && !reqHeaders["Content-Length"]) {
      const bodyBuffer = Buffer.from(body, "utf8");
      reqHeaders["content-length"] = String(bodyBuffer.length);
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      headers: reqHeaders,
      rejectUnauthorized: false,
    };

    const timeoutMs = timeout ? parseInt(timeout, 10) : 30000;

    const startTime = Date.now();
    const proxyReq = transport.request(options, (proxyRes) => {
      const elapsed = Date.now() - startTime;
      const responseChunks = [];

      proxyRes.on("data", (chunk) => responseChunks.push(chunk));
      proxyRes.on("end", async () => {
        const rawBody = Buffer.concat(responseChunks);
        const responseHeaders = proxyRes.headers;
        const statusCode = proxyRes.statusCode;
        const decodedBody = await decompressBody(rawBody, responseHeaders["content-encoding"]);

        const responsePayload = {
          status: statusCode,
          statusText: proxyRes.statusMessage,
          headers: responseHeaders,
          body: decodedBody.toString("utf8"),
          elapsed,
          size: decodedBody.length,
        };

        clientRes.writeHead(200, { "Content-Type": "application/json" });
        clientRes.end(JSON.stringify(responsePayload));
        resolve();
      });
    });

    proxyReq.setTimeout(timeoutMs, () => {
      proxyReq.destroy();
      clientRes.writeHead(504, { "Content-Type": "application/json" });
      clientRes.end(JSON.stringify({ error: "Request Timeout", details: `No response within ${timeoutMs}ms.` }));
      resolve();
    });

    proxyReq.on("error", (err) => {
      clientRes.writeHead(502, { "Content-Type": "application/json" });
      clientRes.end(JSON.stringify({ error: "Proxy Error", details: err.message }));
      resolve();
    });

    if (body) {
      proxyReq.write(body);
    }

    proxyReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedPath = url.parse(req.url).pathname;

  // Auth configuration
  if (parsedPath === "/api/auth/config" && req.method === "GET") {
    sendJson(res, 200, { enabled: ENABLE_GOOGLE_SIGNIN, clientId: GOOGLE_CLIENT_ID });
    return;
  }

  // Current session
  if (parsedPath === "/api/auth/me" && req.method === "GET") {
    const session = getSession(req);
    sendJson(res, 200, { user: session ? session.user : null });
    return;
  }

  // Google sign-in
  if (parsedPath === "/api/auth/google" && req.method === "POST") {
    if (!ENABLE_GOOGLE_SIGNIN) {
      sendJson(res, 403, { error: "Google sign-in is not enabled" });
      return;
    }
    const rawBody = await readBody(req);
    let body;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const idToken = body.credential || body.idToken;
    if (!idToken) {
      sendJson(res, 400, { error: "Missing ID token" });
      return;
    }
    try {
      const payload = await verifyGoogleIdToken(idToken);
      const user = {
        sub: payload.sub,
        email: payload.email || null,
        name: payload.name || payload.email || "Google User",
        picture: payload.picture || null,
      };
      const sessionId = createSession(user);
      setSessionCookie(res, sessionId);
      sendJson(res, 200, { user });
    } catch (err) {
      sendJson(res, 401, { error: "Invalid token", details: err.message });
    }
    return;
  }

  // Sign-out
  if (parsedPath === "/api/auth/signout" && req.method === "POST") {
    const session = getSession(req);
    if (session) {
      const cookies = parseCookies(req.headers.cookie);
      const value = cookies.resmod_session || "";
      const sessionId = value.slice(0, value.lastIndexOf("."));
      sessions.delete(sessionId);
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  // Cloud sync for Postgres-backed providers (Neon, Aiven, etc.)
  if (parsedPath === "/api/sync" && req.method === "POST") {
    const session = getSession(req);
    if (!session || !session.user || !session.user.sub) {
      sendJson(res, 401, { error: "Sign in required" });
      return;
    }
    const rawBody = await readBody(req);
    let body;
    try {
      body = JSON.parse(rawBody || "{}");
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const { provider, connectionString, table = "resmod_data", action = "load", payload } = body;
    if (!connectionString || typeof connectionString !== "string") {
      sendJson(res, 400, { error: "Missing connectionString" });
      return;
    }
    try {
      if (action === "save") {
        await pgUpsert(connectionString, table, session.user.sub, payload || {});
        sendJson(res, 200, { ok: true });
      } else if (action === "load") {
        const data = await pgSelect(connectionString, table, session.user.sub);
        sendJson(res, 200, { data: data || {} });
      } else {
        sendJson(res, 400, { error: "Invalid action" });
      }
    } catch (err) {
      sendJson(res, 502, { error: "Sync failed", details: err.message });
    }
    return;
  }

  if (parsedPath === "/api/proxy" && req.method === "POST") {
    const rawBody = await readBody(req);
    let requestData;
    try {
      requestData = JSON.parse(rawBody);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }
    await proxyRequest(res, requestData);
    return;
  }

  if (parsedPath === "/api/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "1.0.0" }));
    return;
  }

  let filePath;
  if (parsedPath === "/" || parsedPath === "") {
    filePath = path.join(PUBLIC_DIR, "index.html");
  } else {
    filePath = path.join(PUBLIC_DIR, parsedPath);
  }

  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(path.resolve(PUBLIC_DIR))) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  serveStatic(res, resolvedPath);
});

server.listen(PORT, () => {
  console.log(`\n  ResMod running at http://localhost:${PORT}\n`);
});
