/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("warehouse_inventory", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    store_id: {
      type: "uuid",
      notNull: true,
      references: "stores",
      onDelete: "CASCADE",
    },
    sku: {
      type: "text",
      notNull: true,
    },
    product_id: {
      type: "uuid",
      references: "products",
      onDelete: "SET NULL",
    },
    quantity: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "quantity >= 0",
    },
    last_scanned_at: {
      type: "timestamptz",
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    last_movement_type: {
      type: "text",
      default: "in",
      check: "last_movement_type IN ('in', 'out')",
    },
    last_movement_quantity: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "last_movement_quantity >= 0",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.addConstraint(
    "warehouse_inventory",
    "warehouse_inventory_store_id_sku_unique",
    {
      unique: ["store_id", "sku"],
    },
  );

  pgm.createIndex("warehouse_inventory", ["store_id", "product_id"], {
    name: "warehouse_inventory_store_product_idx",
  });
  pgm.createIndex("warehouse_inventory", ["store_id", "last_scanned_at"], {
    name: "warehouse_inventory_store_last_scanned_idx",
  });

  pgm.createTable("warehouse_scan_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    store_id: {
      type: "uuid",
      notNull: true,
      references: "stores",
      onDelete: "CASCADE",
    },
    sku: {
      type: "text",
      notNull: true,
    },
    product_id: {
      type: "uuid",
      references: "products",
      onDelete: "SET NULL",
    },
    user_id: {
      type: "uuid",
      references: "users",
      onDelete: "SET NULL",
    },
    movement_type: {
      type: "text",
      notNull: true,
      check: "movement_type IN ('in', 'out')",
    },
    quantity: {
      type: "integer",
      notNull: true,
      default: 1,
      check: "quantity > 0",
    },
    scan_code: {
      type: "text",
      notNull: true,
    },
    note: {
      type: "text",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("CURRENT_TIMESTAMP"),
    },
  });

  pgm.createIndex("warehouse_scan_events", ["store_id", "created_at"], {
    name: "warehouse_scan_events_store_created_idx",
  });
  pgm.createIndex("warehouse_scan_events", ["store_id", "sku"], {
    name: "warehouse_scan_events_store_sku_idx",
  });

  pgm.sql(
    "COMMENT ON TABLE warehouse_inventory IS 'Scanner-based warehouse balances by store and SKU'",
  );
  pgm.sql(
    "COMMENT ON TABLE warehouse_scan_events IS 'Immutable scanner history for warehouse stock movements'",
  );
};

exports.down = (pgm) => {
  pgm.dropTable("warehouse_scan_events", { ifExists: true });
  pgm.dropTable("warehouse_inventory", { ifExists: true });
};
