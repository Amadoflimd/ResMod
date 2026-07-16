const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const url = require("node:url");
const zlib = require("node:zlib");
const util = require("node:util");

const gunzip = util.promisify(zlib.gunzip);
const inflate = util.promisify(zlib.inflate);
const brotliDecompress = util.promisify(zlib.brotliDecompress);

const PORT = 3000;
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedPath = url.parse(req.url).pathname;

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
