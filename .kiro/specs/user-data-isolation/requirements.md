# Requirements Document: User Data Isolation System

## Introduction

This document specifies requirements for implementing a user data isolation system that separates user-specific data while maintaining shared access to Shopify-synced resources. The system ensures employees see only their own tasks, reports, and activities, while administrators have full visibility across all users. All users share the same Shopify products and orders, with changes synchronized in real-time.

## Glossary

- **User**: An authenticated person with either employee or admin role
- **Employee**: A user with role='employee' who has restricted data access
- **Admin**: A user with role='admin' who has unrestricted data access to all users' information
- **User_Generated_Data**: Database records created by users (tasks, reports, access requests, activity logs, operational costs)
- **Shopify_Data**: Database records synchronized from Shopify (products, orders, customers)
- **Data_Filter**: Backend logic that restricts query results based on user identity and role
- **Auth_Middleware**: Express middleware that validates JWT tokens and attaches user information to requests
- **User_Context**: The authenticated user's ID and role available in req.user

## Requirements

### Requirement 1: Employee Data Isolation

**User Story:** As an employee, I want to see only my own data, so that I maintain privacy and focus on my assigned work.

#### Acceptance Criteria

1. WHEN an Employee requests tasks, THE Backend SHALL return only tasks where user_id matches the Employee's ID
2. WHEN an Employee requests daily reports, THE Backend SHALL return only reports where created_by matches the Employee's ID
3. WHEN an Employee requests access requests, THE Backend SHALL return only access requests where user_id matches the Employee's ID
4. WHEN an Employee requests activity logs, THE Backend SHALL return only activity logs where user_id matches the Employee's ID
5. WHEN an Employee requests operational costs, THE Backend SHALL return only operational costs where created_by matches the Employee's ID
6. FOR ALL User_Generated_Data queries by Employees, THE Data_Filter SHALL apply user_id restriction before returning results

### Requirement 2: Administrator Full Access

**User Story:** As an administrator, I want to see all users' data, so that I can monitor operations and manage the team effectively.

#### Acceptance Criteria

1. WHEN an Admin requests tasks, THE Backend SHALL return all tasks regardless of user_id
2. WHEN an Admin requests daily reports, THE Backend SHALL return all reports regardless of created_by
3. WHEN an Admin requests access requests, THE Backend SHALL return all access requests regardless of user_id
4. WHEN an Admin requests activity logs, THE Backend SHALL return all activity logs regardless of user_id
5. WHEN an Admin requests operational costs, THE Backend SHALL return all operational costs regardless of created_by
6. FOR ALL User_Generated_Data queries by Admins, THE Data_Filter SHALL NOT apply user_id restrictions

### Requirement 3: Shared Shopify Data Access

**User Story:** As a user, I want to access all Shopify products and orders, so that I can work with the complete inventory and order information.

#### Acceptance Criteria

1. WHEN any User requests products, THE Backend SHALL return all products from the Shopify_Data without user_id filtering
2. WHEN any User requests orders, THE Backend SHALL return all orders from the Shopify_Data without user_id filtering
3. WHEN any User requests customers, THE Backend SHALL return all customers from the Shopify_Data without user_id filtering
4. THE Backend SHALL NOT apply Data_Filter to Shopify_Data tables (products, orders, customers)
5. WHEN Shopify data is updated via webhook or sync, THE Backend SHALL update the shared data visible to all users

### Requirement 4: Role-Based Filter Application

**User Story:** As a system, I want to automatically apply the correct data filters based on user role, so that data isolation is enforced consistently.

#### Acceptance Criteria

1. WHEN a request is received, THE Auth_Middleware SHALL extract the user's role from the JWT token
2. WHEN the user role is 'admin', THE Backend SHALL set a bypass flag in User_Context
3. WHEN the user role is 'employee', THE Backend SHALL set a filter flag in User_Context
4. WHEN processing User_Generated_Data queries, THE Backend SHALL check the User_Context flags before applying filters
5. IF the bypass flag is true, THEN THE Backend SHALL execute queries without user_id restrictions
6. IF the filter flag is true, THEN THE Backend SHALL add WHERE user_id = req.user.id to queries

### Requirement 5: Task Assignment Visibility

**User Story:** As an employee, I want to see tasks assigned to me, so that I know what work I need to complete.

#### Acceptance Criteria

1. WHEN an Employee requests their tasks, THE Backend SHALL return tasks where assigned_to matches the Employee's ID
2. WHEN an Admin requests tasks, THE Backend SHALL return all tasks with assigned_to information for all users
3. WHEN a task is created with assigned_to field, THE Backend SHALL allow the assigned Employee to view that task
4. THE Backend SHALL filter tasks by assigned_to field for Employees and not filter for Admins

### Requirement 6: Operational Cost Segregation

**User Story:** As an employee, I want to see only operational costs I created, so that I can track my expense entries without seeing others' data.

#### Acceptance Criteria

1. WHEN an Employee requests operational costs, THE Backend SHALL return only costs where created_by matches the Employee's ID
2. WHEN an Admin requests operational costs, THE Backend SHALL return all operational costs with created_by information
3. WHEN calculating net profit for Employees, THE Backend SHALL include only the Employee's operational costs in calculations
4. WHEN calculating net profit for Admins, THE Backend SHALL include all operational costs in calculations

### Requirement 7: Authentication and Authorization Enforcement

**User Story:** As a system administrator, I want all API endpoints to enforce authentication and role-based authorization, so that unauthorized access is prevented.

#### Acceptance Criteria

1. WHEN a request is received without a valid JWT token, THE Backend SHALL return HTTP 401 Unauthorized
2. WHEN a request is received with an expired JWT token, THE Backend SHALL return HTTP 401 Unauthorized
3. WHEN a request is received with a valid JWT token, THE Auth_Middleware SHALL attach user information to req.user
4. THE req.user object SHALL contain id, email, and role fields extracted from the JWT token
5. WHEN User_Context is not available, THE Backend SHALL reject the request before executing database queries

### Requirement 8: Database Query Modification

**User Story:** As a developer, I want database queries to be automatically modified based on user role, so that data isolation is implemented consistently across all endpoints.

#### Acceptance Criteria

1. WHEN an Employee queries User_Generated_Data, THE Backend SHALL append "WHERE user_id = $1" or "WHERE created_by = $1" to SQL queries
2. WHEN an Admin queries User_Generated_Data, THE Backend SHALL execute SQL queries without additional WHERE clauses for user filtering
3. WHEN querying Shopify_Data, THE Backend SHALL execute SQL queries without user_id filtering regardless of role
4. FOR ALL database queries on User_Generated_Data tables, THE Backend SHALL apply role-based filtering before execution
5. THE Backend SHALL use parameterized queries with req.user.id to prevent SQL injection

### Requirement 9: Frontend Permission Handling

**User Story:** As a user, I want the frontend to display only the features and data I have permission to access, so that the interface is clear and relevant to my role.

#### Acceptance Criteria

1. WHEN an Employee logs in, THE Frontend SHALL hide admin-only navigation items (Users page, all users' reports)
2. WHEN an Admin logs in, THE Frontend SHALL display all navigation items including admin-specific pages
3. WHEN displaying data lists, THE Frontend SHALL show only the data returned by the Backend's filtered queries
4. THE Frontend SHALL read user role from AuthContext to determine UI visibility
5. THE Frontend SHALL NOT implement data filtering logic (filtering is Backend responsibility)

### Requirement 10: Activity Log Isolation

**User Story:** As an employee, I want to see only my own activity history, so that I can review my actions without seeing other users' activities.

#### Acceptance Criteria

1. WHEN an Employee requests activity logs, THE Backend SHALL return only logs where user_id matches the Employee's ID
2. WHEN an Admin requests activity logs, THE Backend SHALL return all activity logs for all users
3. WHEN an activity is logged, THE Backend SHALL record the user_id from User_Context
4. THE Backend SHALL order activity logs by timestamp in descending order (most recent first)

### Requirement 11: Data Consistency Across User Sessions

**User Story:** As a user, I want changes to shared Shopify data to be visible immediately to all users, so that everyone works with current information.

#### Acceptance Criteria

1. WHEN Shopify data is updated, THE Backend SHALL update the database records without user_id association
2. WHEN any User queries Shopify data after an update, THE Backend SHALL return the updated data
3. THE Backend SHALL NOT cache Shopify_Data in a user-specific manner
4. FOR ALL Shopify webhook events, THE Backend SHALL process updates that affect all users simultaneously

### Requirement 12: Error Handling for Unauthorized Access

**User Story:** As a system, I want to handle unauthorized access attempts gracefully, so that security violations are logged and users receive appropriate feedback.

#### Acceptance Criteria

1. WHEN an Employee attempts to access another user's data directly (via URL manipulation), THE Backend SHALL return HTTP 403 Forbidden
2. WHEN an unauthorized access attempt occurs, THE Backend SHALL log the attempt with user_id and requested resource
3. WHEN a 403 error is returned, THE Backend SHALL include a message "Access denied: insufficient permissions"
4. THE Backend SHALL NOT reveal information about the existence of data the user cannot access
