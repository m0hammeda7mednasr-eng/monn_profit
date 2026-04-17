# Requirements Document

## Introduction

This document specifies the requirements for diagnosing and fixing the NetProfit page issue reported by the user. The user reports "صفحة صافي الربح مش شغالة خالص" (NetProfit page not working at all). The system must systematically diagnose the root cause and implement fixes to ensure the NetProfit page functions correctly with all its features: statistics display, products table, cost price editing, and operational costs management.

## Glossary

- **NetProfit_Page**: The frontend page component located at `/net-profit` that displays profit analytics and cost management
- **Sidebar**: The navigation component that displays menu items and controls page access
- **Backend_API**: The Express.js server that provides REST endpoints for data operations
- **Operational_Costs_Table**: The database table storing per-product operational costs (ads, shipping, packaging, etc.)
- **Products_Endpoint**: The API endpoint `/api/dashboard/products` that returns product data with cost_price field
- **Operational_Costs_Endpoint**: The API endpoint `/api/operational-costs` that manages operational costs CRUD operations
- **Statistics_Cards**: The five dashboard cards showing revenue, costs, operational costs, net profit, and profit margin
- **Cost_Price**: The purchase/manufacturing cost of a product stored in the products table
- **Frontend_Router**: The React Router configuration in App.jsx that maps URLs to components
- **Authentication_Token**: The JWT token stored in localStorage used for API authentication

## Requirements

### Requirement 1: Diagnose Page Visibility Issue

**User Story:** As a system administrator, I want to diagnose why the NetProfit page is not working, so that I can identify the root cause

#### Acceptance Criteria

1. THE Diagnostic_System SHALL verify the Sidebar menu item for "صافي الربح" is visible to all users
2. THE Diagnostic_System SHALL verify the Frontend_Router has a route configured for `/net-profit` path
3. THE Diagnostic_System SHALL verify the NetProfit_Page component is properly imported in App.jsx
4. THE Diagnostic_System SHALL verify clicking the sidebar link navigates to `/net-profit` without errors
5. IF the sidebar link is not visible, THEN THE Diagnostic_System SHALL check the `show` property in Sidebar.jsx menu configuration

### Requirement 2: Diagnose Database Schema

**User Story:** As a system administrator, I want to verify the database schema is correctly set up, so that the page can load data

#### Acceptance Criteria

1. THE Diagnostic_System SHALL verify the Operational_Costs_Table exists in the Supabase database
2. THE Diagnostic_System SHALL verify the products table has a `cost_price` column of type DECIMAL
3. THE Diagnostic_System SHALL verify Row Level Security (RLS) policies are enabled for Operational_Costs_Table
4. THE Diagnostic_System SHALL verify the `calculate_order_net_profit` function exists in the database
5. IF the Operational_Costs_Table does not exist, THEN THE Diagnostic_System SHALL report that ADD_OPERATIONAL_COSTS_TABLE.sql must be executed

### Requirement 3: Diagnose Backend API Endpoints

**User Story:** As a system administrator, I want to verify backend API endpoints are working, so that the frontend can fetch data

#### Acceptance Criteria

1. THE Diagnostic_System SHALL verify the Backend_API server is running on the configured port
2. THE Diagnostic_System SHALL verify the `/api/operational-costs` route is registered in server.js
3. THE Diagnostic_System SHALL verify the Products_Endpoint returns data with `cost_price` field included
4. THE Diagnostic_System SHALL verify the Operational_Costs_Endpoint responds to GET requests with valid Authentication_Token
5. WHEN the Products_Endpoint is called, THE Backend_API SHALL return an array or object with data property containing products
6. IF the Backend_API is not running, THEN THE Diagnostic_System SHALL report the server must be started

### Requirement 4: Diagnose Frontend Data Loading

**User Story:** As a system administrator, I want to verify the frontend correctly loads and displays data, so that users see the page content

#### Acceptance Criteria

1. THE Diagnostic_System SHALL verify the NetProfit_Page component calls `/api/dashboard/products` on mount
2. THE Diagnostic_System SHALL verify the NetProfit_Page component calls `/api/operational-costs` on mount
3. THE Diagnostic_System SHALL verify the Authentication_Token is present in localStorage
4. THE Diagnostic_System SHALL verify API responses are properly parsed and stored in component state
5. WHEN API calls fail, THEN THE NetProfit_Page SHALL display error messages to the user
6. WHEN products array is empty, THEN THE NetProfit_Page SHALL display "لا توجد منتجات" message

### Requirement 5: Fix Database Schema Issues

**User Story:** As a developer, I want to fix any missing database schema elements, so that the system has all required tables and columns

#### Acceptance Criteria

1. IF the Operational_Costs_Table does not exist, THEN THE System SHALL execute ADD_OPERATIONAL_COSTS_TABLE.sql in Supabase
2. IF the products table lacks cost_price column, THEN THE System SHALL add the column with type DECIMAL(10,2) DEFAULT 0
3. THE System SHALL verify all indexes on Operational_Costs_Table are created successfully
4. THE System SHALL verify all RLS policies on Operational_Costs_Table are active
5. THE System SHALL verify the `calculate_order_net_profit` function is callable without errors

### Requirement 6: Fix Backend API Issues

**User Story:** As a developer, I want to fix any backend API issues, so that endpoints return correct data

#### Acceptance Criteria

1. IF the operational-costs route is not registered, THEN THE System SHALL add the route registration in server.js
2. THE Products_Endpoint SHALL return products with all fields including id, title, price, cost_price, and image
3. THE Operational_Costs_Endpoint SHALL handle authentication errors with 401 status code
4. THE Operational_Costs_Endpoint SHALL return operational costs with product relationship data included
5. WHEN updating cost_price via PUT `/api/dashboard/products/:id`, THE Backend_API SHALL persist changes to database
6. THE Backend_API SHALL use consistent user ID extraction (req.user.id or req.user.userId) across all routes

### Requirement 7: Fix Frontend Component Issues

**User Story:** As a developer, I want to fix any frontend component issues, so that the page renders and functions correctly

#### Acceptance Criteria

1. THE NetProfit_Page SHALL handle empty products array without crashing
2. THE NetProfit_Page SHALL handle empty operational costs array without crashing
3. THE NetProfit_Page SHALL display loading state while fetching data
4. THE NetProfit_Page SHALL calculate statistics correctly using products and operational costs data
5. WHEN API calls return errors, THEN THE NetProfit_Page SHALL display Arabic error messages
6. THE Statistics_Cards SHALL display calculated values with 2 decimal places for currency
7. THE NetProfit_Page SHALL handle missing or null cost_price values by treating them as 0

### Requirement 8: Fix Routing and Navigation

**User Story:** As a user, I want to access the NetProfit page from the sidebar, so that I can view profit analytics

#### Acceptance Criteria

1. THE Sidebar SHALL display "صافي الربح" menu item with TrendingUp icon
2. THE Sidebar menu item SHALL have `show: true` to be visible to all authenticated users
3. THE Frontend_Router SHALL have a route mapping `/net-profit` to NetProfit_Page component
4. THE Frontend_Router SHALL wrap the NetProfit route with ProtectedRoute for authentication
5. WHEN a user clicks "صافي الربح" in Sidebar, THEN THE Frontend_Router SHALL navigate to `/net-profit`
6. THE NetProfit_Page SHALL render within the main layout with Sidebar visible

### Requirement 9: Verify End-to-End Functionality

**User Story:** As a quality assurance tester, I want to verify all NetProfit page features work end-to-end, so that users have a fully functional page

#### Acceptance Criteria

1. WHEN a user navigates to `/net-profit`, THEN THE NetProfit_Page SHALL display 5 Statistics_Cards with calculated values
2. WHEN a user views the products table, THEN THE NetProfit_Page SHALL display all products with price, cost_price, operational costs, net profit, and profit margin
3. WHEN a user clicks edit icon on a product, THEN THE NetProfit_Page SHALL show an input field for cost_price
4. WHEN a user saves a new cost_price, THEN THE Backend_API SHALL update the database and THE NetProfit_Page SHALL refresh data
5. WHEN a user clicks "إضافة تكلفة" button, THEN THE NetProfit_Page SHALL display the operational cost modal
6. WHEN a user submits a new operational cost, THEN THE Backend_API SHALL create the record and THE NetProfit_Page SHALL refresh data
7. WHEN a user deletes an operational cost, THEN THE Backend_API SHALL remove the record and THE NetProfit_Page SHALL recalculate statistics

### Requirement 10: Document Diagnostic Results

**User Story:** As a system administrator, I want a clear diagnostic report, so that I understand what was wrong and what was fixed

#### Acceptance Criteria

1. THE Diagnostic_System SHALL create a report listing all checks performed
2. THE Diagnostic_System SHALL indicate PASS or FAIL for each diagnostic check
3. THE Diagnostic_System SHALL list all fixes applied with before/after states
4. THE Diagnostic_System SHALL provide instructions for any manual steps required (e.g., running SQL scripts)
5. THE Diagnostic_System SHALL verify the fix by testing the page after repairs are complete
6. THE report SHALL be written in Arabic for user-facing sections and English for technical details
