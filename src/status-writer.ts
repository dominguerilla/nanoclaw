import fs from 'fs';
import path from 'path';
import os from 'os';

import { DATA_DIR } from './config.js';
import type { GroupQueue } from './group-queue.js';
import { getAllTasks } from './db.js';
import { logger } from './logger.js';

interface StatusDeps {
  queue: GroupQueue;
  getChannels: () => Array<{ name: string; isConnected(): boolean }>;
}

export function startStatusWriter(
  deps: StatusDeps,
  intervalMs = 2000,
): NodeJS.Timeout {
  const write = () => {
    try {
      const queue = deps.queue.getStats();
      const channels = deps.getChannels().map((ch) => ({
        name: ch.name,
        connected: ch.isConnected(),
      }));
      const tasks = getAllTasks()
        .filter((t) => t.status === 'active' && t.next_run)
        .sort((a, b) => (a.next_run! < b.next_run! ? -1 : 1))
        .slice(0, 10)
        .map((t) => ({
          id: t.id,
          groupFolder: t.group_folder,
          scheduleType: t.schedule_type,
          nextRun: t.next_run,
          prompt: t.prompt.slice(0, 60),
        }));

      const status = {
        writtenAt: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        queue,
        channels,
        upcomingTasks: tasks,
        system: {
          loadAvg1: os.loadavg()[0],
          memUsedMb: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024),
          memTotalMb: Math.round(os.totalmem() / 1024 / 1024),
          tempC: readTempC(),
        },
      };

      const outPath = path.join(DATA_DIR, 'status.json');
      const tmpPath = `${outPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(status));
      fs.renameSync(tmpPath, outPath);
    } catch (err) {
      logger.debug({ err }, 'status-writer: write failed');
    }
  };
  write();
  return setInterval(write, intervalMs);
}

function readTempC(): number | null {
  try {
    return (
      parseInt(
        fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf-8'),
        10,
      ) / 1000
    );
  } catch {
    return null;
  }
}
