-- Fix direct permission dependencies only.
-- This script avoids granting broad extra access and only repairs the links
-- that are guaranteed by the app:
-- 1. Warehouse scanner/edit implies warehouse view.
-- 2. Warehouse scanner/edit implies barcode label printing.
-- 3. Order edit implies order view.

-- Repair live schema drift first so warehouse permissions can actually be saved.
ALTER TABLE permissions
  ADD COLUMN IF NOT EXISTS can_view_warehouse boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_edit_warehouse boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_print_barcode_labels boolean NOT NULL DEFAULT true;

-- Scanner users must be able to open warehouse screens and print barcode labels.
UPDATE permissions
SET can_view_warehouse = true,
    can_print_barcode_labels = true,
    updated_at = NOW()
WHERE can_edit_warehouse = true
  AND (
    can_view_warehouse = false
    OR can_print_barcode_labels = false
  );

-- Order editors must also be able to open orders, details, and shipping issue screens.
UPDATE permissions
SET can_view_orders = true,
    updated_at = NOW()
WHERE can_edit_orders = true
  AND can_view_orders = false;

-- Show the results.
SELECT
    u.name,
    u.email,
    p.can_view_warehouse,
    p.can_edit_warehouse,
    p.can_print_barcode_labels,
    p.can_view_orders,
    p.can_edit_orders
FROM permissions p
JOIN users u ON u.id = p.user_id
ORDER BY u.name;
