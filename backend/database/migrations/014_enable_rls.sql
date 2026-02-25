-- ============================================
-- Migration 014: Enable Row Level Security (RLS)
-- Fixes Supabase security warnings (40 errors)
--
-- Note: Our backend connects via direct pg pool (postgres role)
-- which bypasses RLS. This protects against direct Supabase
-- client access (anon/authenticated keys) only.
-- ============================================

-- Enable RLS on all tables
ALTER TABLE barbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE barber_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_triggers ENABLE ROW LEVEL SECURITY;

-- Deny all access via Supabase anon/authenticated keys by default.
-- No SELECT/INSERT/UPDATE/DELETE policies = no access from Supabase JS client.
-- Our backend uses the postgres role (superuser) which bypasses RLS entirely,
-- so this does NOT affect our API at all.

-- Allow the postgres role (our backend) full access explicitly
-- (superuser already bypasses RLS, but this is belt-and-suspenders)
CREATE POLICY "Backend full access on barbers" ON barbers FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on services" ON services FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on barber_services" ON barber_services FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on schedules" ON schedules FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on schedule_overrides" ON schedule_overrides FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on clients" ON clients FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on bookings" ON bookings FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on notification_queue" ON notification_queue FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on refresh_tokens" ON refresh_tokens FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on blocked_slots" ON blocked_slots FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on payments" ON payments FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on register_closings" ON register_closings FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on products" ON products FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on product_sales" ON product_sales FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on gift_cards" ON gift_cards FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on waitlist" ON waitlist FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on campaigns" ON campaigns FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on campaign_clicks" ON campaign_clicks FOR ALL TO postgres USING (true) WITH CHECK (true);
CREATE POLICY "Backend full access on automation_triggers" ON automation_triggers FOR ALL TO postgres USING (true) WITH CHECK (true);
