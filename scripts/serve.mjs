import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const preferred = 43128;
const noOpen = process.argv.includes("--no-open");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json", ".mp3": "audio/mpeg" };
if (!existsSync(root)) { console.error("Missing dist directory: " + root + ". Run the build first."); process.exit(1); }

function handler(req, res) {
  try {
    const raw = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const relative = raw === "/" ? "index.html" : raw.replace(/^\/+/, "");
    const file = resolve(join(root, normalize(relative)));
    if (file !== root && !file.startsWith(root + "/")) return res.writeHead(403).end("Forbidden");
    if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end("Not found");
    const target = file;
    readFile(target).then((data) => res.writeHead(200, { "Content-Type": mime[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-cache" }).end(data))
      .catch(() => res.writeHead(404).end("Not found"));
  } catch { res.writeHead(400).end("Bad request"); }
}

const server = createServer(handler);
let fallback = false;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && !fallback) {
    fallback = true;
    server.listen(0, "127.0.0.1");
  } else { console.error(err); process.exit(1); }
});
server.on("listening", () => ready(preferred));
server.listen(preferred, "127.0.0.1");
function ready(port) {
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  const url = "http://127.0.0.1:" + actual + "/";
  console.log("Proxima Astra: " + url);
  if (!noOpen && process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}
