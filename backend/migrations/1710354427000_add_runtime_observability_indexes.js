/* eslint-disable camelcase */

exports.shorthands = undefined;

const createGuardedIndexSql = ({
  tableName,
  indexName,
  requiredColumns,
  definition,
}) => `
  DO $$
  BEGIN
    IF to_regclass('public.${tableName}') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = '${tableName}'
           AND column_name IN (${requiredColumns
             .map((columnName) => `'${columnName}'`)
             .join(", ")})
         GROUP BY table_name
         HAVING COUNT(*) = ${requiredColumns.length}
       ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS ${indexName} ${definition}';
    END IF;
  END $$;
`;

const dropIndexSql = (indexName) =>
  `DROP INDEX IF EXISTS public.${indexName};`;

const guardedIndexes = [
  {
    tableName: "operational_costs",
    indexName: "idx_operational_costs_user_created_at",
    requiredColumns: ["user_id", "created_at"],
    definition: "ON public.operational_costs (user_id, created_at DESC)",
  },
  {
    tableName: "operational_costs",
    indexName: "idx_operational_costs_product_user_active",
    requiredColumns: ["product_id", "user_id", "is_active"],
    definition:
      "ON public.operational_costs (product_id, user_id) WHERE is_active = true",
  },
  {
    tableName: "notifications",
    indexName: "idx_notifications_user_created_at",
    requiredColumns: ["user_id", "created_at"],
    definition: "ON public.notifications (user_id, created_at DESC)",
  },
  {
    tableName: "notifications",
    indexName: "idx_notifications_user_is_read_created_at",
    requiredColumns: ["user_id", "is_read", "created_at"],
    definition:
      "ON public.notifications (user_id, is_read, created_at DESC)",
  },
  {
    tableName: "notifications",
    indexName: "idx_notifications_type_user_entity_created_at",
    requiredColumns: ["type", "user_id", "entity_id", "created_at"],
    definition:
      "ON public.notifications (type, user_id, entity_id, created_at DESC)",
  },
  {
    tableName: "shopify_tokens",
    indexName: "idx_shopify_tokens_user_updated_at",
    requiredColumns: ["user_id", "updated_at"],
    definition: "ON public.shopify_tokens (user_id, updated_at DESC)",
  },
  {
    tableName: "shopify_tokens",
    indexName: "idx_shopify_tokens_user_shop",
    requiredColumns: ["user_id", "shop"],
    definition: "ON public.shopify_tokens (user_id, shop)",
  },
];

exports.up = (pgm) => {
  guardedIndexes.forEach((indexConfig) => {
    pgm.sql(createGuardedIndexSql(indexConfig));
  });
};

exports.down = (pgm) => {
  [...guardedIndexes]
    .reverse()
    .forEach(({ indexName }) => pgm.sql(dropIndexSql(indexName)));
};
