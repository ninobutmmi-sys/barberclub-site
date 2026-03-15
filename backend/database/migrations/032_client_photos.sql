-- Migration 032: Client photos (max 2 per client)
-- Photos stored as base64 JPEG, compressed client-side (~100-150Ko)

CREATE TABLE IF NOT EXISTS client_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    photo_data TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES barbers(id) ON DELETE SET NULL
);

CREATE INDEX idx_client_photos_client ON client_photos(client_id);
