-- ============================================
-- Migration 007: Products/Stock, Gift Cards, Waitlist, Campaign Tracking, Automation
-- ============================================

-- ============================================
-- 1. Products (Boutique / Stock)
-- ============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(100) DEFAULT 'autre',
  buy_price INTEGER DEFAULT 0 CHECK (buy_price >= 0),
  sell_price INTEGER NOT NULL CHECK (sell_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  alert_threshold INTEGER NOT NULL DEFAULT 5,
  sku VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ============================================
-- 2. Product Sales
-- ============================================
CREATE TABLE IF NOT EXISTS product_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  total_price INTEGER NOT NULL CHECK (total_price >= 0),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'cb' CHECK (payment_method IN ('cb', 'cash', 'lydia', 'other')),
  sold_by UUID REFERENCES barbers(id),
  client_id UUID REFERENCES clients(id),
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_sales_date ON product_sales(sold_at);
CREATE INDEX IF NOT EXISTS idx_product_sales_product ON product_sales(product_id);

-- ============================================
-- 3. Gift Cards
-- ============================================
CREATE TABLE IF NOT EXISTS gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  initial_amount INTEGER NOT NULL CHECK (initial_amount > 0),
  balance INTEGER NOT NULL CHECK (balance >= 0),
  buyer_name VARCHAR(200),
  buyer_client_id UUID REFERENCES clients(id),
  recipient_name VARCHAR(200),
  recipient_email VARCHAR(255),
  payment_method VARCHAR(20) DEFAULT 'cb' CHECK (payment_method IN ('cb', 'cash', 'lydia', 'other')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at DATE,
  sold_by UUID REFERENCES barbers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_active ON gift_cards(is_active) WHERE is_active = true;

-- ============================================
-- 4. Waitlist
-- ============================================
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  client_name VARCHAR(200) NOT NULL,
  client_phone VARCHAR(20) NOT NULL,
  barber_id UUID NOT NULL REFERENCES barbers(id),
  service_id UUID NOT NULL REFERENCES services(id),
  preferred_date DATE NOT NULL,
  preferred_time_start TIME,
  preferred_time_end TIME,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'booked', 'expired')),
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(status) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_waitlist_date ON waitlist(preferred_date);
CREATE INDEX IF NOT EXISTS idx_waitlist_barber_date ON waitlist(barber_id, preferred_date);

-- ============================================
-- 5. Campaign Tracking
-- ============================================
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('sms', 'email')),
  name VARCHAR(200) NOT NULL,
  tracking_code VARCHAR(50) NOT NULL UNIQUE,
  message_preview TEXT,
  recipients_count INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  bookings_generated INTEGER NOT NULL DEFAULT 0,
  revenue_generated INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tracking ON campaigns(tracking_code);
CREATE INDEX IF NOT EXISTS idx_campaigns_sent ON campaigns(sent_at);

CREATE TABLE IF NOT EXISTS campaign_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address VARCHAR(45),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaign_clicks_campaign ON campaign_clicks(campaign_id);

-- ============================================
-- 6. Automation Triggers Configuration
-- ============================================
CREATE TABLE IF NOT EXISTS automation_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default automation configs
INSERT INTO automation_triggers (type, is_active, config) VALUES
  ('review_sms', false, '{"delay_minutes": 60, "message": "Merci pour ta visite {prenom} ! Laisse-nous un avis : {lien_avis}", "google_review_url": ""}'),
  ('reactivation_sms', false, '{"inactive_days": 45, "message": "Salut {prenom}, ca fait un moment ! Ton barber t''attend chez BarberClub. Reserve vite : {lien_reservation}"}'),
  ('waitlist_notify', false, '{"message": "Bonne nouvelle {prenom} ! Une place s''est liberee le {date} a {heure} chez BarberClub. Reserve vite : {lien_reservation}"}')
ON CONFLICT (type) DO NOTHING;

-- ============================================
-- 7. Add is_first_visit to bookings (for NEW badge)
-- ============================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_first_visit BOOLEAN DEFAULT false;

-- ============================================
-- 8. Add campaign_id to bookings (for ROI tracking)
-- ============================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id);
CREATE INDEX IF NOT EXISTS idx_bookings_campaign ON bookings(campaign_id) WHERE campaign_id IS NOT NULL;

-- ============================================
-- 9. Backfill is_first_visit for existing bookings
-- ============================================
WITH first_visits AS (
  SELECT DISTINCT ON (client_id) id
  FROM bookings
  WHERE deleted_at IS NULL AND status != 'cancelled'
  ORDER BY client_id, created_at ASC
)
UPDATE bookings SET is_first_visit = true WHERE id IN (SELECT id FROM first_visits);
