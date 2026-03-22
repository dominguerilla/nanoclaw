import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.resolve(__dirname, '../store/messages.db'));

const TELEGRAM_JID = 'tg:8691901790';
const FOLDER = 'telegram_main';
const now = new Date().toISOString();

// ── Update containerConfig for telegram_main ────────────────────────────────
const row = db.prepare('SELECT container_config FROM registered_groups WHERE jid = ?').get(TELEGRAM_JID);
if (!row) { console.error('telegram_main not found'); process.exit(1); }

const existing = row.container_config ? JSON.parse(row.container_config) : {};
const newConfig = {
  ...existing,
  additionalMounts: [{
    hostPath: '/home/mondo/Projects/nanoclaw',
    containerPath: 'project-rw',
    readonly: false,
  }],
};
db.prepare('UPDATE registered_groups SET container_config = ? WHERE jid = ?')
  .run(JSON.stringify(newConfig), TELEGRAM_JID);
console.log('Updated containerConfig for telegram_main.');

// ── Guard against duplicate tasks ───────────────────────────────────────────
const existing_tasks = db.prepare(
  "SELECT id FROM scheduled_tasks WHERE group_folder = ? AND status = 'active'"
).all(FOLDER);
if (existing_tasks.length > 0) {
  console.log('Active tasks already exist — skipping. Delete them first to reset.');
  existing_tasks.forEach(t => console.log(' -', t.id));
  db.close(); process.exit(0);
}

// ── Improvement task prompt ──────────────────────────────────────────────────
const IMPROVEMENT_PROMPT = `You are running your daily self-improvement cycle for NanoClaw.

## Focus
Code readability, modularity, and overall hygiene. One focused change per run.

## Access
- Writable project: /workspace/extra/project-rw/
- GitHub token: /workspace/group/github_token
- Read-only reference: /workspace/project/

## Workflow
1. ANALYZE — Scan the codebase for readability, modularity, or hygiene issues. Check /workspace/group/improvement-log.md for queued ideas. Pick ONE focused improvement.
2. PLAN — Write what you'll change and why to /workspace/group/improvement-log.md before touching code.
3. BRANCH — cd /workspace/extra/project-rw && git config user.name "Diwa (NanoClaw)" && git config user.email "nanoclaw@localhost" && git checkout -b improvement/$(date +%Y%m%d-%H%M%S)
4. IMPLEMENT — Make the change. One logical improvement only.
5. TEST — npm run build (must pass). Run npx vitest run if relevant. Fix failures before continuing.
6. COMMIT — git add [files] && git commit -m "improvement: [description]"
7. PUSH — TOKEN=$(cat /workspace/group/github_token) && git push "https://x-access-token:\${TOKEN}@github.com/dominguerilla/nanoclaw.git" HEAD
8. PR — Create PR via GitHub REST API (see CLAUDE.md in /workspace/group/).
9. REPORT — Send a Telegram message via mcp__nanoclaw__send_message: what changed, why, PR URL.

## Security-Critical Files (DO NOT MODIFY AUTONOMOUSLY)
credential-proxy.ts, mount-security.ts, ipc-auth.ts, ipc.ts (auth sections)
→ Analyze freely. Present specific benefits/risks in your report and ask the user to approve before committing changes.

## Good Improvement Examples
- Extract long functions into well-named helpers
- Replace 'any' types with proper TypeScript types
- Rename unclear variables or functions
- Break up large files into focused modules
- Remove dead code or redundant comments
- Improve error messages to be more actionable
- Fix inconsistent naming conventions`;

// ── Reflection task prompt ───────────────────────────────────────────────────
const REFLECTION_PROMPT = `You are running your daily reflection cycle for NanoClaw.

1. Review /workspace/group/conversations/ for patterns in user requests and recurring friction.
2. Check /workspace/extra/project-rw/groups/telegram_main/logs/ for any container errors.
3. Review /workspace/group/improvement-log.md — what's been done, what's queued for tomorrow.
4. If insights apply to ALL groups, update /workspace/extra/project-rw/groups/global/CLAUDE.md.
5. Update improvement-log.md with today's observations and tomorrow's top priority.
6. Send a brief Telegram message via mcp__nanoclaw__send_message: key observations, recent improvement, what's next.

Keep it to 3-5 bullet points. No fluff.`;

// ── Insert tasks ─────────────────────────────────────────────────────────────
const insert = db.prepare(`
  INSERT INTO scheduled_tasks
    (id, group_folder, chat_jid, prompt, schedule_type, schedule_value,
     context_mode, next_run, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Daily 3am Pacific = 11:00 UTC | Daily 9am Pacific = 17:00 UTC
const improvId = `self-improve-${crypto.randomUUID()}`;
const reflectId = `self-reflect-${crypto.randomUUID()}`;

insert.run(improvId, FOLDER, TELEGRAM_JID, IMPROVEMENT_PROMPT,
  'cron', '0 3 * * *', 'group', '2026-03-23T11:00:00.000Z', 'active', now);
console.log('Inserted improvement task:', improvId);

insert.run(reflectId, FOLDER, TELEGRAM_JID, REFLECTION_PROMPT,
  'cron', '0 9 * * *', 'group', '2026-03-23T17:00:00.000Z', 'active', now);
console.log('Inserted reflection task:', reflectId);

db.close();
console.log('\nDone. Restart nanoclaw for changes to take effect.');
