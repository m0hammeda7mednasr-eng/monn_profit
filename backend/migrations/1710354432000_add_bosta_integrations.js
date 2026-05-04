/**
 * Migration: Add Bosta Integrations Table
 * Persists Bosta API keys per store so configuration from Settings survives restarts.
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "bosta_integrations",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      store_id: {
        type: "uuid",
        notNull: true,
        references: "stores(id)",
        onDelete: "CASCADE",
      },
      api_key: {
        type: "text",
        notNull: true,
      },
      is_active: {
        type: "boolean",
        notNull: true,
        default: true,
      },
      created_by: {
        type: "uuid",
        references: "users(id)",
        onDelete: "SET NULL",
      },
      updated_by: {
        type: "uuid",
        references: "users(id)",
        onDelete: "SET NULL",
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
    },
    { ifNotExists: true },
  );

  pgm.createIndex("bosta_integrations", "store_id", {
    unique: true,
    name: "idx_bosta_integrations_store_unique",
    ifNotExists: true,
  });

  pgm.createIndex("bosta_integrations", "is_active", {
    ifNotExists: true,
  });

  pgm.sql(`
    COMMENT ON TABLE bosta_integrations IS 'Store-level Bosta API configuration';
    COMMENT ON COLUMN bosta_integrations.api_key IS 'Bosta business API key saved from Settings';
  `);

  // Keep updated_at fresh automatically when this helper exists.
  pgm.sql(`
    DROP TRIGGER IF EXISTS bosta_integrations_set_updated_at ON bosta_integrations;
    CREATE TRIGGER bosta_integrations_set_updated_at
      BEFORE UPDATE ON bosta_integrations
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS bosta_integrations_set_updated_at ON bosta_integrations;
  `);
  pgm.dropTable("bosta_integrations", { ifExists: true });
};

