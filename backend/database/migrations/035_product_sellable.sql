-- 035: Add sellable flag to products (false = internal stock only, not for sale)
ALTER TABLE products ADD COLUMN IF NOT EXISTS sellable BOOLEAN NOT NULL DEFAULT true;
