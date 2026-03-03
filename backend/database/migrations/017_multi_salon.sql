-- ============================================
-- 017: Multi-salon support
-- Adds salon_id column to all salon-specific tables
-- Default 'meylan' preserves existing data
-- ============================================

-- Barbers
ALTER TABLE barbers ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Services
ALTER TABLE services ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Bookings
ALTER TABLE bookings ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Schedules
ALTER TABLE schedules ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Schedule overrides
ALTER TABLE schedule_overrides ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Blocked slots
ALTER TABLE blocked_slots ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Notification queue
ALTER TABLE notification_queue ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Payments
ALTER TABLE payments ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Register closings
ALTER TABLE register_closings ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Products
ALTER TABLE products ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Product sales
ALTER TABLE product_sales ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Gift cards
ALTER TABLE gift_cards ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Waitlist
ALTER TABLE waitlist ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Campaigns
ALTER TABLE campaigns ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- Automation triggers
ALTER TABLE automation_triggers ADD COLUMN salon_id VARCHAR(20) NOT NULL DEFAULT 'meylan';

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_barbers_salon ON barbers(salon_id);
CREATE INDEX idx_bookings_salon ON bookings(salon_id, date, status);
CREATE INDEX idx_services_salon ON services(salon_id);

-- ============================================
-- Update unique constraints for multi-salon
-- ============================================

-- barbers.email: multiple barbers can share one login email per salon
ALTER TABLE barbers DROP CONSTRAINT IF EXISTS barbers_email_key;
DROP INDEX IF EXISTS idx_barbers_email;
CREATE INDEX idx_barbers_email ON barbers(email, salon_id) WHERE deleted_at IS NULL;

-- automation_triggers.type: was UNIQUE per type, now UNIQUE per (type, salon_id)
ALTER TABLE automation_triggers DROP CONSTRAINT IF EXISTS automation_triggers_type_key;
CREATE UNIQUE INDEX idx_automation_triggers_type_salon ON automation_triggers(type, salon_id);
