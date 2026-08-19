/**
 * Server-side proxy for ngrok's local inspection API (127.0.0.1:4040).
 *
 * Why this exists: ngrok's free tier issues a brand-new random subdomain
 * every time the tunnel restarts, so the URL saved in .env.local/localStorage
 * on the client inevitably goes stale -- that's what used to surface to the
 * user as "Failed to fetch" every time the backend was restarted.
 *
 * ngrok's inspection API reports the tunnel's current public URL, but it
 * sends no CORS headers, so a browser fetch() to it from the web app's
 * origin is blocked by CORS policy regardless of same-machine reachability.
 * This Next.js route runs server-side (Node runtime, no browser CORS
 * enforcement) on the same machine as the dev server, so it can reach
 * ngrok's inspection API directly; the browser then calls this route
 * instead (same-origin, no CORS issue).
 *
 * Only ever useful when the backend + ngrok are running on the same machine
 * as this Next.js process (i.e. local development) -- in a real deployment
 * ngrok's inspection API simply won't be reachable and this returns null,
 * which is the correct, safe "discovery unavailable" outcome.
 */
const NGROK_LOCAL_API = "http://127.0.0.1:4040/api/tunnels";

interface NgrokTunnelsResponse {
  tunnels?: Array<{ public_url?: unknown }>;
}

export async function GET(): Promise<Response> {
  try {
    const response = await fetch(NGROK_LOCAL_API, {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    if (!response.ok) {
      return Response.json({ publicUrl: null });
    }
    const data = (await response.json()) as NgrokTunnelsResponse;
    const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
    const httpsTunnel = tunnels.find(
      (t): t is { public_url: string } =>
        typeof t?.public_url === "string" &&
        t.public_url.startsWith("https://"),
    );
    return Response.json({ publicUrl: httpsTunnel?.public_url ?? null });
  } catch {
    // ngrok's local inspection API isn't reachable (not running on this
    // machine, or the backend/tunnel is genuinely down) -- not a route
    // error, just "nothing to discover", so the client falls back to
    // surfacing its original connectivity error.
    return Response.json({ publicUrl: null });
  }
}
