import { writeFileSync, mkdirSync } from "node:fs";

const USER = process.env.STATS_USER || "yessjun";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    login
    followers { totalCount }
    following { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, isFork: false, ownerAffiliations: OWNER, orderBy: {field: STARGAZERS, direction: DESC}) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 12, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
    repositoriesContributedTo(first: 100, contributionTypes: [COMMIT, PULL_REQUEST], includeUserRepositories: false) {
      totalCount
      nodes {
        nameWithOwner
        languages(first: 12, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "profile-stats",
  },
  body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
});
const json = await res.json();
if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
const u = json.data.user;

const c = u.contributionsCollection;
const stars = u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);

// Aggregate language bytes across owned repos and repos contributed to.
const langs = new Map();
const IGNORE = new Set(["HTML", "CSS", "SCSS", "Jupyter Notebook", "Vue", "Svelte"]);
for (const repo of [...u.repositories.nodes, ...u.repositoriesContributedTo.nodes]) {
  for (const { size, node } of repo.languages.edges) {
    if (IGNORE.has(node.name)) continue;
    const prev = langs.get(node.name) || { size: 0, color: node.color || "#8b949e" };
    prev.size += size;
    langs.set(node.name, prev);
  }
}
const ranked = [...langs.entries()]
  .map(([name, v]) => ({ name, ...v }))
  .sort((a, b) => b.size - a.size);
const top = ranked.slice(0, 8);
const totalBytes = top.reduce((a, l) => a + l.size, 0) || 1;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v) => v.toLocaleString("en-US");

const BG = "#0d1117";
const BORDER = "#1f6feb33";
const ACCENT = "#64ffda";
const LABEL = "#c9d1d9";
const MUTED = "#8b949e";
const FONT = "Segoe UI, Helvetica Neue, Helvetica, Arial, sans-serif";

const card = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
  <defs>
    <linearGradient id="edge" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#64ffda"/><stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${BG}" stroke="${BORDER}"/>
  <rect x="0.5" y="0.5" width="${w - 1}" height="3" rx="1.5" fill="url(#edge)"/>
  <g font-family="${FONT}">
    <text x="26" y="46" font-size="17" font-weight="700" fill="${ACCENT}">${esc(title)}</text>
    ${body}
  </g>
</svg>`;

// ---- Overview card ----
const rows = [
  ["Total Contributions (1y)", c.contributionCalendar.totalContributions],
  ["Commits (1y)", c.totalCommitContributions],
  ["Pull Requests (1y)", c.totalPullRequestContributions],
  ["PR Reviews (1y)", c.totalPullRequestReviewContributions],
  ["Issues Opened (1y)", c.totalIssueContributions],
  ["Repositories Contributed To", u.repositoriesContributedTo.totalCount],
  ["Stars Earned", stars],
  ["Followers", u.followers.totalCount],
].filter(([, v]) => v > 0);

const CARD_H = 78 + rows.length * 30;
const overviewBody = rows
  .map(([label, value], i) => {
    const y = 84 + i * 30;
    return `<text x="26" y="${y}" font-size="14" fill="${LABEL}">${esc(label)}</text>
    <text x="454" y="${y}" font-size="15" font-weight="700" fill="#ffffff" text-anchor="end">${esc(n(value))}</text>
    <line x1="26" y1="${y + 10}" x2="454" y2="${y + 10}" stroke="#ffffff" stroke-opacity="0.06"/>`;
  })
  .join("\n    ");
const overview = card(480, CARD_H, `${u.name || u.login} · GitHub Stats`, overviewBody);

// ---- Languages card ----
let x = 26;
const barW = 428;
const segments = top
  .map((l) => {
    const w = Math.max(2, (l.size / totalBytes) * barW);
    const seg = `<rect x="${x.toFixed(1)}" y="72" width="${w.toFixed(1)}" height="14" fill="${l.color}"/>`;
    x += w;
    return seg;
  })
  .join("\n    ");
const legend = top
  .map((l, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = 26 + col * 220;
    const ly = 122 + row * 30;
    const pct = ((l.size / totalBytes) * 100).toFixed(1);
    return `<circle cx="${lx + 6}" cy="${ly - 5}" r="6" fill="${l.color}"/>
    <text x="${lx + 20}" y="${ly}" font-size="13" fill="${LABEL}">${esc(l.name)}</text>
    <text x="${lx + 196}" y="${ly}" font-size="13" font-weight="600" fill="${MUTED}" text-anchor="end">${pct}%</text>`;
  })
  .join("\n    ");
const legendRows = Math.ceil(top.length / 2);
const langsH = Math.max(CARD_H, 122 + (legendRows - 1) * 30 + 28);
const languages = card(
  480,
  langsH,
  "Most Used Languages",
  `<g><clipPath id="barclip"><rect x="26" y="72" width="${barW}" height="14" rx="7"/></clipPath>
    <g clip-path="url(#barclip)"><rect x="26" y="72" width="${barW}" height="14" fill="#161b22"/>
    ${segments}</g></g>
    ${legend}`
);

mkdirSync("assets", { recursive: true });
writeFileSync("assets/stats.svg", overview);
writeFileSync("assets/langs.svg", languages);
console.log("wrote assets/stats.svg and assets/langs.svg");
console.log("languages:", top.map((l) => `${l.name} ${((l.size / totalBytes) * 100).toFixed(1)}%`).join(", "));
console.log("rows:", JSON.stringify(rows));
