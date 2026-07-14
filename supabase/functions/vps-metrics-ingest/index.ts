import { createClient } from "jsr:@supabase/supabase-js@2";

const INGEST_SECRET = Deno.env.get("VPS_METRICS_INGEST_SECRET");
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!INGEST_SECRET)        return new Response("server misconfigured", { status: 500 });

  const provided = req.headers.get("x-ingest-secret") ?? "";
  if (!timingSafeEqual(provided, INGEST_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response("bad json", { status: 400 }); }

  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const pct = (v: unknown) => { const n = num(v); return n === null ? null : Math.min(100, Math.max(0, n)); };
  const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);

  const row = {
    host: typeof body.host === "string" && body.host.length <= 64 ? body.host : "relay-1",
    cpu_pct: pct(body.cpu_pct),
    mem_pct: pct(body.mem_pct),
    disk_pct: pct(body.disk_pct),
    net_rx_bytes: int(body.net_rx_bytes),
    net_tx_bytes: int(body.net_tx_bytes),
    active_sessions: int(body.active_sessions),
    relay_mbps: num(body.relay_mbps),
  };

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { error } = await supabase.from("vps_metrics").insert(row);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(null, { status: 204 });
});
