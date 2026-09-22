import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { spawn, execSync, ChildProcess } from "child_process";
import https from "https";
import zlib from "zlib";
import httpProxy from "http-proxy";
import { createServer as createViteServer, ViteDevServer } from "vite";

const PORT = 3000;
const V2RAY_PORT = 10080;

const app = express();
const server = http.createServer(app);

app.use(express.json());

// Memory store for sessions, V2Ray state and logs
const sessions = new Set<string>();
let v2rayProcess: ChildProcess | null = null;
const logs: string[] = [];
let isStarting = false;

function addLog(message: string) {
  const timestamp = new Date().toISOString();
  const formattedLog = `[${timestamp}] ${message}`;
  logs.push(formattedLog);
  if (logs.length > 500) {
    logs.shift();
  }
  console.log(formattedLog);
}

// Ensure binary exists and download if not
const binDir = path.join(process.cwd(), "bin");
const v2rayPath = path.join(binDir, "v2ray");

// Downloads a URL to disk using Node's built-in https module, following redirects
// manually (GitHub release assets 302-redirect to objects.githubusercontent.com).
// This avoids shelling out to the `curl` binary, which is not guaranteed to exist
// in minimal/distroless container runtimes such as Choreo's Node.js buildpack image.
function downloadFile(url: string, destPath: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(
      url,
      { headers: { "User-Agent": "node.js" } },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          fs.unlinkSync(destPath);
          if (maxRedirects <= 0) {
            reject(new Error("Too many redirects while downloading " + url));
            return;
          }
          downloadFile(response.headers.location, destPath, maxRedirects - 1).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          reject(new Error(`Request failed with status code ${response.statusCode} for ${url}`));
          return;
        }

        response.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
      }
    );

    request.on("error", (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

// Minimal, dependency-free ZIP extractor built on Node's built-in `zlib` module.
// Supports the two compression methods used by real-world zip files: 0 (stored)
// and 8 (deflate) — which covers the v2ray-core release archives. This avoids
// adding any new npm package (e.g. adm-zip), which previously broke `npm ci`
// because package-lock.json was not regenerated/in sync with package.json.
function extractZip(zipPath: string, destDir: string) {
  const buf = fs.readFileSync(zipPath);

  // Locate the End Of Central Directory record by scanning backwards for its signature.
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error("Invalid zip file: End Of Central Directory record not found");
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let offset = buf.readUInt32LE(eocdOffset + 16); // offset of start of central directory

  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid zip file: bad central directory entry signature");
    }

    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const fileNameLength = buf.readUInt16LE(offset + 28);
    const extraFieldLength = buf.readUInt16LE(offset + 30);
    const fileCommentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const fileName = buf.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    // Advance to the next central directory record.
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;

    // Skip directory entries.
    if (fileName.endsWith("/")) {
      continue;
    }

    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid zip file: bad local file header for ${fileName}`);
    }
    const localFileNameLength = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraFieldLength = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
    const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

    let fileData: Buffer;
    if (compressionMethod === 0) {
      fileData = Buffer.from(compressedData);
    } else if (compressionMethod === 8) {
      fileData = zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported zip compression method ${compressionMethod} for ${fileName}`);
    }

    const outPath = path.join(destDir, fileName);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, fileData);
  }
}

async function ensureV2RayBinary() {
  if (fs.existsSync(v2rayPath)) {
    addLog("V2Ray binary already exists at " + v2rayPath);
    return;
  }

  addLog("V2Ray binary not found. Preparing to download...");
  try {
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
    }

    const zipPath = path.join(binDir, "v2ray-linux-64.zip");
    addLog("Downloading V2Ray core zip from GitHub releases...");

    // Download using Node's native https module (no dependency on a system
    // `curl` binary, which is often missing in minimal cloud runtime images).
    await downloadFile(
      "https://github.com/v2fly/v2ray-core/releases/download/v5.14.1/v2ray-linux-64.zip",
      zipPath
    );

    addLog("Extracting V2Ray core zip...");
    // Extract using our built-in, dependency-free zip extractor (no `unzip` binary,
    // no adm-zip package — nothing that requires touching package-lock.json).
    extractZip(zipPath, binDir);

    addLog("Setting executable permission on v2ray...");
    fs.chmodSync(v2rayPath, 0o755);

    // Clean up zip
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    addLog("V2Ray binary successfully installed.");
  } catch (error: any) {
    addLog(`ERROR installing V2Ray binary: ${error?.message || error}`);
  }
}

// Load config.json
function getV2RayConfig() {
  const configPath = path.join(process.cwd(), "config.json");
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (err: any) {
    addLog(`Error reading config.json: ${err.message}`);
  }
  return null;
}

function getV2RayPath(): string {
  const config = getV2RayConfig();
  const pathVal = config?.inbounds?.[0]?.streamSettings?.wsSettings?.path;
  return pathVal || "/by_moon";
}

// Sync clients from clients_metadata.json to config.json
function syncV2RayConfig() {
  const configPath = path.join(process.cwd(), "config.json");
  const clientsMetadataPath = path.join(process.cwd(), "clients_metadata.json");
  
  try {
    let currentConfig = getV2RayConfig();
    if (!currentConfig) {
      addLog("Failed to sync config: config.json not readable");
      return;
    }

    let clientsMetadata = [];
    if (fs.existsSync(clientsMetadataPath)) {
      clientsMetadata = JSON.parse(fs.readFileSync(clientsMetadataPath, "utf8"));
    }

    const now = Date.now();
    const activeClients = clientsMetadata.filter((c: any) => {
      if (!c.isActive) return false;
      if (c.expiryTime && c.expiryTime < now) return false;
      return true;
    });

    const v2rayClients = activeClients.map((c: any) => ({
      id: c.id,
      level: 0,
      email: c.email
    }));

    if (currentConfig.inbounds && currentConfig.inbounds[0]) {
      const inbound = currentConfig.inbounds[0];
      if (!inbound.settings) {
        inbound.settings = {};
      }
      inbound.settings.clients = v2rayClients;

      // Force gaming low-ping optimizations on Inbound sockopt
      if (!inbound.streamSettings) {
        inbound.streamSettings = {};
      }
      if (!inbound.streamSettings.sockopt) {
        inbound.streamSettings.sockopt = {};
      }
      inbound.streamSettings.sockopt.tcpFastOpen = true;
      inbound.streamSettings.sockopt.tcpKeepAliveInterval = 5;
    }

    // Force gaming low-ping high-reliability DNS servers
    currentConfig.dns = {
      "servers": [
        "1.1.1.1",
        "8.8.8.8"
      ]
    };

    // Force gaming low-ping optimizations on Freedom Outbound
    if (currentConfig.outbounds && currentConfig.outbounds[0]) {
      const outbound = currentConfig.outbounds[0];
      if (!outbound.streamSettings) {
        outbound.streamSettings = {};
      }
      if (!outbound.streamSettings.sockopt) {
        outbound.streamSettings.sockopt = {};
      }
      outbound.streamSettings.sockopt.tcpFastOpen = true;
      
      if (!outbound.settings) {
        outbound.settings = {};
      }
      outbound.settings.domainStrategy = "UseIPv4";
    }

    fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), "utf8");
    addLog(`Synced ${v2rayClients.length} active clients to V2Ray config.json (Gaming Optimized)`);
  } catch (err: any) {
    addLog(`Error syncing configuration: ${err.message}`);
  }
}

// Start V2Ray process
function startV2RayProcess() {
  if (v2rayProcess) {
    addLog("V2Ray is already running.");
    return;
  }

  if (isStarting) {
    addLog("V2Ray is already in the process of starting.");
    return;
  }

  isStarting = true;
  addLog("Starting V2Ray background daemon...");

  // ensureV2RayBinary is async (it downloads over HTTPS via Node's https module),
  // so the rest of the startup sequence runs after it resolves.
  ensureV2RayBinary()
    .then(() => {
      if (!fs.existsSync(v2rayPath)) {
        throw new Error("v2ray binary is missing or was not downloaded correctly.");
      }

      // Always sync configuration before starting
      syncV2RayConfig();

      const configPath = path.join(process.cwd(), "config.json");
      if (!fs.existsSync(configPath)) {
        throw new Error("config.json is missing from workspace.");
      }

      v2rayProcess = spawn(v2rayPath, ["run", "-config", configPath], {
        cwd: process.cwd(),
        env: { ...process.env }
      });

      v2rayProcess.stdout?.on("data", (data) => {
        const text = data.toString().trim();
        if (text) {
          addLog(`[V2Ray STDOUT] ${text}`);
        }
      });

      v2rayProcess.stderr?.on("data", (data) => {
        const text = data.toString().trim();
        if (text) {
          addLog(`[V2Ray STDERR] ${text}`);
        }
      });

      v2rayProcess.on("error", (err) => {
        addLog(`[V2Ray Process Error] ${err.message}`);
      });

      v2rayProcess.on("exit", (code) => {
        addLog(`[V2Ray Process Exit] V2Ray daemon exited with code ${code}`);
        v2rayProcess = null;
        isStarting = false;
      });

      // Wait briefly to check if it crashed immediately
      setTimeout(() => {
        isStarting = false;
        if (v2rayProcess) {
          addLog(`V2Ray daemon started successfully (PID: ${v2rayProcess.pid}) on port ${V2RAY_PORT}`);
        } else {
          addLog("V2Ray daemon failed to start or crashed on startup.");
        }
      }, 1500);
    })
    .catch((error: any) => {
      isStarting = false;
      addLog(`Failed to start V2Ray process: ${error?.message || error}`);
    });
}

// Stop V2Ray process
function stopV2RayProcess() {
  if (!v2rayProcess) {
    addLog("V2Ray process is not running.");
    return;
  }

  addLog("Stopping V2Ray daemon...");
  try {
    v2rayProcess.kill();
    v2rayProcess = null;
    addLog("V2Ray daemon stopped.");
  } catch (error: any) {
    addLog(`Error stopping V2Ray: ${error?.message || error}`);
  }
}

// Expiration Check Daemon (Runs every 10 seconds)
function runExpirationDaemon() {
  setInterval(() => {
    const clientsMetadataPath = path.join(process.cwd(), "clients_metadata.json");
    if (!fs.existsSync(clientsMetadataPath)) return;

    try {
      let clientsMetadata = JSON.parse(fs.readFileSync(clientsMetadataPath, "utf8"));
      const now = Date.now();
      let hasChanges = false;

      clientsMetadata = clientsMetadata.map((c: any) => {
        if (c.isActive && c.expiryTime && c.expiryTime < now) {
          addLog(`Client [${c.email}] (${c.id}) has EXPIRED. Deactivating...`);
          c.isActive = false;
          hasChanges = true;
        }
        return c;
      });

      if (hasChanges) {
        fs.writeFileSync(clientsMetadataPath, JSON.stringify(clientsMetadata, null, 2), "utf8");
        syncV2RayConfig();
        // Hot-restart V2Ray
        stopV2RayProcess();
        setTimeout(() => {
          startV2RayProcess();
        }, 1000);
      }
    } catch (err: any) {
      addLog(`Error in expiration daemon: ${err.message}`);
    }
  }, 10000);
}

// Setup HTTP WebSocket Proxy
const wsProxy = httpProxy.createProxyServer({
  target: `ws://127.0.0.1:${V2RAY_PORT}`,
  ws: true,
  changeOrigin: true
});

wsProxy.on("error", (err, req, socket) => {
  addLog(`[Proxy Error] ${err.message}`);
  if (socket && !socket.destroyed) {
    socket.destroy();
  }
});

// Authentication Middleware
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Public routes
  if (
    req.path === "/login" || 
    req.path === "/api/login" || 
    req.path === "/auth-check" || 
    req.path === "/api/auth-check"
  ) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (token) {
    if (sessions.has(token)) {
      return next();
    }

    // Stateless fallback verify
    try {
      const credsPath = path.join(process.cwd(), "dashboard_creds.json");
      let creds = { username: "admin", password: "adminpassword" };
      if (fs.existsSync(credsPath)) {
        creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      }
      const expectedToken = Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
      if (token === expectedToken) {
        sessions.add(token);
        return next();
      }
    } catch (e) {}
  }

  res.status(401).json({ error: "Unauthorized" });
}

// Intercept API routes BEFORE Vite is configured!
app.use("/api", authMiddleware);

// --- API Routes ---

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const credsPath = path.join(process.cwd(), "dashboard_creds.json");
  
  try {
    let creds = { username: "admin", password: "adminpassword" };
    if (fs.existsSync(credsPath)) {
      creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    }

    if (username === creds.username && password === creds.password) {
      // Create a stateless session token that survives restarts but changes if credentials change
      const token = Buffer.from(`${username}:${password}`).toString("base64");
      sessions.add(token);
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: "اسم المستخدم أو كلمة المرور غير صحيحة / Invalid credentials" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Auth check
app.get("/api/auth-check", (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (token) {
    if (sessions.has(token)) {
      return res.json({ authenticated: true });
    }

    // Stateless fallback check
    try {
      const credsPath = path.join(process.cwd(), "dashboard_creds.json");
      let creds = { username: "admin", password: "adminpassword" };
      if (fs.existsSync(credsPath)) {
        creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      }
      const expectedToken = Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
      if (token === expectedToken) {
        sessions.add(token);
        return res.json({ authenticated: true });
      }
    } catch (e) {}
  }
  res.status(401).json({ authenticated: false });
});

// Logout
app.post("/api/logout", (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (token) {
    sessions.delete(token);
  }
  res.json({ success: true });
});

// Server Status
app.get("/api/status", (req, res) => {
  const config = getV2RayConfig();
  const systemStats = {
    uptime: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version
  };

  res.json({
    running: v2rayProcess !== null,
    pid: v2rayProcess?.pid || null,
    isStarting,
    configPath: getV2RayPath(),
    fullConfig: config,
    system: systemStats
  });
});

// Live Logs
app.get("/api/logs", (req, res) => {
  res.json({ logs });
});

// Control Daemon
app.post("/api/control", (req, res) => {
  const { action } = req.body;
  if (action === "start") {
    startV2RayProcess();
    res.json({ success: true, message: "Start command issued" });
  } else if (action === "stop") {
    stopV2RayProcess();
    res.json({ success: true, message: "Stop command issued" });
  } else if (action === "restart") {
    stopV2RayProcess();
    setTimeout(() => {
      startV2RayProcess();
    }, 1000);
    res.json({ success: true, message: "Restart command issued" });
  } else {
    res.status(400).json({ error: "Invalid action. Supported: start, stop, restart" });
  }
});

// --- CLIENTS CRUD ---

// Get all clients metadata
app.get("/api/clients", (req, res) => {
  const clientsMetadataPath = path.join(process.cwd(), "clients_metadata.json");
  try {
    let clients = [];
    if (fs.existsSync(clientsMetadataPath)) {
      clients = JSON.parse(fs.readFileSync(clientsMetadataPath, "utf8"));
    }
    res.json(clients);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to load clients: ${err.message}` });
  }
});

// Add new client
app.post("/api/clients", (req, res) => {
  const { email, id, duration } = req.body;
  if (!email || !id || !duration) {
    return res.status(400).json({ error: "Email, UUID (id), and Duration are required" });
  }

  const clientsMetadataPath = path.join(process.cwd(), "clients_metadata.json");
  try {
    let clients = [];
    if (fs.existsSync(clientsMetadataPath)) {
      clients = JSON.parse(fs.readFileSync(clientsMetadataPath, "utf8"));
    }

    // Check if ID or Email already exists
    const duplicate = clients.find((c: any) => c.id === id || c.email === email);
    if (duplicate) {
      return res.status(400).json({ error: "UUID or Email already exists" });
    }

    // Calculate expiryTime
    let expiryTime: number | null = null;
    const now = Date.now();
    
    if (duration !== "unlimited") {
      const match = duration.match(/^(\d+)([mhdw])$/);
      if (match) {
        const val = parseInt(match[1]);
        const unit = match[2];
        let multiplier = 60 * 1000; // default 1m
        if (unit === "m") multiplier = 60 * 1000;
        else if (unit === "h") multiplier = 60 * 60 * 1000;
        else if (unit === "d") multiplier = 24 * 60 * 60 * 1000;
        else if (unit === "w") multiplier = 7 * 24 * 60 * 60 * 1000;
        
        expiryTime = now + (val * multiplier);
      }
    }

    const newClient = {
      id,
      email,
      createdAt: new Date().toISOString(),
      duration,
      expiryTime,
      isActive: true
    };

    clients.push(newClient);
    fs.writeFileSync(clientsMetadataPath, JSON.stringify(clients, null, 2), "utf8");

    addLog(`Added new client config: [${email}] (${id}) with duration ${duration}`);
    
    // Sync and restart
    syncV2RayConfig();
    stopV2RayProcess();
    setTimeout(() => {
      startV2RayProcess();
    }, 1000);

    res.json({ success: true, client: newClient });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle Client active state
app.post("/api/clients/:id/toggle", (req, res) => {
  const clientId = req.params.id;
  const clientsMetadataPath = path.join(process.cwd(), "clients_metadata.json");

  try {
    if (!fs.existsSync(clientsMetadataPath)) {
      return res.status(404).json({ error: "No clients found" });
    }

    let clients = JSON.parse(fs.readFileSync(clientsMetadataPath, "utf8"));
    let found = false;

    clients = clients.map((c: any) => {
      if (c.id === clientId) {
        c.isActive = !c.isActive;
        found = true;
        // If they are reactivated and had an expired time, let's reset or extend them
        if (c.isActive && c.expiryTime && c.expiryTime < Date.now()) {
          const duration = c.duration;
          const now = Date.now();
          if (duration !== "unlimited") {
            const match = duration.match(/^(\d+)([mhdw])$/);
            if (match) {
              const val = parseInt(match[1]);
              const unit = match[2];
              let multiplier = 60 * 1000;
              if (unit === "m") multiplier = 60 * 1000;
              else if (unit === "h") multiplier = 60 * 60 * 1000;
              else if (unit === "d") multiplier = 24 * 60 * 60 * 1000;
              else if (unit === "w") multiplier = 7 * 24 * 60 * 60 * 1000;
              c.expiryTime = now + (val * multiplier);
            }
          }
        }
      }
      return c;
    });

    if (!found) {
      return res.status(404).json({ error: "Client not found" });
    }

    fs.writeFileSync(clientsMetadataPath, JSON.stringify(clients, null, 2), "utf8");
    syncV2RayConfig();
    stopV2RayProcess();
    setTimeout(() => {
      startV2RayProcess();
    }, 1000);

    res.json({ success: true, message: "Client toggled successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Client
app.delete("/api/clients/:id", (req, res) => {
  const clientId = req.params.id;
  const clientsMetadataPath = path.join(process.cwd(), "clients_metadata.json");

  try {
    if (!fs.existsSync(clientsMetadataPath)) {
      return res.status(404).json({ error: "No clients found" });
    }

    let clients = JSON.parse(fs.readFileSync(clientsMetadataPath, "utf8"));
    const originalLength = clients.length;
    clients = clients.filter((c: any) => c.id !== clientId);

    if (clients.length === originalLength) {
      return res.status(404).json({ error: "Client not found" });
    }

    fs.writeFileSync(clientsMetadataPath, JSON.stringify(clients, null, 2), "utf8");
    addLog(`Deleted client [ID: ${clientId}]`);
    
    syncV2RayConfig();
    stopV2RayProcess();
    setTimeout(() => {
      startV2RayProcess();
    }, 1000);

    res.json({ success: true, message: "Client deleted successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Config endpoints
app.get("/api/config", (req, res) => {
  const currentConfig = getV2RayConfig();
  const credsPath = path.join(process.cwd(), "dashboard_creds.json");
  let creds = { username: "admin", password: "adminpassword" };
  if (fs.existsSync(credsPath)) {
    try {
      creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    } catch (_) {}
  }

  res.json({
    v2rayConfig: currentConfig,
    credentials: {
      username: creds.username,
      password: creds.password
    }
  });
});

app.post("/api/config", (req, res) => {
  const { path: v2rayPathVal, username, password } = req.body;
  const configPath = path.join(process.cwd(), "config.json");
  const credsPath = path.join(process.cwd(), "dashboard_creds.json");

  try {
    // 1. Update V2Ray websocket path
    if (v2rayPathVal) {
      let currentConfig = getV2RayConfig();
      if (currentConfig && currentConfig.inbounds && currentConfig.inbounds[0]) {
        const inbound = currentConfig.inbounds[0];
        if (inbound.streamSettings && inbound.streamSettings.wsSettings) {
          inbound.streamSettings.wsSettings.path = v2rayPathVal;
        }
        fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), "utf8");
        addLog(`Updated V2Ray WS Path to: ${v2rayPathVal}`);
      }
    }

    // 2. Update Admin credentials
    if (username || password) {
      let creds = { username: "admin", password: "adminpassword" };
      if (fs.existsSync(credsPath)) {
        try {
          creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
        } catch (_) {}
      }

      if (username) creds.username = username;
      if (password) creds.password = password;

      fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2), "utf8");
      addLog(`Updated dashboard admin credentials`);
    }

    // Restart process to apply V2Ray changes
    stopV2RayProcess();
    setTimeout(() => {
      startV2RayProcess();
    }, 1000);

    res.json({ success: true, message: "Configuration updated successfully" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Setup dev and production servers
async function runServer() {
  let viteDevServer: ViteDevServer | null = null;

  if (process.env.NODE_ENV !== "production") {
    addLog("Configuring Vite Dev Server middleware...");
    viteDevServer = await createViteServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(viteDevServer.middlewares);
  } else {
    addLog("Configuring production static assets...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Intercept WebSocket upgrades on the HTTP server
  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    const currentPath = getV2RayPath();

    if (url.startsWith(currentPath)) {
      addLog(`[Proxy] Upgrading WebSocket connection for: ${url} -> V2Ray`);
      wsProxy.ws(req, socket, head);
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    addLog(`Dashboard & WebSocket Proxy server running on port ${PORT}`);
    
    // Auto-start V2Ray on system startup
    startV2RayProcess();
    
    // Start Expiration Check background worker
    runExpirationDaemon();
  });
}

runServer().catch((err) => {
  console.error("Failed to start server:", err);
});
