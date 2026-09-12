import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const servers = new Map();
const execFileAsync = promisify(execFile);

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function scoreIssue(issue) {
    const labels = issue.labels.map((label) => label.name.toLowerCase());
    const text = `${issue.title} ${issue.body}`.toLowerCase();
    let score = 0;
    if (labels.some((label) => ["bug", "critical", "high priority", "security"].includes(label))) score += 8;
    if (text.includes("security") || text.includes("broken") || text.includes("crash")) score += 5;
    if (text.includes("performance") || text.includes("pagination")) score += 4;
    if (text.includes("filter") || text.includes("search")) score += 3;
    if (text.includes("data-access") || text.includes("accessibility")) score += 2;
    score += Math.min(issue.comments, 5);
    score += Math.min(Math.floor((Date.now() - Date.parse(issue.createdAt)) / 86400000), 30) / 10;
    return score;
}

async function loadIssues() {
    const { stdout: remote } = await execFileAsync("git", ["remote", "get-url", "origin"]);
    const match = remote.trim().match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
    if (!match) throw new Error("Could not determine the GitHub repository from origin");
    const { stdout } = await execFileAsync("gh", [
        "issue", "list", "--repo", match[1], "--state", "open", "--limit", "100",
        "--json", "number,title,body,labels,createdAt,updatedAt,comments",
    ]);
    return JSON.parse(stdout).map((issue) => {
        const normalized = { ...issue, labels: issue.labels ?? [], body: issue.body ?? "" };
        return { ...normalized, score: scoreIssue(normalized) };
    }).sort((a, b) => b.score - a.score || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function renderIssueCard(issue, featured) {
    const description = issue.body.trim().split("\n").filter(Boolean).slice(0, 3).join(" ");
    const justification = `Priority score ${issue.score.toFixed(1)}: ${issue.comments} comment${issue.comments === 1 ? "" : "s"}, ${issue.labels.length ? "label signals" : "no explicit priority label"}, and issue age were considered.`;
    return `<article class="card ${featured ? "featured" : ""}">
      <div class="card-head"><span class="issue-number">#${issue.number}</span><span class="status">Open</span></div>
      <h3>${escapeHtml(issue.title)}</h3>
      <p>${escapeHtml(description || "No description provided.")}</p>
      ${featured ? `<p class="why"><strong>Why now:</strong> ${escapeHtml(justification)}</p>` : ""}
      <div class="meta">${issue.comments} comment${issue.comments === 1 ? "" : "s"}${issue.labels.length ? ` · ${escapeHtml(issue.labels.map((label) => label.name).join(", "))}` : ""}</div>
      <button data-issue="${issue.number}" data-testid="add-issue-${issue.number}">Add to current context</button>
    </article>`;
}

function renderHtml(issues) {
    const featured = issues.slice(0, 3);
    const remainder = issues.slice(3);
    return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Issue triage</title>
    <style>
      :root { color-scheme: light dark; --bg: var(--background-color-default, #fff); --text: var(--text-color-default, #1f2328); --muted: var(--text-color-muted, #656d76); --border: var(--border-color-default, #d0d7de); --accent: var(--true-color-blue, #0969da); }
      * { box-sizing: border-box } body { margin: 0; padding: 20px; background: var(--bg); color: var(--text); font: 14px/1.45 var(--font-sans, system-ui, sans-serif) } h1 { margin: 0 0 4px; font-size: 22px } h2 { margin: 24px 0 10px; font-size: 15px } .sub { color: var(--muted); margin: 0 0 18px } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px } .card { border: 1px solid var(--border); border-radius: 8px; padding: 14px; display: flex; flex-direction: column; min-height: 190px } .featured { border-color: var(--accent) } .card-head { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px } .issue-number { color: var(--accent); font-weight: 600 } h3 { margin: 8px 0; font-size: 15px } p { margin: 0 0 10px } .why { color: var(--muted); font-size: 12px } .meta { color: var(--muted); font-size: 12px; margin-top: auto; padding: 10px 0 } button { border: 1px solid var(--accent); border-radius: 6px; padding: 7px 10px; color: var(--accent); background: transparent; cursor: pointer; font: inherit; font-weight: 600 } button:hover { background: color-mix(in srgb, var(--accent) 12%, transparent) } button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 2px } .empty { color: var(--muted) } #notice { min-height: 20px; color: var(--muted); margin-top: 12px }
    </style>
  </head>
  <body>
    <h1>Issue triage</h1>
    <p class="sub">Open issues ranked by urgency signals. Add one to the current session to start work.</p>
    <h2>Needs attention now</h2>
    <section class="grid">${featured.length ? featured.map((issue) => renderIssueCard(issue, true)).join("") : '<p class="empty">No open issues.</p>'}</section>
    <h2>Remaining open issues</h2>
    <section class="grid">${remainder.length ? remainder.map((issue) => renderIssueCard(issue, false)).join("") : '<p class="empty">Nothing else is open.</p>'}</section>
    <p id="notice" role="status" aria-live="polite"></p>
    <script>
      document.querySelectorAll("button[data-issue]").forEach((button) => button.addEventListener("click", async () => {
        button.disabled = true;
        const notice = document.querySelector("#notice");
        try {
          const response = await fetch("/add-context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: Number(button.dataset.issue) }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Unable to add issue");
          notice.textContent = result.message;
        } catch (error) {
          notice.textContent = error.message;
          button.disabled = false;
        }
      }));
    </script>
  </body>
</html>`;
}

async function readJson(req) {
    let body = "";
    for await (const chunk of req) body += chunk;
    return JSON.parse(body);
}

async function startServer(issues, session) {
    const server = createServer(async (req, res) => {
        try {
            if (req.method === "POST" && req.url === "/add-context") {
                const { number } = await readJson(req);
                const issue = issues.find((candidate) => candidate.number === number);
                if (!issue) throw new Error("Issue is no longer in the open issue list");
                await session.send({ prompt: `Add GitHub issue #${issue.number} to the current context and begin triage. Title: ${issue.title}\n\n${issue.body}` });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ message: `Issue #${issue.number} added to the current context.` }));
                return;
            }
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(renderHtml(issues));
        } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }));
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "kanban-triage",
            displayName: "Issue triage",
            description: "A Kanban board that ranks open GitHub issues and adds selected issues to the current context.",
            actions: [{
                name: "refresh_issues",
                description: "Refresh the board from the repository's current open GitHub issues.",
                handler: async () => ({ issues: await loadIssues() }),
            }],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(await loadIssues(), session);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Issue triage", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
