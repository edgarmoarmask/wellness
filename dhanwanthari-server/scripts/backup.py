"""Online backup of the SQLite database (safe while the server is running).

    uv run python scripts/backup.py                 # → data/backups/clinic-YYYYmmdd-HHMM.db, keeps the newest 30
    uv run python scripts/backup.py --keep 90 --dir /mnt/backup

Schedule it (cron, every night 1am):  0 1 * * *  cd /opt/dhanwanthari/server && uv run python scripts/backup.py
Copy the backup folder off the machine too (another disk, NAS or cloud drive).
"""
import argparse
import os
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
url = os.environ.get("DATABASE_URL", f"sqlite:///{ROOT / 'data' / 'clinic.db'}")
src = Path(url.removeprefix("sqlite:///"))

ap = argparse.ArgumentParser()
ap.add_argument("--dir", default=str(src.parent / "backups"))
ap.add_argument("--keep", type=int, default=30)
a = ap.parse_args()

out_dir = Path(a.dir)
out_dir.mkdir(parents=True, exist_ok=True)
dest = out_dir / f"clinic-{datetime.now():%Y%m%d-%H%M}.db"
with sqlite3.connect(src) as s, sqlite3.connect(dest) as d:
    s.backup(d)
ok = sqlite3.connect(dest).execute("PRAGMA integrity_check").fetchone()[0]
print(f"backup {dest} ({dest.stat().st_size // 1024} KB) integrity={ok}")
for old in sorted(out_dir.glob("clinic-*.db"))[:-a.keep]:
    old.unlink()
