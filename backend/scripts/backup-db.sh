#!/bin/bash
# BarberClub — Daily database backup script
# Run via cron: 0 4 * * * /path/to/backup-db.sh
#
# Requirements: pg_dump, gzip
# Config: set DATABASE_URL env var or edit below

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/barberclub-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/barberclub_$TIMESTAMP.sql.gz"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting BarberClub DB backup..."

# Use DATABASE_URL if set, otherwise use individual vars
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$BACKUP_FILE"
else
  echo "ERROR: DATABASE_URL is not set"
  exit 1
fi

# Check if backup was created successfully
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[$(date)] Backup successful: $BACKUP_FILE ($SIZE)"
else
  echo "[$(date)] ERROR: Backup file is empty or missing"
  exit 1
fi

# Clean up old backups (older than RETENTION_DAYS)
DELETED=$(find "$BACKUP_DIR" -name "barberclub_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] Cleaned up $DELETED old backups (>$RETENTION_DAYS days)"
fi

echo "[$(date)] Backup complete."
