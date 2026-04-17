-- Add barcode printing permission to permissions table
-- Run this SQL script on your Supabase database

-- Add the new column to permissions table
ALTER TABLE permissions 
ADD COLUMN IF NOT EXISTS can_print_barcode_labels BOOLEAN NOT NULL DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN permissions.can_print_barcode_labels IS 'Allows user to print barcode labels for products';

-- Update existing users to have the permission (optional - they already have it as default)
-- UPDATE permissions SET can_print_barcode_labels = true WHERE can_print_barcode_labels IS NULL;

-- Verify the column was added
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'permissions' 
AND column_name = 'can_print_barcode_labels';

-- Show sample of updated permissions table
SELECT user_id, can_view_dashboard, can_edit_products, can_print_barcode_labels 
FROM permissions 
LIMIT 5;