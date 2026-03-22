import fs from 'fs';
import path from 'path';
import blessed from 'blessed';
import contrib from 'blessed-contrib';

const STATUS_PATH = path.join(
  process.env.NANOCLAW_DATA_DIR || './data',
  'status.json',
);

interface Status {
  writtenAt: string;
  uptimeSeconds: number;
  queue: {
    activeCount: number;
    maxConcurrent: number;
    waitingCount: number;
    groups: Array<{
      jid: string;
      active: boolean;
      isTaskContainer: boolean;
      runningTaskId: string | null;
      containerName: string | null;
      groupFolder: string | null;
    }>;
  };
  channels: Array<{ name: string; connected: boolean }>;
  upcomingTasks: Array<{
    id: string;
    groupFolder: string;
    scheduleType: string;
    nextRun: string | null;
    prompt: string;
  }>;
  system: {
    loadAvg1: number;
    memUsedMb: number;
    memTotalMb: number;
    tempC: number | null;
  };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatNextRun(iso: string | null): string {
  if (!iso) return '?';
  const d = new Date(iso);
  const now = new Date();
  // Same day → show time, else show day name
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function readStatus(): Status | null {
  try {
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf-8')) as Status;
  } catch {
    return null;
  }
}

// --- Build screen ---
const screen = blessed.screen({ smartCSR: true, title: 'NanoClaw' });
const grid = new contrib.grid({ rows: 12, cols: 12, screen });

// Top-left: Container status
const containerBox = grid.set(0, 0, 4, 4, blessed.box, {
  label: ' Containers ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
}) as blessed.Widgets.BoxElement;

// Top-right: Channels
const channelBox = grid.set(0, 4, 4, 8, blessed.box, {
  label: ' Channels ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
}) as blessed.Widgets.BoxElement;

// Middle: Log (recent messages placeholder — future extension)
const logBox = grid.set(4, 0, 4, 12, contrib.log, {
  label: ' Activity ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
  scrollable: true,
  alwaysScroll: true,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

// Bottom-left: Tasks
const taskBox = grid.set(8, 0, 4, 6, blessed.box, {
  label: ' Upcoming Tasks ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
}) as blessed.Widgets.BoxElement;

// Bottom-right: System
const sysBox = grid.set(8, 6, 4, 6, blessed.box, {
  label: ' System ',
  border: { type: 'line' },
  tags: true,
  style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
}) as blessed.Widgets.BoxElement;

let lastWrittenAt = '';

function poll(): void {
  const s = readStatus();
  if (!s) {
    containerBox.setContent('{red-fg}Waiting for status.json...{/red-fg}');
    screen.render();
    return;
  }

  // Skip re-render if nothing changed
  if (s.writtenAt === lastWrittenAt) return;
  lastWrittenAt = s.writtenAt;

  // Containers
  const activeGroups = s.queue.groups.filter(g => g.active);
  const containerLines = [
    `{bold}${s.queue.activeCount}/{s.queue.maxConcurrent}{/bold} active`,
    `${s.queue.waitingCount} waiting`,
    '',
    ...activeGroups.slice(0, 6).map(g => {
      const label = g.groupFolder || g.jid.split('@')[0];
      const tag = g.isTaskContainer ? '{yellow-fg}[task]{/yellow-fg}' : '{green-fg}[msg]{/green-fg}';
      return `${tag} ${label}`;
    }),
  ];
  containerBox.setContent(containerLines.join('\n'));

  // Channels
  const channelLines = s.channels.map(ch => {
    const dot = ch.connected ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';
    const status = ch.connected ? '{green-fg}connected{/green-fg}' : '{red-fg}disconnected{/red-fg}';
    return `${dot} {bold}${ch.name.padEnd(12)}{/bold} ${status}`;
  });
  channelBox.setContent(channelLines.join('\n'));

  // Log: add a heartbeat line when idle
  if (activeGroups.length === 0) {
    const ts = new Date(s.writtenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logBox.log(`{grey-fg}[${ts}] idle — ${s.queue.activeCount}/${s.queue.maxConcurrent} containers active{/grey-fg}`);
  } else {
    const ts = new Date(s.writtenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    for (const g of activeGroups) {
      const label = g.groupFolder || g.jid.split('@')[0];
      logBox.log(`{green-fg}[${ts}] active: ${label}${g.isTaskContainer ? ' (task)' : ''}{/green-fg}`);
    }
  }

  // Tasks
  const taskLines = s.upcomingTasks.slice(0, 8).map(t => {
    const when = formatNextRun(t.nextRun);
    const label = t.groupFolder.padEnd(12).slice(0, 12);
    return `{yellow-fg}${when.padEnd(8)}{/yellow-fg} {bold}${label}{/bold} ${t.prompt.slice(0, 20)}`;
  });
  if (taskLines.length === 0) taskLines.push('{grey-fg}no upcoming tasks{/grey-fg}');
  taskBox.setContent(taskLines.join('\n'));

  // System
  const sys = s.system;
  const temp = sys.tempC != null ? `${sys.tempC.toFixed(1)}°C` : 'n/a';
  const loadColor = sys.loadAvg1 > 3 ? 'red-fg' : sys.loadAvg1 > 1.5 ? 'yellow-fg' : 'green-fg';
  const memPct = Math.round((sys.memUsedMb / sys.memTotalMb) * 100);
  const memColor = memPct > 85 ? 'red-fg' : memPct > 60 ? 'yellow-fg' : 'green-fg';
  const sysLines = [
    `CPU:  {${loadColor}}${sys.loadAvg1.toFixed(2)} load{/${loadColor}}`,
    `RAM:  {${memColor}}${sys.memUsedMb}/${sys.memTotalMb} MB{/${memColor}}`,
    `Temp: ${temp}`,
    `Up:   ${formatUptime(s.uptimeSeconds)}`,
  ];
  sysBox.setContent(sysLines.join('\n'));

  screen.render();
}

// Initial render
poll();
setInterval(poll, 2000);

// Exit handlers
screen.key(['q', 'C-c'], () => process.exit(0));
