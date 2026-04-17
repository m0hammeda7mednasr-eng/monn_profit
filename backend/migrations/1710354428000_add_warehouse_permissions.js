/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("permissions", {
    can_view_warehouse: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    can_edit_warehouse: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });
  pgm.sql(
    "UPDATE permissions SET can_view_warehouse = COALESCE(can_view_products, true), can_edit_warehouse = COALESCE(can_edit_products, false)",
  );
  pgm.sql(
    "COMMENT ON COLUMN permissions.can_view_warehouse IS 'Allows user to view warehouse stock and scan history'",
  );
  pgm.sql(
    "COMMENT ON COLUMN permissions.can_edit_warehouse IS 'Allows user to use the scanner and sync warehouse stock to Shopify'",
  );
};

exports.down = (pgm) => {
  pgm.dropColumns("permissions", [
    "can_view_warehouse",
    "can_edit_warehouse",
  ]);
};
