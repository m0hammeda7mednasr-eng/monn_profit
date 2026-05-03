/**
 * Migration: Add Bosta Shipments Table
 * Creates table to track Bosta shipping information
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Create bosta_shipments table
  pgm.createTable("bosta_shipments", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    order_id: {
      type: "uuid",
      notNull: true,
      references: "orders(id)",
      onDelete: "CASCADE",
    },
    tracking_number: {
      type: "varchar(255)",
      notNull: true,
      unique: true,
    },
    delivery_id: {
      type: "varchar(255)",
      notNull: true,
    },
    bosta_order_type: {
      type: "integer",
      notNull: true,
      comment: "10=DELIVER, 15=CASH_COLLECTION, 30=EXCHANGE, 25=CRP",
    },
    package_type: {
      type: "varchar(50)",
      notNull: true,
    },
    cod_amount: {
      type: "decimal(10, 2)",
      default: 0,
    },
    expected_shipping_cost: {
      type: "decimal(10, 2)",
      default: 0,
      comment: "Expected shipping cost from Bosta",
    },
    business_reference: {
      type: "varchar(255)",
    },
    business_location_id: {
      type: "varchar(255)",
    },
    delivery_state: {
      type: "integer",
      default: 0,
      comment: "Bosta delivery state",
    },
    delivery_state_label: {
      type: "varchar(100)",
    },
    shipped_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
    delivered_at: {
      type: "timestamp",
    },
    last_status_update: {
      type: "timestamp",
    },
    delivery_attempts: {
      type: "integer",
      default: 0,
    },
    exception_reason: {
      type: "text",
    },
    exception_code: {
      type: "integer",
    },
    cod_collected: {
      type: "decimal(10, 2)",
    },
    is_delivered: {
      type: "boolean",
      default: false,
    },
    is_cancelled: {
      type: "boolean",
      default: false,
    },
    is_returned: {
      type: "boolean",
      default: false,
    },
    delivery_address: {
      type: "jsonb",
    },
    pickup_address: {
      type: "jsonb",
    },
    bosta_response: {
      type: "jsonb",
      comment: "Store full Bosta API response",
    },
    webhook_data: {
      type: "jsonb",
      comment: "Store webhook updates",
    },
    notes: {
      type: "text",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Create indexes
  pgm.createIndex("bosta_shipments", "order_id");
  pgm.createIndex("bosta_shipments", "tracking_number");
  pgm.createIndex("bosta_shipments", "delivery_id");
  pgm.createIndex("bosta_shipments", "delivery_state");
  pgm.createIndex("bosta_shipments", "shipped_at");
  pgm.createIndex("bosta_shipments", "delivered_at");
  pgm.createIndex("bosta_shipments", [
    "is_delivered",
    "is_cancelled",
    "is_returned",
  ]);

  // Create bosta_webhook_logs table for debugging
  pgm.createTable("bosta_webhook_logs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    tracking_number: {
      type: "varchar(255)",
    },
    delivery_id: {
      type: "varchar(255)",
    },
    delivery_state: {
      type: "integer",
    },
    webhook_type: {
      type: "varchar(50)",
    },
    payload: {
      type: "jsonb",
    },
    processed: {
      type: "boolean",
      default: false,
    },
    processing_error: {
      type: "text",
    },
    received_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("now()"),
    },
    processed_at: {
      type: "timestamp",
    },
  });

  // Create indexes for webhook logs
  pgm.createIndex("bosta_webhook_logs", "tracking_number");
  pgm.createIndex("bosta_webhook_logs", "delivery_id");
  pgm.createIndex("bosta_webhook_logs", "received_at");
  pgm.createIndex("bosta_webhook_logs", "processed");

  // Add RLS policies
  pgm.sql(`
    ALTER TABLE bosta_shipments ENABLE ROW LEVEL SECURITY;
    
    CREATE POLICY "Users can view bosta_shipments for their store orders" ON bosta_shipments
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = bosta_shipments.order_id
          AND (
            current_setting('app.current_user_id', true)::uuid = ANY(o.user_ids)
            OR current_setting('app.current_store_id', true) = 'all'
            OR current_setting('app.current_store_id', true) = o.store_id
          )
        )
      );

    CREATE POLICY "Users can insert bosta_shipments for their store orders" ON bosta_shipments
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = bosta_shipments.order_id
          AND (
            current_setting('app.current_user_id', true)::uuid = ANY(o.user_ids)
            OR current_setting('app.current_store_id', true) = 'all'
            OR current_setting('app.current_store_id', true) = o.store_id
          )
        )
      );

    CREATE POLICY "Users can update bosta_shipments for their store orders" ON bosta_shipments
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = bosta_shipments.order_id
          AND (
            current_setting('app.current_user_id', true)::uuid = ANY(o.user_ids)
            OR current_setting('app.current_store_id', true) = 'all'
            OR current_setting('app.current_store_id', true) = o.store_id
          )
        )
      );
  `);

  // Add RLS for webhook logs (admin only)
  pgm.sql(`
    ALTER TABLE bosta_webhook_logs ENABLE ROW LEVEL SECURITY;
    
    CREATE POLICY "Only admins can access bosta_webhook_logs" ON bosta_webhook_logs
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM users u
          WHERE u.id = current_setting('app.current_user_id', true)::uuid
          AND u.is_admin = true
        )
      );
  `);

  console.log(
    "✅ Created bosta_shipments and bosta_webhook_logs tables with RLS policies",
  );
};

exports.down = (pgm) => {
  pgm.dropTable("bosta_webhook_logs", { ifExists: true });
  pgm.dropTable("bosta_shipments", { ifExists: true });
  console.log("✅ Dropped bosta_shipments and bosta_webhook_logs tables");
};
