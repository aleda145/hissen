import { Hono } from "hono";

type Env = {
  DB: D1Database;
  IP_HASH_SECRET?: string;
};

type Status = "working" | "broken" | "unknown";

type StatusResponse = {
  status: Status;
  lastReportedAt: string | null;
};

type LatestStatusRow = {
  status: "working" | "broken";
  lastReportedAt: string | null;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.html(renderPage()));

app.get("/api/status", async (c) => {
  return c.json(await getCurrentStatus(c.env.DB));
});

app.post("/api/report", async (c) => {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!isReportBody(body)) {
    return c.json({ error: "Status must be 'working' or 'broken'" }, 400);
  }

  const ip = getClientIp(c.req.raw.headers);
  const ipHash = await hashIp(ip, c.env.IP_HASH_SECRET);
  const userAgent = c.req.header("user-agent")?.slice(0, 500) ?? null;

  // TODO: Add Cloudflare Turnstile if spam becomes a problem.
  await c.env.DB.prepare(
    "INSERT INTO reports (status, ip_hash, user_agent) VALUES (?, ?, ?)"
  )
    .bind(body.status, ipHash, userAgent)
    .run();

  return c.json(await getCurrentStatus(c.env.DB));
});

export default app;

async function getCurrentStatus(db: D1Database): Promise<StatusResponse> {
  const row = await db
    .prepare(
      `SELECT status, created_at AS lastReportedAt
      FROM reports
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT 1`
    )
    .first<LatestStatusRow>();

  return {
    status: row?.status ?? "unknown",
    lastReportedAt: toStockholmTime(row?.lastReportedAt ?? null),
  };
}

function isReportBody(body: unknown): body is { status: "working" | "broken" } {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const status = (body as { status?: unknown }).status;
  return status === "working" || status === "broken";
}

function getClientIp(headers: Headers): string | null {
  const cloudflareIp = headers.get("cf-connecting-ip");
  if (cloudflareIp) {
    return cloudflareIp;
  }

  const forwardedFor = headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || null;
}

async function hashIp(ip: string | null, secret = ""): Promise<string | null> {
  if (!ip) {
    return null;
  }

  const bytes = new TextEncoder().encode(`${secret}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toStockholmTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function renderPage(): string {
  return `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Är Katarinahissen trasig?</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #ffffff;
        --text: #111111;
        --muted: #666666;
        --line: #e7e7e7;
        --working: #147a4d;
        --broken: #b42318;
        --unknown: #6f5a00;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        padding: 32px 20px;
        background: var(--bg);
        color: var(--text);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      main {
        width: min(100%, 420px);
        margin: 0 auto;
        text-align: center;
      }

      h1 {
        margin: 0 0 32px;
        font-size: 2.5rem;
        line-height: 1;
        letter-spacing: 0;
      }

      h1 span {
        display: block;
      }

      .status {
        margin: 0 0 8px;
        font-size: 1.85rem;
        font-weight: 800;
        line-height: 1.12;
      }

      .status[data-status="working"] {
        color: var(--working);
      }

      .status[data-status="broken"] {
        color: var(--broken);
      }

      .status[data-status="unknown"] {
        color: var(--unknown);
      }

      .last-reported {
        margin: 0;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.4;
      }

      .last-reported-time {
        margin-bottom: 92px;
      }

      .buttons {
        display: grid;
        gap: 20px;
      }

      .prompt {
        margin: 0 0 24px;
        color: var(--text);
        font-size: 1rem;
        font-weight: 700;
      }

      button {
        width: 100%;
        min-height: 58px;
        border: 1px solid transparent;
        border-radius: 8px;
        padding: 14px 16px;
        color: white;
        font: inherit;
        font-size: 1.05rem;
        font-weight: 800;
        cursor: pointer;
      }

      button:disabled {
        cursor: wait;
        opacity: 0.72;
      }

      .working-button {
        background: var(--working);
      }

      .broken-button {
        background: var(--broken);
      }

      .error {
        min-height: 24px;
        margin: 14px 0 0;
        color: var(--broken);
        font-weight: 700;
      }

      .thanks {
        min-height: 24px;
        margin: 18px 0 0;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <h1><span>Är</span><span>Katarinahissen</span><span>trasig?</span></h1>
      <p id="status" class="status" data-status="unknown">Ingen vet just nu</p>
      <p class="last-reported">Senast rapporterat</p>
      <p id="last-reported" class="last-reported last-reported-time">Ingen rapport än</p>
      <p class="prompt">Stämmer det inte?</p>
      <div class="buttons">
        <button class="working-button" type="button" data-report="working">Den funkar</button>
        <button class="broken-button" type="button" data-report="broken">Den är trasig</button>
      </div>
      <p id="thanks" class="thanks" aria-live="polite"></p>
      <p id="error" class="error" aria-live="polite"></p>
    </main>

    <script>
      const statusText = {
        working: "Den verkar funka",
        broken: "Den verkar vara trasig",
        unknown: "Ingen vet just nu"
      };

      const statusEl = document.querySelector("#status");
      const lastReportedEl = document.querySelector("#last-reported");
      const thanksEl = document.querySelector("#thanks");
      const errorEl = document.querySelector("#error");
      const buttons = [...document.querySelectorAll("[data-report]")];

      async function loadStatus() {
        const response = await fetch("/api/status");
        if (!response.ok) throw new Error("Kunde inte hämta status");
        updateStatus(await response.json());
      }

      async function sendReport(status) {
        setLoading(true);
        thanksEl.textContent = "";
        errorEl.textContent = "";

        try {
          const response = await fetch("/api/report", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ status })
          });

          if (!response.ok) throw new Error("Kunde inte spara rapporten");
          updateStatus(await response.json());
          thanksEl.textContent = "Tack för din rapport!";
        } catch (error) {
          errorEl.textContent = "Något gick fel. Försök igen.";
        } finally {
          setLoading(false);
        }
      }

      function updateStatus(data) {
        statusEl.textContent = statusText[data.status] || statusText.unknown;
        statusEl.dataset.status = data.status || "unknown";
        lastReportedEl.textContent = data.lastReportedAt || "Ingen rapport än";
      }

      function setLoading(isLoading) {
        buttons.forEach((button) => {
          button.disabled = isLoading;
        });
      }

      buttons.forEach((button) => {
        button.addEventListener("click", () => sendReport(button.dataset.report));
      });

      loadStatus().catch(() => {
        errorEl.textContent = "Kunde inte hämta status just nu.";
      });

      setInterval(() => {
        loadStatus().catch(() => {});
      }, 5000);
    </script>
  </body>
</html>`;
}
