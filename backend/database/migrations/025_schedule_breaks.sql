-- ============================================
-- Migration 025: Schedule Breaks
-- Adds break_start and break_end columns to schedules
-- for recurring lunch/personal breaks per day.
-- ============================================

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS break_start TIME;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS break_end TIME;

-- Ensure break_end > break_start when both are set
ALTER TABLE schedules ADD CONSTRAINT schedules_break_valid
  CHECK (break_start IS NULL OR break_end IS NULL OR break_end > break_start);
