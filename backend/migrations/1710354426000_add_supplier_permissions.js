/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("permissions", {
    can_view_suppliers: {
      type: "boolean",
      notNull: true,
      default: true,
    },
    can_edit_suppliers: {
      type: "boolean",
      notNull: true,
      default: false,
    },
  });
  pgm.sql(
    "UPDATE permissions SET can_view_suppliers = COALESCE(can_view_products, true), can_edit_suppliers = COALESCE(can_edit_products, false)",
  );
  pgm.sql(
    "COMMENT ON COLUMN permissions.can_view_suppliers IS 'Allows user to view suppliers and supplier balances'",
  );
  pgm.sql(
    "COMMENT ON COLUMN permissions.can_edit_suppliers IS 'Allows user to manage suppliers, deliveries, and payments'",
  );
};

exports.down = (pgm) => {
  pgm.dropColumns("permissions", [
    "can_view_suppliers",
    "can_edit_suppliers",
  ]);
};
