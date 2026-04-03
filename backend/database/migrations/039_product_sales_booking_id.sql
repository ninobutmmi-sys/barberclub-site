-- Add booking_id to product_sales so sales can be linked to a specific booking
ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_sales_booking_id ON product_sales(booking_id) WHERE booking_id IS NOT NULL;
