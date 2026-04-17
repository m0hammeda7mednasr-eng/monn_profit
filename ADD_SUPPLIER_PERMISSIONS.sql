-- Add dedicated supplier permissions to permissions table
-- Run this SQL script on your Supabase database

ALTER TABLE permissions
ADD COLUMN IF NOT EXISTS can_view_suppliers BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS can_edit_suppliers BOOLEAN NOT NULL DEFAULT false;

UPDATE permissions
SET can_view_suppliers = COALESCE(can_view_products, false),
    can_edit_suppliers = COALESCE(can_edit_products, false);

COMMENT ON COLUMN permissions.can_view_suppliers IS 'Allows user to view suppliers and supplier balances';
COMMENT ON COLUMN permissions.can_edit_suppliers IS 'Allows user to manage suppliers, deliveries, and payments';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'permissions'
AND column_name IN ('can_view_suppliers', 'can_edit_suppliers')
ORDER BY column_name;

SELECT user_id, can_view_products, can_edit_products, can_view_suppliers, can_edit_suppliers
FROM permissions
LIMIT 5;
