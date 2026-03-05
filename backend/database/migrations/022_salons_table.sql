-- Migration 022: Create salons reference table + FK constraints
-- Prevents typos in salon_id (e.g. 'meylon' instead of 'meylan')

CREATE TABLE IF NOT EXISTS salons (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address VARCHAR(200),
    phone VARCHAR(20),
    google_review_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the two salons
INSERT INTO salons (id, name, address, phone) VALUES
    ('meylan', 'BarberClub Meylan', '26 Av. du Grésivaudan, 38700 Corenc', ''),
    ('grenoble', 'BarberClub Grenoble', '5 Rue Clôt Bey, 38000 Grenoble', '09 56 30 93 86')
ON CONFLICT (id) DO NOTHING;

-- Add FK constraints on all tables with salon_id
ALTER TABLE barbers ADD CONSTRAINT fk_barbers_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE services ADD CONSTRAINT fk_services_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE bookings ADD CONSTRAINT fk_bookings_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE schedules ADD CONSTRAINT fk_schedules_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE schedule_overrides ADD CONSTRAINT fk_schedule_overrides_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE blocked_slots ADD CONSTRAINT fk_blocked_slots_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE notification_queue ADD CONSTRAINT fk_notification_queue_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE payments ADD CONSTRAINT fk_payments_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE register_closings ADD CONSTRAINT fk_register_closings_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE products ADD CONSTRAINT fk_products_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE product_sales ADD CONSTRAINT fk_product_sales_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE gift_cards ADD CONSTRAINT fk_gift_cards_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE waitlist ADD CONSTRAINT fk_waitlist_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE campaigns ADD CONSTRAINT fk_campaigns_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
ALTER TABLE automation_triggers ADD CONSTRAINT fk_automation_triggers_salon FOREIGN KEY (salon_id) REFERENCES salons(id);
