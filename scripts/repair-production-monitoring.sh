#!/usr/bin/env bash
# Idempotent host repair: retain all credentials and publish only backup health metadata.
# Run as root after copying the reviewed backup scripts and systemd unit to /opt/devon.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Run as root'; exit 77; }
install -d -m 0755 -o devon -g devon /var/lib/devon/backup-status
python3 - <<'PY'
from pathlib import Path
def update(path, values):
    p = Path(path)
    lines = p.read_text().splitlines()
    found = set()
    for i, line in enumerate(lines):
        key = line.partition('=')[0]
        if key in values:
            lines[i] = key + '=' + values[key]
            found.add(key)
    lines.extend(k + '=' + v for k, v in values.items() if k not in found)
    p.write_text('\n'.join(lines) + '\n')
    p.chmod(0o600)
update('/etc/devon/backup.env', {
    'BACKUP_STATUS_DIR': '/var/lib/devon/backup-status',
    'BACKUP_STORAGE_VOLUME': 'devon_api_storage',
    'BACKUP_COMPOSE_FILE': '/opt/devon/infra/docker-compose.prod.yml',
})
update('/opt/devon/.env', {'AI_MODEL': 'glm-5.3', 'BACKUP_STATUS_DIR': '/var/lib/devon/backup-status'})
PY
install -m 0644 /opt/devon/infra/backup/systemd/devon-restore-drill.service /etc/systemd/system/devon-restore-drill.service
systemctl daemon-reload
systemctl start devon-backup.service
systemctl start devon-backup-verify.service
systemctl start devon-restore-drill.service
systemctl show devon-backup.service devon-backup-verify.service devon-restore-drill.service --property=Id,Result
