-- Migration 044: Barber CRUD support
-- photo_url: VARCHAR(500) -> TEXT (pour base64 data URLs)

ALTER TABLE barbers ALTER COLUMN photo_url TYPE TEXT;
