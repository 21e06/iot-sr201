const JWT_TTL = 30 * 24 * 60 * 60; // 30 days

// ── JWT helpers (HS256 via Web Crypto) ────────────────────────────────────────
function toB64Url(buffer) {
  let s = "";
  const b = new Uint8Array(buffer);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromB64Url(str) {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/"));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signJWT(payload, secret) {
  const enc = new TextEncoder();
  const header = toB64Url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body   = toB64Url(enc.encode(JSON.stringify(payload)));
  const data   = `${header}.${body}`;
  const key    = await hmacKey(secret);
  const sig    = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${toB64Url(sig)}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sigStr] = parts;
  const data   = `${header}.${body}`;
  const key    = await hmacKey(secret);
  const sigBin = fromB64Url(sigStr);
  const sig    = Uint8Array.from(sigBin, c => c.charCodeAt(0));
  const valid  = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(data));
  if (!valid) return null;
  const payload = JSON.parse(fromB64Url(body));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}

// ── Handlers ──────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/login") {
      return handleLogin(request, env);
    }

    if (request.method === "POST" && url.pathname === "/bridge") {
      const auth = request.headers.get("Authorization") ?? "";
      if (!auth.startsWith("Bearer ")) {
        return new Response("Unauthorized", { status: 401 });
      }
      const jwtPayload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
      if (!jwtPayload) {
        return new Response("Unauthorized", { status: 401 });
      }
      return handleBridge(request, env);
    }

    if (request.method === "GET" && url.pathname === "/ws") {
      return handleWebSocket(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (body.password !== env.PASSWORD) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT({
    sub: "user",
    iss: "sr201",
    iat: now,
    exp: now + JWT_TTL,
  }, env.JWT_SECRET);

  return new Response(JSON.stringify({ token }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleBridge(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { seconds } = body;

  if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 0) {
    return new Response("Invalid payload: seconds must be a non-negative integer", { status: 400 });
  }

  // seconds > 0  →  turn relay on:  11:{seconds}
  // seconds == 0 →  turn relay off: 2X
  const command = seconds > 0 ? `11:${seconds}` : "2X";

  try {
    const response = await env.VPC_SERVICE.fetch("http://127.0.0.1:8080", {
      method: "POST",
      headers: { "x-internal-secret": "bridge-secret" },
      body: command,
    });

    if (!response.ok) {
      return new Response("Bridge error", { status: response.status });
    }

    return new Response(JSON.stringify({ ok: true, command }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response("Service unavailable", { status: 503 });
  }
}

async function handleWebSocket(request, env) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jwtPayload = await verifyJWT(token, env.JWT_SECRET);
  if (!jwtPayload) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Proxy the WebSocket upgrade to the VPC bridge, adding the internal secret.
  const backendHeaders = new Headers(request.headers);
  backendHeaders.set("x-internal-secret", "bridge-secret");

  return env.VPC_SERVICE.fetch("http://127.0.0.1:8080/ws", {
    headers: backendHeaders,
  });
}