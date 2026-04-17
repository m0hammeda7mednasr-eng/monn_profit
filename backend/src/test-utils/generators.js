/**
 * Test data generators for property-based testing
 * Uses fast-check library to generate random test data
 */

import fc from "fast-check";

/**
 * Generate a valid UUID v4
 */
export const uuid = () =>
  fc.string({ minLength: 36, maxLength: 36 }).map(() => {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  });

/**
 * Generate a valid email address
 */
export const email = () =>
  fc
    .tuple(
      fc.stringOf(
        fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
        {
          minLength: 1,
          maxLength: 10,
        },
      ),
      fc.stringOf(
        fc.char().filter((c) => /[a-zA-Z0-9]/.test(c)),
        {
          minLength: 1,
          maxLength: 10,
        },
      ),
      fc.stringOf(
        fc.char().filter((c) => /[a-zA-Z]/.test(c)),
        {
          minLength: 2,
          maxLength: 4,
        },
      ),
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/**
 * Generate user roles
 */
export const userRole = () => fc.constantFrom("admin", "employee");

/**
 * Generate entity types
 */
export const entityType = () =>
  fc.constantFrom(
    "tasks",
    "daily_reports",
    "access_requests",
    "activity_log",
    "operational_costs",
    "products",
    "orders",
    "customers",
  );

/**
 * Generate user-generated entity types only
 */
export const userGeneratedEntityType = () =>
  fc.constantFrom(
    "tasks",
    "daily_reports",
    "access_requests",
    "activity_log",
    "operational_costs",
  );

/**
 * Generate Shopify entity types only
 */
export const shopifyEntityType = () =>
  fc.constantFrom("products", "orders", "customers");

/**
 * Generate a user object
 */
export const user = () =>
  fc.record({
    id: uuid(),
    email: email(),
    role: userRole(),
  });

/**
 * Generate an admin user object
 */
export const adminUser = () =>
  fc.record({
    id: uuid(),
    email: email(),
    role: fc.constant("admin"),
  });

/**
 * Generate an employee user object
 */
export const employeeUser = () =>
  fc.record({
    id: uuid(),
    email: email(),
    role: fc.constant("employee"),
  });

/**
 * Generate a task record
 */
export const taskRecord = () =>
  fc.record({
    id: uuid(),
    title: fc.string({ minLength: 1, maxLength: 100 }),
    description: fc.option(fc.string({ maxLength: 500 })),
    assigned_to: uuid(),
    status: fc.constantFrom("pending", "in_progress", "completed", "cancelled"),
    priority: fc.constantFrom("low", "medium", "high", "urgent"),
    due_date: fc.option(fc.date()),
    created_at: fc.date(),
    updated_at: fc.date(),
  });

/**
 * Generate a daily report record
 */
export const dailyReportRecord = () =>
  fc.record({
    id: uuid(),
    user_id: uuid(),
    report_date: fc.date(),
    content: fc.string({ minLength: 1, maxLength: 1000 }),
    file_path: fc.option(fc.string()),
    created_at: fc.date(),
    updated_at: fc.date(),
  });

/**
 * Generate an access request record
 */
export const accessRequestRecord = () =>
  fc.record({
    id: uuid(),
    user_id: uuid(),
    requested_resource: fc.string({ minLength: 1, maxLength: 200 }),
    reason: fc.string({ minLength: 1, maxLength: 500 }),
    status: fc.constantFrom("pending", "approved", "denied"),
    requested_at: fc.date(),
    reviewed_at: fc.option(fc.date()),
    reviewed_by: fc.option(uuid()),
  });

/**
 * Generate an activity log record
 */
export const activityLogRecord = () =>
  fc.record({
    id: uuid(),
    user_id: uuid(),
    action: fc.string({ minLength: 1, maxLength: 100 }),
    resource_type: fc.string({ minLength: 1, maxLength: 50 }),
    resource_id: fc.option(uuid()),
    details: fc.option(fc.string({ maxLength: 500 })),
    timestamp: fc.date(),
    ip_address: fc.option(fc.string()),
  });

/**
 * Generate an operational cost record
 */
export const operationalCostRecord = () =>
  fc.record({
    id: uuid(),
    user_id: uuid(),
    description: fc.string({ minLength: 1, maxLength: 200 }),
    amount: fc.float({ min: 0.01, max: 10000 }),
    category: fc.string({ minLength: 1, maxLength: 50 }),
    date: fc.date(),
    created_at: fc.date(),
    updated_at: fc.date(),
  });

/**
 * Generate a product record (Shopify data)
 */
export const productRecord = () =>
  fc.record({
    id: uuid(),
    shopify_id: fc.string({ minLength: 1, maxLength: 50 }),
    title: fc.string({ minLength: 1, maxLength: 200 }),
    description: fc.option(fc.string({ maxLength: 1000 })),
    price: fc.float({ min: 0.01, max: 10000 }),
    cost_price: fc.option(fc.float({ min: 0.01, max: 10000 })),
    inventory_quantity: fc.integer({ min: 0, max: 10000 }),
    sku: fc.option(fc.string({ maxLength: 100 })),
    user_id: uuid(), // Shopify account association, not for filtering
    created_at: fc.date(),
    updated_at: fc.date(),
  });

/**
 * Generate an order record (Shopify data)
 */
export const orderRecord = () =>
  fc.record({
    id: uuid(),
    shopify_id: fc.string({ minLength: 1, maxLength: 50 }),
    order_number: fc.string({ minLength: 1, maxLength: 50 }),
    customer_email: email(),
    total_price: fc.float({ min: 0.01, max: 10000 }),
    status: fc.constantFrom(
      "pending",
      "authorized",
      "partially_paid",
      "paid",
      "partially_refunded",
      "refunded",
      "voided",
    ),
    financial_status: fc.constantFrom(
      "pending",
      "authorized",
      "partially_paid",
      "paid",
      "partially_refunded",
      "refunded",
      "voided",
    ),
    fulfillment_status: fc.option(
      fc.constantFrom("fulfilled", "partial", "restocked"),
    ),
    user_id: uuid(), // Shopify account association, not for filtering
    created_at: fc.date(),
    updated_at: fc.date(),
  });

/**
 * Generate a customer record (Shopify data)
 */
export const customerRecord = () =>
  fc.record({
    id: uuid(),
    shopify_id: fc.string({ minLength: 1, maxLength: 50 }),
    email: email(),
    first_name: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
    last_name: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
    phone: fc.option(fc.string({ minLength: 10, maxLength: 15 })),
    total_spent: fc.float({ min: 0, max: 100000 }),
    orders_count: fc.integer({ min: 0, max: 1000 }),
    user_id: uuid(), // Shopify account association, not for filtering
    created_at: fc.date(),
    updated_at: fc.date(),
  });

/**
 * Generate records for a specific entity type
 */
export const recordForEntityType = (entityType) => {
  switch (entityType) {
    case "tasks":
      return taskRecord();
    case "daily_reports":
      return dailyReportRecord();
    case "access_requests":
      return accessRequestRecord();
    case "activity_log":
      return activityLogRecord();
    case "operational_costs":
      return operationalCostRecord();
    case "products":
      return productRecord();
    case "orders":
      return orderRecord();
    case "customers":
      return customerRecord();
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
};

/**
 * Generate an array of records for a specific entity type
 */
export const recordsForEntityType = (entityType, options = {}) => {
  const { minLength = 0, maxLength = 10 } = options;
  return fc.array(recordForEntityType(entityType), { minLength, maxLength });
};

/**
 * Generate JWT token payload
 */
export const jwtPayload = () =>
  fc.record({
    id: uuid(),
    email: email(),
    role: userRole(),
    iat: fc.integer({ min: 1000000000, max: 2000000000 }),
    exp: fc.integer({ min: 2000000001, max: 3000000000 }),
  });

/**
 * Generate invalid JWT token payload (missing required fields)
 */
export const invalidJwtPayload = () =>
  fc.oneof(
    fc.record({ email: email(), role: userRole() }), // Missing id
    fc.record({ id: uuid(), role: userRole() }), // Missing email
    fc.record({ id: uuid(), email: email() }), // Missing role
    fc.record({ username: fc.string() }), // Wrong structure
    fc.record({}), // Empty payload
  );

/**
 * Generate SQL injection payloads for testing
 */
export const sqlInjectionPayload = () =>
  fc.constantFrom(
    "'; DROP TABLE users; --",
    "' OR '1'='1",
    "' UNION SELECT * FROM users --",
    "'; DELETE FROM tasks; --",
    "' OR 1=1 --",
    "admin'--",
    "' OR 'x'='x",
    "'; INSERT INTO users (role) VALUES ('admin'); --",
    "' AND 1=0 UNION SELECT password FROM users --",
    "' OR EXISTS(SELECT * FROM users WHERE role='admin') --",
  );

/**
 * Generate malformed authorization headers
 */
export const malformedAuthHeader = () =>
  fc.constantFrom(
    "InvalidFormat token",
    "Bearer",
    "Bearer ",
    "Basic dXNlcjpwYXNz",
    "Token abc123",
    "",
    "Bearer invalid-token-format",
  );

/**
 * Generate test configuration for property-based tests
 */
export const testConfig = (overrides = {}) => ({
  numRuns: 100,
  verbose: false,
  seed: Math.floor(Math.random() * 1000000),
  ...overrides,
});
