-- Fix supplier permissions default values
-- This script updates existing permissions to set can_view_suppliers to false by default
-- Run this SQL script on your Supabase database after updating the code

-- Update existing permissions to set can_view_suppliers to false for non-admin users
UPDATE permissions 
SET can_view_suppliers = false 
WHERE can_view_suppliers = true 
AND user_id NOT IN (
  SELECT id FROM users WHERE role = 'admin'
);

-- Update the default value for the column to false
ALTER TABLE permissions 
ALTER COLUMN can_view_suppliers SET DEFAULT false;

-- Verify the changes
SELECT 
  u.name,
  u.role,
  p.can_view_suppliers,
  p.can_edit_suppliers
FROM permissions p
JOIN users u ON p.user_id = u.id
ORDER BY u.role DESC, u.name;

-- Show column default
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'permissions'
AND column_name = 'can_view_suppliers';