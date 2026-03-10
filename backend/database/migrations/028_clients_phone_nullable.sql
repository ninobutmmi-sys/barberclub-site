-- Migration 028: Allow NULL phone on clients (admin walk-in bookings without phone)
ALTER TABLE clients ALTER COLUMN phone DROP NOT NULL;
