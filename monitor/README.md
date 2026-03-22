# NanoClaw Monitor

Real-time status displays for NanoClaw. Two interfaces share a single `status.json` data source:

- *LCD* — interactive terminal dashboard (runs on TTY2)
- *OLED* — hardware 128×64 SSD1306 display connected via I2C

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  NanoClaw Core (src/status-writer.ts)        │
│  Writes every 2 seconds                      │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  data/status.json     │
        │  (file-based IPC)     │
        └──────────┬────────────┘
        ┌──────────┴────────────┐
        │                       │
   ┌────▼────────┐     ┌───────▼──────┐
   │  lcd.ts     │     │  oled.py     │
   │  Node.js    │     │  Python 3    │
   │  2s polling │     │  5s/page     │
   │  TTY2       │     │  I2C device  │
   └─────────────┘     └──────────────┘
```

### Data Flow

`src/status-writer.ts` runs as a background interval in the core NanoClaw process. Every 2 seconds it collects metrics and writes them atomically (`.tmp` → rename) to `data/status.json`. Both monitor daemons poll this file independently.

### Status Schema

```typescript
{
  writtenAt: string;          // ISO timestamp
  uptimeSeconds: number;      // Process uptime
  queue: {
    active: number;           // Running containers
    waiting: number;          // Queued groups
    groups: {
      name: string;
      tag: "message" | "task";
    }[];
  };
  channels: {
    name: string;
    connected: boolean;
  }[];
  upcomingTasks: {
    prompt: string;
    schedule: string;         // Cron or interval
    nextRun: string;          // ISO timestamp
  }[];
  system: {
    loadAvg: number;          // 1-min load average
    memUsed: number;          // bytes
    memTotal: number;         // bytes
    tempCelsius: number | null; // Linux only
  };
}
```

---

## Files

| File | Purpose |
|------|---------|
| `lcd.ts` | Terminal dashboard (blessed) |
| `oled.py` | Hardware OLED display (Python 3) |
| `nanoclaw-lcd.service` | systemd service for LCD on TTY2 |
| `nanoclaw-oled.service` | systemd service for OLED daemon |
| `tsconfig.json` | TypeScript config (compiles to `../dist/monitor/`) |
| `blessed-contrib.d.ts` | Type shim for blessed-contrib |

---

## LCD Dashboard (`lcd.ts`)

A full-screen terminal UI built with `blessed` and `blessed-contrib`. Polls `status.json` every 2 seconds and skips re-renders if nothing changed.

### Layout (12×12 grid)

```
┌─ Containers (4×4) ─┬──── Channels (8×4) ────┐
│  Active: 2         │  • whatsapp  ● connected │
│  Waiting: 1        │  • telegram  ● connected │
│  [group-a] msg     │  • discord   ○ disconn.  │
│  [group-b] task    │                          │
├────────────── Activity Log (12×4) ───────────┤
│  ⟳ group-a: processing message               │
│  ⟳ group-b: running scheduled task           │
├─ Upcoming Tasks (6×4) ─┬── System (6×4) ─────┤
│  14:30 check deploy    │  Load:  1.24          │
│  Mon   daily report    │  RAM:   62% (4.1 GB)  │
│                        │  Temp:  48°C          │
│                        │  Up:    2d 4h 12m     │
└────────────────────────┴──────────────────────┘
```

### Color Coding

| Color | Meaning |
|-------|---------|
| Green | Connected channel, active message container |
| Yellow | Task container, upcoming task time |
| Red | Disconnected channel, load > 3, memory > 85% |
| Cyan | UI borders and labels |
| Grey | Idle / unavailable |

### Controls

- `q` or `Ctrl+C` — exit

### Build & Run

```bash
# Build
cd /workspace/extra/project-rw
npm run build    # compiles monitor/lcd.ts → dist/monitor/lcd.js

# Run manually
NANOCLAW_DATA_DIR=./data node dist/monitor/lcd.js
```

---

## OLED Display (`oled.py`)

Python 3 script that drives a 128×64 SSD1306 OLED over I2C (bus 1, address `0x3C`). Rotates through three pages every 5 seconds.

### Pages

1. *Agent* — active containers, waiting groups, channel status
2. *System* — temperature, CPU load, RAM, uptime
3. *Activity* — last status update age, upcoming task count, next task details

### Dependencies

```bash
pip install luma.oled pillow
```

The script attempts to load `DejaVuSansMono` from `/usr/share/fonts/truetype/dejavu/` for crisp rendering and falls back to the luma default bitmap font if unavailable.

### Run manually

```bash
NANOCLAW_DATA_DIR=./data python3 monitor/oled.py
```

---

## systemd Services

### LCD — `nanoclaw-lcd.service`

Runs the terminal dashboard on TTY2 (`Ctrl+Alt+F2`).

```bash
# Install
sudo cp monitor/nanoclaw-lcd.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nanoclaw-lcd.service

# Check status
sudo systemctl status nanoclaw-lcd.service
journalctl -u nanoclaw-lcd.service -f
```

Key settings:
- Switches to VT2 via `chvt 2` before launch
- `TERM=linux` for proper terminal rendering
- Restarts after 5 s on crash
- Depends on `nanoclaw.service`

### OLED — `nanoclaw-oled.service`

Runs the OLED daemon as a user service.

```bash
# Install (user-level)
cp monitor/nanoclaw-oled.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-oled.service

# Check status
systemctl --user status nanoclaw-oled.service
journalctl --user -u nanoclaw-oled.service -f
```

Key settings:
- Restarts after 10 s on crash (Python startup overhead)
- Depends on `nanoclaw.service`
- Requires I2C access (user must be in `i2c` group: `sudo usermod -aG i2c $USER`)

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NANOCLAW_DATA_DIR` | `./data` | Directory containing `status.json` |

Polling intervals and page durations are hardcoded:
- LCD: 2000 ms
- OLED: 5000 ms per page (15 s full rotation)

---

## Maintenance

### Adding a new LCD panel

1. Add a new box/widget in `lcd.ts` using `grid.set(row, col, rowSpan, colSpan, blessed.box, opts)`
2. Populate it inside the `render()` function using data from `readStatus()`
3. Rebuild: `npm run build`

### Adding a new OLED page

1. Add a new `elif page == N:` block in `oled.py`
2. Increment the page count in the rotation logic (`page = (page + 1) % N`)
3. Use `draw_page(lines)` where `lines[0]` is bold and the rest are smaller

### Adding a new status field

1. Update the `Status` interface in `src/status-writer.ts`
2. Populate the field in `startStatusWriter()`
3. Consume the field in `lcd.ts` and/or `oled.py`

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| LCD blank / not updating | Check `NANOCLAW_DATA_DIR`, run `systemctl status nanoclaw-lcd` |
| OLED shows "NanoClaw / read error" | `status.json` missing or malformed; check main process |
| OLED not found (`OSError`) | Verify I2C wiring, `i2cdetect -y 1` should show `0x3c` |
| Font rendering looks bad | Install `fonts-dejavu-core` (`sudo apt install fonts-dejavu-core`) |
| High CPU from LCD | Unlikely — polling skips render if status unchanged; check blessed version |

---

## Security Notes

- Both daemons run as unprivileged users with *read-only* access to `status.json`
- No network exposure — purely local file and hardware I/O
- I2C access requires the user to be in the `i2c` group; no root needed
- `status.json` contains operational metadata only — no credentials or message content
