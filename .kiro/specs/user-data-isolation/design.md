# Design Document: User Data Isolation System

## Overview

This design document specifies the architecture and implementation approach for a role-based data isolation system that separates user-generated data while maintaining shared access to Shopify-synced resources. The system ensures employees see only their own tasks, reports, access requests, activity logs, and operational costs, while administrators have full visibility across all users. All users share the same Shopify products, orders, and customers, with changes synchronized in real-time.

The implementation leverages middleware-based authentication, role-based query filtering, and frontend context-aware UI rendering to enforce data isolation consistently across the application.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend Layer                        │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │  AuthContext   │  │  Protected   │  │  Role-Based UI  │ │
│  │  (user, role)  │  │    Routes    │  │   Visibility    │ │
│  └────────────────┘  └──────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP + JWT
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Backend Layer                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           Auth Middleware (JWT Verification)           │ │
│  │  • Validates JWT token                                 │ │
│  │  • Extracts user ID, email, role                       │ │
│  │  • Attaches to req.user                                │ │
│  │  • Sets isAdmin flag                                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                              │                               │
│                              ▼                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Route Handlers (Express)                  │ │
│  │  • Check req.user.role                                 │ │
│  │  • Apply data filter helper                            │ │
│  │  • Execute filtered queries                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                              │                               │
│                              ▼                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │           Data Filter Helper Module                    │ │
│  │  • applyUserFilter(query, userId, role, entityType)   │ │
│  │  • Returns modified query with WHERE clause            │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Database Layer (Supabase)               │
│  ┌──────────────────────┐  ┌──────────────────────────────┐│
│  │ User-Generated Data  │  │    Shopify Shared Data       ││
│  │ • tasks              │  │    • products                ││
│  │ • daily_reports      │  │    • orders                  ││
│  │ • access_requests    │  │    • customers               ││
│  │ • activity_log       │  │    (No user_id filtering)    ││
│  │ • operational_costs  │  │                              ││
│  │ (Filtered by user_id)│  │                              ││
│  └──────────────────────┘  └──────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Data Flow Diagrams

#### Employee Data Access Flow

```
Employee Request → JWT Token → Auth Middleware
                                     │
                                     ▼
                            Extract user.id, user.role
                                     │
                                     ▼
                            Route Handler (e.g., GET /api/tasks)
                                     │
                                     ▼
                            Check: role === 'employee'
                                     │
                                     ▼
                            Apply Filter: WHERE assigned_to = user.id
                                     │
                                     ▼
                            Execute Query → Database
                                     │
                                     ▼
                            Return: Only employee's tasks
```

#### Admin Data Access Flow

```
Admin Request → JWT Token → Auth Middleware
                                   │
                                   ▼
                          Extract user.id, user.role
                                   │
                                   ▼
                          Route Handler (e.g., GET /api/tasks)
                                   │
                                   ▼
                          Check: role === 'admin'
                                   │
                                   ▼
                          No Filter Applied
                                   │
                                   ▼
                          Execute Query → Database
                                   │
                                   ▼
                          Return: All tasks from all users
```

#### Shopify Data Access Flow (All Users)

```
Any User Request → JWT Token → Auth Middleware
                                      │
                                      ▼
                             Extract user.id, user.role
                                      │
                                      ▼
                             Route Handler (e.g., GET /api/shopify/products)
                                      │
                                      ▼
                             No Role Check (Shared Data)
                                      │
                                      ▼
                             Execute Query → Database
                                      │
                                      ▼
                             Return: All products (no filtering)
```

## Components and Interfaces

### 1. Authentication Middleware

**Location:** `backend/src/middleware/auth.js` (to be created)

**Purpose:** Centralized JWT token validation and user context extraction

**Interface:**

```javascript
/**
 * Authenticates requests by validating JWT tokens
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 * @returns {void}
 */
function authenticateToken(req, res, next)
```

**Behavior:**

- Extracts JWT token from `Authorization: Bearer <token>` header
- Validates token using `JWT_SECRET` environment variable
- On success: Attaches decoded user object to `req.user` with fields:
  - `id` (UUID): User's unique identifier
  - `email` (string): User's email address
  - `role` (string): User's role ('admin' or 'employee')
- On failure: Returns HTTP 401 with error message
- Sets `req.user.isAdmin = (req.user.role === 'admin')` for convenience

**Error Responses:**

- `401 Unauthorized`: Missing token
- `403 Forbidden`: Invalid or expired token

### 2. Data Filter Helper Module

**Location:** `backend/src/helpers/dataFilter.js` (to be created)

**Purpose:** Centralized logic for applying role-based query filters

**Interface:**

```javascript
/**
 * Applies user-based filtering to a Supabase query
 * @param {SupabaseQueryBuilder} query - Supabase query builder instance
 * @param {string} userId - Current user's ID
 * @param {string} role - Current user's role ('admin' or 'employee')
 * @param {string} entityType - Type of entity being queried
 * @returns {SupabaseQueryBuilder} Modified query with filters applied
 */
function applyUserFilter(query, userId, role, entityType)

/**
 * Determines if an entity type requires user filtering
 * @param {string} entityType - Type of entity
 * @returns {boolean} True if filtering should be applied
 */
function requiresUserFiltering(entityType)

/**
 * Gets the appropriate user ID column name for an entity type
 * @param {string} entityType - Type of entity
 * @returns {string} Column name ('user_id', 'created_by', or 'assigned_to')
 */
function getUserIdColumn(entityType)
```

**Entity Type Mapping:**

```javascript
const ENTITY_CONFIG = {
  tasks: { filterColumn: "assigned_to", requiresFilter: true },
  daily_reports: { filterColumn: "user_id", requiresFilter: true },
  access_requests: { filterColumn: "user_id", requiresFilter: true },
  activity_log: { filterColumn: "user_id", requiresFilter: true },
  operational_costs: { filterColumn: "user_id", requiresFilter: true },
  products: { filterColumn: null, requiresFilter: false },
  orders: { filterColumn: null, requiresFilter: false },
  customers: { filterColumn: null, requiresFilter: false },
};
```

**Behavior:**

- If `role === 'admin'`: Returns query unmodified (no filtering)
- If `role === 'employee'` and entity requires filtering:
  - Adds `.eq(filterColumn, userId)` to query
- If entity is Shopify data: Returns query unmodified

### 3. Route Handler Modifications

**Affected Routes:**

- `backend/src/routes/tasks.js`
- `backend/src/routes/dailyReports.js`
- `backend/src/routes/accessRequests.js`
- `backend/src/routes/activityLog.js`
- `backend/src/routes/operationalCosts.js`

**Pattern for Modification:**

**Before (Current Implementation):**

```javascript
router.get("/", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  let query = supabase.from("tasks").select("*");

  // Manual role check
  const { data: userData } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (userData?.role !== "admin") {
    query = query.eq("assigned_to", userId);
  }

  const { data, error } = await query;
  res.json(data || []);
});
```

**After (With Data Filter Helper):**

```javascript
import { authenticateToken } from "../middleware/auth.js";
import { applyUserFilter } from "../helpers/dataFilter.js";

router.get("/", authenticateToken, async (req, res) => {
  try {
    let query = supabase.from("tasks").select("*");

    // Apply role-based filtering
    query = applyUserFilter(query, req.user.id, req.user.role, "tasks");

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});
```

### 4. Frontend AuthContext Enhancement

**Location:** `frontend/src/context/AuthContext.jsx`

**Current State:** Already implements role-based context

**Required Enhancements:** None (already provides `user`, `isAdmin`, `role`)

**Usage Pattern:**

```javascript
import { useAuth } from "../context/AuthContext";

function MyComponent() {
  const { user, isAdmin } = useAuth();

  return (
    <div>
      {isAdmin && <AdminOnlyFeature />}
      {!isAdmin && <EmployeeFeature userId={user.id} />}
    </div>
  );
}
```

### 5. Frontend UI Visibility Control

**Location:** `frontend/src/components/Sidebar.jsx` and page components

**Pattern:**

```javascript
import { useAuth } from "../context/AuthContext";

function Sidebar() {
  const { isAdmin } = useAuth();

  return (
    <nav>
      <NavLink to="/dashboard">Dashboard</NavLink>
      <NavLink to="/my-tasks">My Tasks</NavLink>
      <NavLink to="/my-reports">My Reports</NavLink>

      {/* Admin-only navigation */}
      {isAdmin && (
        <>
          <NavLink to="/tasks">All Tasks</NavLink>
          <NavLink to="/reports">All Reports</NavLink>
          <NavLink to="/users">Users</NavLink>
          <NavLink to="/activity-log">Activity Log</NavLink>
        </>
      )}
    </nav>
  );
}
```

## Data Models

### User Context Object (req.user)

```typescript
interface UserContext {
  id: string; // UUID from JWT
  email: string; // User's email
  role: "admin" | "employee"; // User's role
  isAdmin: boolean; // Convenience flag (role === 'admin')
}
```

### Entity Filter Configuration

```typescript
interface EntityConfig {
  filterColumn: string | null; // Column name for user filtering
  requiresFilter: boolean; // Whether filtering is required
}

type EntityType =
  | "tasks"
  | "daily_reports"
  | "access_requests"
  | "activity_log"
  | "operational_costs"
  | "products"
  | "orders"
  | "customers";
```

### Database Schema Considerations

**User-Generated Data Tables:**
All tables that require user isolation must have a user identifier column:

- `tasks`: Uses `assigned_to` (UUID) - references users(id)
- `daily_reports`: Uses `user_id` (UUID) - references users(id)
- `access_requests`: Uses `user_id` (UUID) - references users(id)
- `activity_log`: Uses `user_id` (UUID) - references users(id)
- `operational_costs`: Uses `user_id` (UUID) - references users(id)

**Shopify Shared Data Tables:**
These tables contain `user_id` but it's used for Shopify account association, not data isolation:

- `products`: Contains `user_id` but all users see all products
- `orders`: Contains `user_id` but all users see all orders
- `customers`: Contains `user_id` but all users see all customers

**Important:** The `user_id` in Shopify tables represents which Shopify account the data came from, not which user owns the data. All users within the system share access to all Shopify data.

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

### Property 1: Employee Data Isolation

_For any_ employee user and any user-generated data entity (tasks, daily reports, access requests, activity logs, operational costs), when the employee queries that entity type, the system should return only records where the user identifier column matches the employee's ID.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

### Property 2: Admin Full Access

_For any_ admin user and any user-generated data entity, when the admin queries that entity type, the system should return all records regardless of user identifier values.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

### Property 3: Shared Shopify Data Access

_For any_ user (employee or admin) and any Shopify data entity (products, orders, customers), when the user queries that entity type, the system should return all records without applying user-based filtering.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 4: Shopify Data Update Visibility

_For any_ Shopify data update and any user, when Shopify data is modified (via webhook or sync), all users should see the updated data in subsequent queries.

**Validates: Requirements 3.5, 11.1, 11.2**

### Property 5: Role Extraction and Context Setting

_For any_ valid JWT token containing a role field, when the authentication middleware processes the token, it should correctly extract the role and set the appropriate context flags (isAdmin for 'admin' role, filter flag for 'employee' role).

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 6: Task Assignment Visibility

_For any_ task with an assigned_to field and any employee user, when the employee's ID matches the assigned_to value, the employee should be able to view that task regardless of who created it.

**Validates: Requirements 5.1, 5.3**

### Property 7: Profit Calculation Isolation

_For any_ employee user and any profit calculation request, the system should include only operational costs where created_by matches the employee's ID in the calculation, while for admin users, the system should include all operational costs.

**Validates: Requirements 6.3, 6.4**

### Property 8: Authentication Rejection

_For any_ request without a valid JWT token (missing, invalid, or expired), the system should return HTTP 401 Unauthorized and reject the request before executing any database queries.

**Validates: Requirements 7.1, 7.2, 7.5**

### Property 9: User Context Population

_For any_ request with a valid JWT token, the authentication middleware should attach a user object to req.user containing id, email, and role fields extracted from the token.

**Validates: Requirements 7.3, 7.4**

### Property 10: SQL Injection Prevention

_For any_ user input used in database queries, the system should use parameterized queries with the user ID, ensuring that malicious SQL injection attempts do not bypass data isolation or compromise security.

**Validates: Requirements 8.5**

### Property 11: Frontend Data Display Consistency

_For any_ data list displayed in the frontend, the displayed data should exactly match the data returned by the backend's filtered queries, with no additional client-side filtering applied.

**Validates: Requirements 9.3, 9.4**

### Property 12: Activity Log User Association

_For any_ activity log entry created, the system should record the user_id from the authenticated user context, and when retrieving activity logs, they should be ordered by timestamp in descending order (most recent first).

**Validates: Requirements 10.3, 10.4**

### Property 13: Unauthorized Access Rejection

_For any_ employee user attempting to access another user's data directly (e.g., via URL manipulation with a different user ID), the system should return HTTP 403 Forbidden and log the unauthorized access attempt with the requesting user's ID and the requested resource.

**Validates: Requirements 12.1, 12.2**

### Property 14: Information Disclosure Prevention

_For any_ request to access data that doesn't exist or that the user is not authorized to access, the system should return similar error responses (403 Forbidden) to prevent revealing whether the data exists.

**Validates: Requirements 12.4**

## Error Handling

### Authentication Errors

**401 Unauthorized:**

- Trigger: Missing JWT token
- Response: `{ error: "No token provided" }`
- Action: Client should redirect to login page

**401 Unauthorized:**

- Trigger: Invalid or expired JWT token
- Response: `{ error: "Invalid token" }` or `{ error: "Token expired" }`
- Action: Client should clear stored token and redirect to login

### Authorization Errors

**403 Forbidden:**

- Trigger: Employee attempting to access another user's data
- Response: `{ error: "Access denied: insufficient permissions" }`
- Action: Log attempt with user ID and requested resource
- Client: Display error message, do not reveal data existence

**403 Forbidden:**

- Trigger: Employee attempting to access admin-only endpoint
- Response: `{ error: "Admin access required" }`
- Action: Log attempt
- Client: Display error message or hide UI element

### Data Query Errors

**500 Internal Server Error:**

- Trigger: Database query failure
- Response: `{ error: "Failed to fetch [entity type]" }`
- Action: Log full error details server-side
- Client: Display generic error message

**404 Not Found:**

- Trigger: Specific resource not found (after authorization check)
- Response: `{ error: "[Entity] not found" }`
- Action: Only return 404 if user has permission to know about the resource
- Client: Display "not found" message

### Error Handling Principles

1. **Fail Securely:** Always check authentication before authorization, and authorization before data access
2. **Consistent Responses:** Return similar error responses for "not found" and "not authorized" to prevent information disclosure
3. **Comprehensive Logging:** Log all authentication failures, authorization failures, and unauthorized access attempts
4. **User-Friendly Messages:** Provide clear error messages to users without revealing system internals
5. **Early Rejection:** Reject unauthenticated requests before executing any database queries

### Error Logging Format

```javascript
{
  timestamp: "2024-01-15T10:30:00Z",
  level: "warn" | "error",
  type: "auth_failure" | "authz_failure" | "data_access_error",
  userId: "uuid-or-null",
  requestedResource: "/api/tasks/123",
  errorMessage: "Access denied: insufficient permissions",
  ipAddress: "192.168.1.1",
  userAgent: "Mozilla/5.0..."
}
```

## Testing Strategy

### Dual Testing Approach

This feature requires both unit testing and property-based testing to ensure comprehensive coverage:

**Unit Tests:** Focus on specific examples, edge cases, and error conditions

- Specific authentication scenarios (valid token, invalid token, expired token)
- Specific authorization scenarios (employee accessing own data, employee accessing other's data, admin accessing all data)
- Edge cases (empty result sets, malformed tokens, missing user context)
- Integration points between middleware and route handlers

**Property-Based Tests:** Verify universal properties across all inputs

- Generate random users with different roles
- Generate random data entities with different user associations
- Verify filtering behavior holds for all generated combinations
- Test with minimum 100 iterations per property to ensure comprehensive coverage

### Property-Based Testing Configuration

**Framework:** Use `fast-check` for JavaScript/Node.js property-based testing

**Installation:**

```bash
npm install --save-dev fast-check
```

**Test Structure:**
Each property test must:

1. Run minimum 100 iterations (configured via `fc.assert` options)
2. Include a comment tag referencing the design property
3. Generate random test data appropriate for the property
4. Verify the property holds for all generated inputs

**Tag Format:**

```javascript
// Feature: user-data-isolation, Property 1: Employee Data Isolation
```

### Unit Test Coverage

**Authentication Middleware Tests:**

- Valid JWT token with admin role → req.user populated correctly
- Valid JWT token with employee role → req.user populated correctly
- Missing JWT token → 401 Unauthorized
- Invalid JWT token → 401 Unauthorized
- Expired JWT token → 401 Unauthorized
- Malformed Authorization header → 401 Unauthorized

**Data Filter Helper Tests:**

- Admin role + user-generated entity → no filter applied
- Employee role + user-generated entity → filter applied with correct column
- Any role + Shopify entity → no filter applied
- Correct column selection for each entity type (assigned_to for tasks, user_id for others)

**Route Handler Tests (per entity type):**

- Employee requests own data → receives only own records
- Employee requests with no data → receives empty array
- Admin requests data → receives all records from all users
- Unauthenticated request → 401 Unauthorized
- Employee attempts to access specific other user's record → 403 Forbidden

**Frontend Tests:**

- Employee login → admin navigation items hidden
- Admin login → all navigation items visible
- Data list rendering → displays exactly what backend returns
- AuthContext provides correct user and role information

### Property-Based Test Examples

**Property 1: Employee Data Isolation**

```javascript
// Feature: user-data-isolation, Property 1: Employee Data Isolation
test("employees only see their own data", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          id: fc.uuid(),
          user_id: fc.uuid(),
          title: fc.string(),
        }),
      ),
      fc.uuid(), // employee user ID
      async (allRecords, employeeId) => {
        // Setup: Insert all records into database
        await insertRecords("tasks", allRecords);

        // Execute: Query as employee
        const result = await queryAsEmployee(employeeId, "tasks");

        // Verify: All returned records belong to employee
        const allBelongToEmployee = result.every(
          (r) => r.user_id === employeeId,
        );
        expect(allBelongToEmployee).toBe(true);

        // Cleanup
        await cleanupRecords("tasks", allRecords);
      },
    ),
    { numRuns: 100 },
  );
});
```

**Property 2: Admin Full Access**

```javascript
// Feature: user-data-isolation, Property 2: Admin Full Access
test("admins see all data regardless of user_id", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          id: fc.uuid(),
          user_id: fc.uuid(),
          title: fc.string(),
        }),
      ),
      fc.uuid(), // admin user ID
      async (allRecords, adminId) => {
        // Setup: Insert all records
        await insertRecords("tasks", allRecords);

        // Execute: Query as admin
        const result = await queryAsAdmin(adminId, "tasks");

        // Verify: All records returned
        expect(result.length).toBe(allRecords.length);

        // Cleanup
        await cleanupRecords("tasks", allRecords);
      },
    ),
    { numRuns: 100 },
  );
});
```

**Property 3: Shared Shopify Data Access**

```javascript
// Feature: user-data-isolation, Property 3: Shared Shopify Data Access
test("all users see all Shopify data", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          id: fc.uuid(),
          shopify_id: fc.string(),
          title: fc.string(),
          price: fc.float(),
        }),
      ),
      fc.uuid(), // any user ID
      fc.constantFrom("admin", "employee"), // any role
      async (allProducts, userId, role) => {
        // Setup: Insert all products
        await insertRecords("products", allProducts);

        // Execute: Query as user with given role
        const result = await queryAsUser(userId, role, "products");

        // Verify: All products returned regardless of role
        expect(result.length).toBe(allProducts.length);

        // Cleanup
        await cleanupRecords("products", allProducts);
      },
    ),
    { numRuns: 100 },
  );
});
```

### Integration Testing

**End-to-End Scenarios:**

1. Employee logs in → sees only own tasks → attempts to access another user's task via URL → receives 403
2. Admin logs in → sees all tasks → can access any user's task → sees all data in activity log
3. Any user logs in → sees all products → updates product → all other users see the update
4. Employee creates operational cost → calculates profit → only their costs included
5. Admin calculates profit → all users' operational costs included

### Security Testing

**SQL Injection Attempts:**

- Attempt to inject SQL in user ID parameters
- Verify parameterized queries prevent injection
- Test with various SQL injection payloads

**Authorization Bypass Attempts:**

- Attempt to access other users' data via URL manipulation
- Attempt to escalate privileges by modifying JWT token
- Verify all attempts are logged and rejected

**Information Disclosure Tests:**

- Request non-existent resource as employee → verify response doesn't reveal existence
- Request unauthorized resource as employee → verify response is similar to non-existent
- Verify error messages don't leak sensitive information

### Performance Testing

**Query Performance:**

- Measure query execution time with and without filters
- Verify indexes are used for filtered queries
- Test with large datasets (1000+ records per user)

**Concurrent Access:**

- Multiple employees querying simultaneously
- Admin querying while employees query
- Verify no data leakage between concurrent requests

## Security Considerations

### Authentication Security

**JWT Token Management:**

- Tokens must be signed with a strong secret (minimum 256 bits)
- Tokens should have reasonable expiration times (e.g., 24 hours)
- Refresh token mechanism should be implemented for long-lived sessions
- Tokens must be transmitted only over HTTPS in production
- Tokens should be stored securely in the client (httpOnly cookies preferred over localStorage)

**Token Validation:**

- Verify token signature on every request
- Check token expiration before processing
- Validate token structure and required claims (id, email, role)
- Reject tokens with missing or invalid claims

### Authorization Security

**Role-Based Access Control:**

- Role must be stored in the database, not just in JWT (JWT role is for convenience)
- Backend must verify role from database for sensitive operations
- Role changes should invalidate existing tokens (implement token versioning)
- Default role should be 'employee' (least privilege principle)

**Data Access Control:**

- Always apply filters at the database query level, never rely on client-side filtering
- Use parameterized queries to prevent SQL injection
- Validate user ID format before using in queries (must be valid UUID)
- Log all authorization failures for security monitoring

### Data Isolation Security

**Query Filtering:**

- Filters must be applied before query execution, not after
- Use database-level WHERE clauses, not application-level filtering
- Verify filter is applied even if query builder is modified
- Test that filter cannot be bypassed through query manipulation

**Information Disclosure Prevention:**

- Return 403 for both "not found" and "not authorized" scenarios
- Do not reveal whether a resource exists if user lacks permission
- Error messages should not contain sensitive information (user IDs, internal paths)
- Log detailed errors server-side, return generic errors to client

### Audit and Monitoring

**Activity Logging:**

- Log all authentication attempts (success and failure)
- Log all authorization failures with user ID and requested resource
- Log all data access with user ID, entity type, and timestamp
- Implement log rotation and retention policies

**Security Monitoring:**

- Monitor for repeated authentication failures (potential brute force)
- Monitor for repeated authorization failures (potential privilege escalation attempts)
- Alert on unusual access patterns (employee accessing many records rapidly)
- Implement rate limiting on authentication endpoints

### Database Security

**Row-Level Security (RLS):**

- Note: Current implementation uses application-level filtering, not RLS
- RLS is disabled for backend service account (DISABLE_RLS_FOR_BACKEND.sql)
- Application-level filtering provides flexibility for complex role logic
- Consider enabling RLS as defense-in-depth for critical tables

**Connection Security:**

- Use connection pooling with minimum and maximum connection limits
- Use service account with minimum required privileges
- Rotate database credentials regularly
- Use SSL/TLS for database connections in production

### Frontend Security

**Client-Side Security:**

- Never trust client-side role checks for security (only for UI)
- Always validate permissions on backend, even if UI hides features
- Implement CSRF protection for state-changing operations
- Sanitize user input before displaying to prevent XSS

**API Security:**

- Implement rate limiting on API endpoints
- Use CORS to restrict API access to known origins
- Validate all input parameters (type, format, range)
- Implement request size limits to prevent DoS

### Deployment Security

**Environment Variables:**

- Store JWT_SECRET in environment variables, never in code
- Use different secrets for development, staging, and production
- Rotate secrets periodically
- Use secret management service (e.g., AWS Secrets Manager) in production

**HTTPS Enforcement:**

- Enforce HTTPS in production (redirect HTTP to HTTPS)
- Use HSTS headers to prevent downgrade attacks
- Use secure cookies (Secure and HttpOnly flags)
- Implement certificate pinning for mobile apps

### Incident Response

**Security Incident Procedures:**

1. Detect: Monitor logs for suspicious activity
2. Contain: Revoke compromised tokens, disable affected accounts
3. Investigate: Analyze logs to determine scope of breach
4. Remediate: Fix vulnerability, rotate secrets if needed
5. Notify: Inform affected users if data was compromised
6. Learn: Update security measures to prevent recurrence

**Breach Indicators:**

- Unusual number of 403 errors from a single user
- Access to data outside normal working hours
- Rapid sequential access to many records
- Authentication from unusual IP addresses or locations
- Multiple failed authentication attempts

## Implementation Plan

### Phase 1: Backend Infrastructure (Priority: High)

**1.1 Create Authentication Middleware**

- File: `backend/src/middleware/auth.js`
- Extract and centralize JWT validation logic
- Implement req.user population with id, email, role, isAdmin
- Add comprehensive error handling
- Write unit tests for middleware

**1.2 Create Data Filter Helper**

- File: `backend/src/helpers/dataFilter.js`
- Implement applyUserFilter function
- Define entity configuration mapping
- Implement role-based filter logic
- Write unit tests for helper

**1.3 Update Route Handlers**

- Refactor `backend/src/routes/tasks.js`
- Refactor `backend/src/routes/dailyReports.js`
- Refactor `backend/src/routes/accessRequests.js`
- Refactor `backend/src/routes/activityLog.js`
- Refactor `backend/src/routes/operationalCosts.js`
- Replace inline role checks with dataFilter helper
- Add error handling and logging
- Write integration tests for each route

### Phase 2: Frontend UI Updates (Priority: Medium)

**2.1 Update Sidebar Navigation**

- File: `frontend/src/components/Sidebar.jsx`
- Add role-based visibility for admin-only items
- Test with both employee and admin accounts

**2.2 Update Page Components**

- Verify all pages use backend-filtered data
- Remove any client-side filtering logic
- Add loading and error states
- Test data display consistency

**2.3 Add Authorization Error Handling**

- Implement 403 error handling in API client
- Display user-friendly error messages
- Redirect to appropriate pages on auth errors

### Phase 3: Testing and Validation (Priority: High)

**3.1 Unit Tests**

- Write tests for authentication middleware
- Write tests for data filter helper
- Write tests for each route handler
- Achieve >80% code coverage

**3.2 Property-Based Tests**

- Install fast-check library
- Write property tests for each correctness property
- Configure 100+ iterations per test
- Verify all properties pass

**3.3 Integration Tests**

- Test end-to-end employee data isolation
- Test end-to-end admin full access
- Test Shopify data sharing
- Test unauthorized access scenarios

**3.4 Security Tests**

- Test SQL injection prevention
- Test authorization bypass attempts
- Test information disclosure prevention
- Perform penetration testing

### Phase 4: Documentation and Deployment (Priority: Medium)

**4.1 API Documentation**

- Document authentication requirements
- Document role-based access patterns
- Document error responses
- Create API usage examples

**4.2 Deployment**

- Deploy to staging environment
- Perform smoke tests
- Monitor logs for errors
- Deploy to production with rollback plan

**4.3 Monitoring Setup**

- Configure logging for auth/authz events
- Set up alerts for security incidents
- Create dashboard for access patterns
- Document incident response procedures

### Phase 5: Optimization (Priority: Low)

**5.1 Performance Optimization**

- Add database indexes for filtered queries
- Implement query result caching where appropriate
- Optimize N+1 query patterns
- Load test with realistic data volumes

**5.2 User Experience**

- Add loading indicators for data fetches
- Implement optimistic UI updates
- Add data refresh mechanisms
- Improve error message clarity

## Migration Strategy

### Backward Compatibility

**Current State:**

- Routes already implement role-based filtering inline
- Authentication middleware exists in each route file
- Frontend already uses AuthContext for role checks

**Migration Approach:**

- Refactor existing code to use centralized helpers
- No breaking changes to API contracts
- No database schema changes required
- No frontend API changes required

### Rollout Plan

**Step 1: Deploy Backend Changes**

- Deploy authentication middleware
- Deploy data filter helper
- Deploy updated route handlers
- Verify no regression in existing functionality

**Step 2: Deploy Frontend Changes**

- Deploy updated Sidebar with role-based visibility
- Deploy updated page components
- Verify UI correctly reflects user role

**Step 3: Monitoring and Validation**

- Monitor logs for authentication/authorization errors
- Verify data isolation working correctly
- Collect user feedback
- Address any issues discovered

### Rollback Plan

**If Issues Discovered:**

1. Revert to previous deployment
2. Investigate root cause
3. Fix issues in development environment
4. Re-test thoroughly
5. Re-deploy with fixes

**Rollback Triggers:**

- Increased error rates (>5% of requests)
- Data leakage between users
- Authentication failures for valid users
- Performance degradation (>2x response time)

## Future Enhancements

### Potential Improvements

**1. Row-Level Security (RLS)**

- Implement database-level RLS as defense-in-depth
- Requires careful configuration to work with service account
- Provides additional security layer

**2. Fine-Grained Permissions**

- Extend beyond admin/employee to custom roles
- Implement permission-based access control
- Allow per-user permission customization

**3. Data Access Audit Trail**

- Log all data access with user, timestamp, and query
- Provide audit reports for compliance
- Implement data access analytics

**4. Multi-Tenancy Support**

- Support multiple organizations in single deployment
- Isolate data between organizations
- Shared Shopify data per organization

**5. API Rate Limiting**

- Implement per-user rate limits
- Prevent abuse and DoS attacks
- Provide rate limit feedback to clients

---

**Document Version:** 1.0  
**Last Updated:** 2024-01-15  
**Status:** Ready for Implementation
