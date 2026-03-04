-- Migration 020: Guest assignments (barber invité cross-salon)
-- Allows a barber from one salon to work as a guest at another salon on specific dates

CREATE TABLE IF NOT EXISTS guest_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  host_salon_id VARCHAR(20) NOT NULL,
  date DATE NOT NULL,
  start_time TIME NOT NULL DEFAULT '09:00',
  end_time TIME NOT NULL DEFAULT '19:00',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(barber_id, date)
);

CREATE INDEX idx_guest_assignments_date ON guest_assignments(date);
CREATE INDEX idx_guest_assignments_barber ON guest_assignments(barber_id);
CREATE INDEX idx_guest_assignments_salon_date ON guest_assignments(host_salon_id, date);
