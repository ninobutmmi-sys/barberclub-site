-- Event alerts: subscribers who want to be notified about upcoming events
CREATE TABLE IF NOT EXISTS event_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    salon_id VARCHAR(20) NOT NULL REFERENCES salons(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    notified_at TIMESTAMPTZ DEFAULT NULL,
    UNIQUE(email, event_name, salon_id)
);

CREATE INDEX IF NOT EXISTS idx_event_alerts_event ON event_alerts(event_name, salon_id);
