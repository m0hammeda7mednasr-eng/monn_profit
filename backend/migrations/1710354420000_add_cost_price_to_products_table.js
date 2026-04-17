/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('products', {
    cost_price: {
      type: 'decimal(10, 2)',
      notNull: true,
      default: 0
    }
  });
  pgm.sql("COMMENT ON COLUMN products.cost_price IS 'Purchase or manufacturing cost of the product (used for profit calculations)'");
};

exports.down = pgm => {
  pgm.dropColumns('products', ['cost_price']);
};
