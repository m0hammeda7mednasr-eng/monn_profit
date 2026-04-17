/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("products", {
    ads_cost: {
      type: "decimal(10, 2)",
      notNull: true,
      default: 0,
    },
    operation_cost: {
      type: "decimal(10, 2)",
      notNull: true,
      default: 0,
    },
    shipping_cost: {
      type: "decimal(10, 2)",
      notNull: true,
      default: 0,
    },
  });

  pgm.sql(
    "COMMENT ON COLUMN products.ads_cost IS 'Advertising cost per unit for this product'",
  );
  pgm.sql(
    "COMMENT ON COLUMN products.operation_cost IS 'Operational cost per unit for this product'",
  );
  pgm.sql(
    "COMMENT ON COLUMN products.shipping_cost IS 'Shipping cost per unit for this product'",
  );
};

exports.down = (pgm) => {
  pgm.dropColumns("products", ["ads_cost", "operation_cost", "shipping_cost"]);
};
