/**
 * Centralized Data Filter Helper Module
 *
 * This module provides centralized logic for applying role-based query filters
 * to ensure employees see only their own data while admins see all data.
 * Store-aware Shopify scoping is handled in dedicated routes/models, not here.
 */

/**
 * Entity configuration mapping for all entity types
 * Defines which column to filter on and whether filtering is required
 */
const ENTITY_CONFIG = {
  // User-generated data that requires filtering
  tasks: { filterColumn: "assigned_to", requiresFilter: true },
  daily_reports: { filterColumn: "user_id", requiresFilter: true },
  access_requests: { filterColumn: "user_id", requiresFilter: true },
  activity_log: { filterColumn: "user_id", requiresFilter: true },
  operational_costs: { filterColumn: "user_id", requiresFilter: true },

  // Shopify entities are scoped in dedicated store-aware code paths.
  products: { filterColumn: null, requiresFilter: false },
  orders: { filterColumn: null, requiresFilter: false },
  customers: { filterColumn: null, requiresFilter: false },
};

/**
 * Applies user-based filtering to a Supabase query
 *
 * @param {SupabaseQueryBuilder} query - Supabase query builder instance
 * @param {string} userId - Current user's ID
 * @param {string} role - Current user's role ('admin' or any non-admin role)
 * @param {string} entityType - Type of entity being queried
 * @returns {SupabaseQueryBuilder} Modified query with filters applied
 */
export function applyUserFilter(query, userId, role, entityType) {
  // Validate input parameters
  if (!query) {
    throw new Error("Query parameter is required");
  }

  if (!userId) {
    throw new Error("User ID parameter is required");
  }

  if (!role) {
    throw new Error("Role parameter is required");
  }

  if (!entityType) {
    throw new Error("Entity type parameter is required");
  }

  // Check if entity type is configured
  const entityConfig = ENTITY_CONFIG[entityType];
  if (!entityConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  // If user is admin, return query unmodified (no filtering)
  if (role === "admin") {
    return query;
  }

  // If entity doesn't require filtering (Shopify data), return query unmodified
  if (!entityConfig.requiresFilter) {
    return query;
  }

  // Any non-admin user should be filtered for user-generated entities
  const filterColumn = entityConfig.filterColumn;
  return query.eq(filterColumn, userId);
}

/**
 * Determines if an entity type requires user filtering
 *
 * @param {string} entityType - Type of entity
 * @returns {boolean} True if filtering should be applied
 */
export function requiresUserFiltering(entityType) {
  const entityConfig = ENTITY_CONFIG[entityType];
  if (!entityConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  return entityConfig.requiresFilter;
}

/**
 * Gets the appropriate user ID column name for an entity type
 *
 * @param {string} entityType - Type of entity
 * @returns {string|null} Column name ('user_id' or 'assigned_to') or null when this helper should not scope the entity
 */
export function getUserIdColumn(entityType) {
  const entityConfig = ENTITY_CONFIG[entityType];
  if (!entityConfig) {
    throw new Error(`Unknown entity type: ${entityType}`);
  }

  return entityConfig.filterColumn;
}

/**
 * Gets all configured entity types
 *
 * @returns {string[]} Array of all configured entity type names
 */
export function getEntityTypes() {
  return Object.keys(ENTITY_CONFIG);
}

/**
 * Checks if an entity type is Shopify data
 *
 * @param {string} entityType - Type of entity
 * @returns {boolean} True if entity is Shopify data
 */
export function isShopifyData(entityType) {
  const shopifyEntities = ["products", "orders", "customers"];
  return shopifyEntities.includes(entityType);
}

/**
 * Checks if an entity type is user-generated data (requires filtering for employees)
 *
 * @param {string} entityType - Type of entity
 * @returns {boolean} True if entity is user-generated data
 */
export function isUserGeneratedData(entityType) {
  const userGeneratedEntities = [
    "tasks",
    "daily_reports",
    "access_requests",
    "activity_log",
    "operational_costs",
  ];
  return userGeneratedEntities.includes(entityType);
}
