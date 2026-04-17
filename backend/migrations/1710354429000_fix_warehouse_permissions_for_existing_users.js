/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Fix warehouse permissions for users who can edit products
  // They should also be able to edit warehouse by default
  pgm.sql(`
    UPDATE permissions 
    SET can_edit_warehouse = true, 
        can_view_warehouse = true,
        updated_at = NOW()
    WHERE can_edit_products = true 
    AND can_edit_warehouse = false
  `);

  // Ensure all users have warehouse view permissions if they have product view permissions
  pgm.sql(`
    UPDATE permissions 
    SET can_view_warehouse = true,
        updated_at = NOW()
    WHERE can_view_products = true 
    AND can_view_warehouse = false
  `);
};

exports.down = (pgm) => {
  // Revert to the original state where warehouse permissions match product permissions
  pgm.sql(`
    UPDATE permissions 
    SET can_view_warehouse = can_view_products,
        can_edit_warehouse = can_edit_products,
        updated_at = NOW()
  `);
};
