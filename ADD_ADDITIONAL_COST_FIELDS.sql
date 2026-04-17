-- Add additional cost fields to products table
-- Run this SQL script on your Supabase database

-- Add the new cost columns to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS ads_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS operation_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(10, 2) NOT NULL DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN products.ads_cost IS 'Advertising cost per unit for this product';
COMMENT ON COLUMN products.operation_cost IS 'Operational cost per unit for this product';
COMMENT ON COLUMN products.shipping_cost IS 'Shipping cost per unit for this product';

-- Verify the columns were added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'products' 
AND column_name IN ('ads_cost', 'operation_cost', 'shipping_cost')
ORDER BY column_name;

-- Show sample of updated products table
SELECT id, title, cost_price, ads_cost, operation_cost, shipping_cost 
FROM products 
LIMIT 5;