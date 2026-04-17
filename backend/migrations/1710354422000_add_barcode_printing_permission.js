/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("permissions", {
    can_print_barcode_labels: {
      type: "boolean",
      notNull: true,
      default: true,
    },
  });
  pgm.sql(
    "COMMENT ON COLUMN permissions.can_print_barcode_labels IS 'Allows user to print barcode labels for products'",
  );
};

exports.down = (pgm) => {
  pgm.dropColumns("permissions", ["can_print_barcode_labels"]);
};
