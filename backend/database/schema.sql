-- ============================================
-- BarberClub Meylan - Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- BARBERS
-- ============================================
CREATE TABLE barbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    role VARCHAR(200),
    photo_url VARCHAR(500),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_barbers_email ON barbers(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_barbers_active ON barbers(is_active) WHERE deleted_at IS NULL;

-- ============================================
-- SERVICES (prestations)
-- ============================================
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    duration INTEGER NOT NULL CHECK (duration > 0),
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_services_active ON services(is_active, sort_order) WHERE deleted_at IS NULL;

-- ============================================
-- BARBER <-> SERVICE relationship
-- ============================================
CREATE TABLE barber_services (
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (barber_id, service_id)
);

-- ============================================
-- SCHEDULES (default weekly hours)
-- ============================================
CREATE TABLE schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_working BOOLEAN DEFAULT true,
    UNIQUE (barber_id, day_of_week)
);

CREATE INDEX idx_schedules_barber ON schedules(barber_id);

-- ============================================
-- SCHEDULE OVERRIDES (holidays, special hours)
-- ============================================
CREATE TABLE schedule_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    barber_id UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    is_day_off BOOLEAN DEFAULT false,
    reason VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (barber_id, date)
);

CREATE INDEX idx_overrides_barber_date ON schedule_overrides(barber_id, date);

-- ============================================
-- CLIENTS
-- ============================================
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255),
    password_hash VARCHAR(255),
    has_account BOOLEAN DEFAULT false,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    notes TEXT,
    review_requested BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_clients_phone ON clients(phone) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_email ON clients(email) WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX idx_clients_created ON clients(created_at) WHERE deleted_at IS NULL;

-- ============================================
-- BOOKINGS (the core table)
-- ============================================
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id),
    barber_id UUID NOT NULL REFERENCES barbers(id),
    service_id UUID NOT NULL REFERENCES services(id),
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'completed', 'no_show', 'cancelled')),
    price INTEGER NOT NULL CHECK (price >= 0),
    cancel_token UUID NOT NULL DEFAULT uuid_generate_v4(),
    cancelled_at TIMESTAMPTZ,
    source VARCHAR(20) NOT NULL DEFAULT 'online'
        CHECK (source IN ('online', 'manual')),
    reminder_sent BOOLEAN DEFAULT false,
    review_email_sent BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Critical: prevent double booking for same barber at same time
-- Only applies to non-cancelled, non-deleted bookings
CREATE UNIQUE INDEX idx_bookings_no_overlap
    ON bookings(barber_id, date, start_time)
    WHERE status != 'cancelled' AND deleted_at IS NULL;

CREATE INDEX idx_bookings_date ON bookings(date, barber_id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_client ON bookings(client_id)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_status ON bookings(status, date)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_cancel_token ON bookings(cancel_token)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_reminder ON bookings(date, reminder_sent)
    WHERE status = 'confirmed' AND deleted_at IS NULL AND reminder_sent = false;
CREATE INDEX idx_bookings_review ON bookings(date, review_email_sent)
    WHERE status = 'completed' AND deleted_at IS NULL AND review_email_sent = false;

-- Analytics indexes
CREATE INDEX idx_bookings_analytics_date ON bookings(date, status, price)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_analytics_barber ON bookings(barber_id, date, status)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_analytics_service ON bookings(service_id, date, status)
    WHERE deleted_at IS NULL;

-- ============================================
-- NOTIFICATION QUEUE (retry failed emails/SMS)
-- ============================================
CREATE TABLE notification_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    type VARCHAR(30) NOT NULL
        CHECK (type IN ('confirmation_email', 'reminder_sms', 'review_email')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed')),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_pending ON notification_queue(next_retry_at)
    WHERE status = 'pending';
CREATE INDEX idx_notifications_booking ON notification_queue(booking_id);

-- ============================================
-- REFRESH TOKENS (auth sessions)
-- ============================================
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    user_type VARCHAR(10) NOT NULL CHECK (user_type IN ('barber', 'client')),
    token VARCHAR(500) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id, user_type);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ============================================
-- HELPER FUNCTION: Check if a time slot overlaps with existing bookings
-- Used for additional safety beyond the unique index
-- ============================================
CREATE OR REPLACE FUNCTION check_booking_overlap(
    p_barber_id UUID,
    p_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM bookings
        WHERE barber_id = p_barber_id
          AND date = p_date
          AND status != 'cancelled'
          AND deleted_at IS NULL
          AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
          AND start_time < p_end_time
          AND end_time > p_start_time
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- CLEANUP: Auto-delete expired refresh tokens
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM refresh_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
