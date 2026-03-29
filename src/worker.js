export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/bridge") {
      return handleBridge(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};

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
    const response = await fetch("https://private-iot-relay-sr-201.calape.ph", {
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