# Implementation Plan: Shopify Bidirectional Sync System

## Overview

This implementation plan breaks down the Shopify Bidirectional Sync system into 8 phases following the design document. The system enables bidirectional synchronization between the local application and Shopify, supporting product/order updates, webhook processing, conflict resolution, and automatic inventory restocking.

The implementation uses TypeScript/JavaScript for backend (Node.js + Express) and frontend (React), with PostgreSQL (Supabase) as the database and Redis for caching and rate limiting.

## Tasks

- [ ] 1. Phase 1: Database Schema Setup
  - [ ] 1.1 Create new database tables
    - Create `sync_operations` table with indexes
    - Create `conflict_queue` table with indexes
    - Create `webhook_events` table with indexes
    - Create `rate_limit_tracking` table with indexes
    - _Requirements: 3.1, 4.4, 5.4, 12.1_

  - [ ] 1.2 Update existing tables with sync columns
    - Add sync-related columns to `products` table (pending_sync, last_synced_at, sync_error, local_updated_at, shopify_updated_at)
    - Add sync-related columns to `orders` table (notes JSONB, pending_sync, last_synced_at, sync_error, local_updated_at, shopify_updated_at)
    - Create indexes for pending_sync and last_synced_at columns
    - _Requirements: 1.2, 2.2, 9.1_

  - [ ] 1.3 Set up Redis for caching and rate limiting
    - Install and configure Redis connection
    - Create Redis client with connection pooling
    - Test Redis connectivity
    - _Requirements: 3.1_

- [ ] 2. Phase 2: Rate Limiter Service
  - [ ] 2.1 Implement RateLimiterService class
    - Implement `canMakeRequest()` method with sliding window algorithm
    - Implement `waitForSlot()` method with queue management
    - Implement `recordRequest()` method with Redis tracking
    - Implement `getRequestStats()` method
    - Ensure max 2 requests per second per user
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]\* 2.2 Write property test for rate limiter
    - **Property 4: Rate Limit Enforcement**
    - **Validates: Requirements 3.1, 3.7**
    - Test that no user can exceed 2 requests per second in any sliding window

  - [ ]\* 2.3 Write unit tests for RateLimiterService
    - Test canMakeRequest with various request patterns
    - Test waitForSlot queue behavior
    - Test request cleanup after 1 minute
    - _Requirements: 3.5_

- [ ] 3. Phase 3: Sync Operations Logger
  - [ ] 3.1 Implement SyncOperationsLogger service
    - Implement `logOperation()` method to create sync_operations records
    - Implement `getOperationHistory()` with filtering support
    - Implement `getFailedOperations()` query
    - Implement `retryFailedOperation()` method
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ] 3.2 Create API endpoints for sync operations
    - Create `GET /api/sync-operations` endpoint with filters
    - Create `GET /api/sync-operations/failed` endpoint
    - Create `POST /api/sync-operations/:id/retry` endpoint
    - Add authentication middleware
    - _Requirements: 12.1_

  - [ ]\* 3.3 Write unit tests for SyncOperationsLogger
    - Test logOperation creates correct records
    - Test filtering by status, type, date range
    - Test retry functionality
    - _Requirements: 12.1, 12.4, 12.5_

- [ ] 4. Phase 4: Product Update Service
  - [ ] 4.1 Implement ProductUpdateService class
    - Implement `updatePrice()` method with local save and async sync
    - Implement `updateInventory()` method with local save and async sync
    - Implement `updateProduct()` generic method
    - Add input validation (price >= 0, inventory >= 0, max values)
    - Implement transaction rollback on errors
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.6, 2.7, 2.8_

  - [ ] 4.2 Implement syncToShopify async method
    - Check rate limiter before sending request
    - Build Shopify API payload
    - Send PUT request to Shopify products endpoint
    - Handle success: update pending_sync, last_synced_at, shopify_updated_at
    - Handle failure: save error message, keep pending_sync true
    - Handle 429 rate limit: retry with exponential backoff
    - Log all operations in sync_operations
    - _Requirements: 1.3, 1.4, 1.5, 2.3, 2.4, 2.5, 3.1_

  - [ ] 4.3 Create product update API endpoints
    - Create `POST /api/products/:id/update-price` endpoint
    - Create `POST /api/products/:id/update-inventory` endpoint
    - Create `POST /api/products/:id/update` generic endpoint
    - Add input validation middleware
    - Add authentication and authorization
    - _Requirements: 1.1, 2.1_

  - [ ]\* 4.4 Write unit tests for ProductUpdateService
    - Test updatePrice with valid/invalid inputs
    - Test updateInventory with valid/invalid inputs
    - Test transaction rollback on database errors
    - Test validation rules (negative values, max limits)
    - _Requirements: 1.6, 1.7, 1.8, 2.6, 2.7, 2.8_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Phase 5: Webhook Handler Service
  - [ ] 6.1 Implement webhook signature validation
    - Implement `validateWebhookSignature()` using HMAC SHA256
    - Use crypto.timingSafeEqual to prevent timing attacks
    - Return 401 for invalid signatures
    - Log failed validation attempts in security log
    - _Requirements: 4.1, 4.2, 4.6, 4.7_

  - [ ]\* 6.2 Write property test for webhook signature validation
    - **Property 3: Signature Validity**
    - **Validates: Requirements 4.1, 4.2**
    - Test that only webhooks with valid HMAC signatures are processed

  - [ ] 6.3 Implement WebhookHandlerService class
    - Implement `handleProductUpdate()` method
    - Implement `handleProductDelete()` method
    - Implement `handleOrderUpdate()` method
    - Implement `handleRefundCreate()` method
    - Implement `handleInventoryUpdate()` method
    - Save all webhooks to webhook_events table
    - Return 200 OK within 5 seconds
    - Process webhooks asynchronously
    - _Requirements: 4.3, 4.4, 4.5, 6.1, 11.1_

  - [ ] 6.4 Create webhook endpoints
    - Create `POST /api/webhooks/products/create` endpoint
    - Create `POST /api/webhooks/products/update` endpoint
    - Create `POST /api/webhooks/products/delete` endpoint
    - Create `POST /api/webhooks/orders/updated` endpoint
    - Create `POST /api/webhooks/refunds/create` endpoint
    - Create `POST /api/webhooks/inventory_levels/update` endpoint
    - Add signature validation middleware
    - Add rate limiting for webhook endpoints
    - _Requirements: 4.1, 4.3, 4.4_

  - [ ]\* 6.5 Write unit tests for WebhookHandlerService
    - Test signature validation with valid/invalid signatures
    - Test webhook saving to database
    - Test 200 OK response timing
    - Test security logging for failed attempts
    - _Requirements: 4.2, 4.6, 4.8_

- [ ] 7. Phase 6: Conflict Resolution Service
  - [ ] 7.1 Implement ConflictResolutionService class
    - Implement `detectConflict()` method with timestamp comparison
    - Implement 5-second threshold for same-update detection
    - Implement `resolveConflict()` with multiple strategies
    - Implement `queueConflict()` to save to conflict_queue
    - Implement `getConflictQueue()` for user conflicts
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 7.2 Implement conflict resolution strategies
    - Implement `shopify_wins` strategy
    - Implement `local_wins` strategy with re-sync
    - Implement `latest_wins` strategy with timestamp comparison
    - Implement `manual_review` strategy
    - Update conflict_queue status to resolved
    - Save resolved_value in conflict_queue
    - _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ]\* 7.3 Write property test for conflict resolution
    - **Property 5: Conflict Resolution Correctness**
    - **Validates: Requirements 5.5, 5.6, 5.7, 5.8**
    - Test that conflict resolution produces deterministic results based on strategy

  - [ ] 7.4 Implement processProductUpdate with conflict detection
    - Fetch local product by shopify_id
    - Create new product if not exists
    - Detect conflicts using ConflictResolutionService
    - Save conflicts to conflict_queue
    - Apply latest_wins strategy automatically
    - Update local data if no conflict
    - Update shopify_updated_at timestamp
    - Log operation in sync_operations
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]\* 7.5 Write unit tests for conflict detection and resolution
    - Test detectConflict with various timestamp differences
    - Test 5-second threshold behavior
    - Test each resolution strategy
    - Test conflict queue saving
    - _Requirements: 5.2, 5.3, 5.4, 5.9, 5.10_

- [ ] 8. Phase 7: Order Management Service
  - [ ] 8.1 Implement OrderManagementService class
    - Implement `getOrderDetails()` method with full data fetch
    - Implement `updateOrderStatus()` with validation
    - Implement `addOrderNote()` with XSS sanitization
    - Implement `cancelOrder()` method
    - _Requirements: 8.1, 9.1, 10.1_

  - [ ] 8.2 Implement order details retrieval
    - Fetch all order data from database
    - Include customer information (name, email, address)
    - Include all line items with quantities and prices
    - Include order status and fulfillment status
    - Include all notes sorted by created_at
    - Include created_at and updated_at timestamps
    - Include total price
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ] 8.3 Implement addOrderNote method
    - Validate note content is not empty
    - Sanitize HTML tags to prevent XSS
    - Save note to orders.notes JSONB array
    - Record author, created_at, content
    - Set synced_to_shopify to false
    - Start async sync with Shopify
    - Update synced_to_shopify on success
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [ ] 8.4 Implement updateOrderStatus method
    - Validate status is one of: pending, authorized, paid, partially_paid, refunded, voided, partially_refunded
    - Update orders.status locally
    - Set pending_sync to true
    - Start async sync with Shopify
    - Update pending_sync to false on success
    - Save error message on failure
    - Log operation in sync_operations
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [ ] 8.5 Create order management API endpoints
    - Create `GET /api/orders/:id/details` endpoint
    - Create `POST /api/orders/:id/update-status` endpoint
    - Create `POST /api/orders/:id/notes` endpoint
    - Create `POST /api/orders/:id/cancel` endpoint
    - Add authentication and authorization
    - _Requirements: 8.1, 9.1, 10.1_

  - [ ]\* 8.6 Write unit tests for OrderManagementService
    - Test getOrderDetails returns complete data
    - Test addOrderNote validation and sanitization
    - Test updateOrderStatus validation
    - Test XSS prevention in notes
    - _Requirements: 9.2, 9.7, 10.2_

- [ ] 9. Phase 8: Refund Processing
  - [ ] 9.1 Implement processRefundCreate method
    - Fetch local order by shopify_id
    - Process each refund_line_item
    - Check restock_type for each item
    - Increase inventory for return/cancel/legacy_restock types
    - Skip inventory update for no_restock type
    - Update products.inventory_quantity
    - Update orders.status to refunded
    - Update local_updated_at and shopify_updated_at
    - Log operation in sync_operations
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [ ]\* 9.2 Write property test for inventory restock
    - **Property 6: Inventory Restock Correctness**
    - **Validates: Requirements 11.4, 11.5**
    - Test that refunds always increase inventory by the correct refunded quantity

  - [ ]\* 9.3 Write unit tests for refund processing
    - Test inventory increase calculation
    - Test restock_type handling
    - Test no_restock behavior
    - Test order status update
    - _Requirements: 11.3, 11.4, 11.9_

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Phase 9: Background Job Processing
  - [ ] 11.1 Set up Bull Queue for async processing
    - Install and configure Bull with Redis
    - Create queue for sync operations
    - Create queue for webhook processing
    - Configure retry logic with exponential backoff
    - _Requirements: 1.3, 4.5_

  - [ ] 11.2 Create job processors
    - Create processor for product sync jobs
    - Create processor for order sync jobs
    - Create processor for webhook processing jobs
    - Add error handling and logging
    - _Requirements: 1.3, 2.3, 4.5_

  - [ ] 11.3 Implement job monitoring
    - Add job status tracking
    - Add failed job retry mechanism
    - Add job completion notifications
    - _Requirements: 12.4, 12.5_

- [ ] 12. Phase 10: Frontend - Products Page Updates
  - [ ] 12.1 Update Products page with edit functionality
    - Add inline edit buttons for price and inventory
    - Implement optimistic UI updates
    - Show syncing indicator during sync
    - Show success/error states
    - Add rollback on failure
    - _Requirements: 1.1, 2.1_

  - [ ] 12.2 Add sync status indicators
    - Show pending_sync status with icon
    - Show last_synced_at timestamp
    - Show sync_error messages
    - Add retry button for failed syncs
    - _Requirements: 1.4, 1.5, 2.4, 2.5_

  - [ ] 12.3 Implement real-time updates with WebSocket
    - Set up Socket.IO client connection
    - Listen for product update events
    - Update product list on webhook events
    - Show notification for external updates
    - _Requirements: 6.8_

  - [ ]\* 12.4 Write integration tests for Products page
    - Test edit flow with optimistic UI
    - Test sync status display
    - Test error handling and rollback
    - Test real-time updates

- [ ] 13. Phase 11: Frontend - Orders Page Updates
  - [ ] 13.1 Create order details view
    - Display customer information
    - Display all line items with details
    - Display order status and fulfillment status
    - Display total price
    - Display created and updated timestamps
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.7, 8.8_

  - [ ] 13.2 Implement order notes section
    - Display all notes sorted by date
    - Add form to create new notes
    - Show author and timestamp for each note
    - Show sync status for each note
    - Sanitize note content display
    - _Requirements: 8.6, 9.1, 9.8_

  - [ ] 13.3 Add order status update functionality
    - Add status dropdown with valid options
    - Implement status update with sync
    - Show pending sync indicator
    - Show success/error messages
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ] 13.4 Implement real-time order updates
    - Listen for order update events via WebSocket
    - Update order details on webhook events
    - Show notification for status changes
    - _Requirements: 6.8_

  - [ ]\* 13.5 Write integration tests for Orders page
    - Test order details display
    - Test note creation and display
    - Test status update flow
    - Test real-time updates

- [ ] 14. Phase 12: Frontend - Sync Log Page
  - [ ] 14.1 Create Sync Log page component
    - Create table to display sync operations
    - Show operation type, entity, direction, status
    - Show timestamps and duration
    - Show error messages for failed operations
    - _Requirements: 12.1, 12.2, 12.5_

  - [ ] 14.2 Implement filtering and search
    - Add filters for status (success, failed, pending)
    - Add filters for operation type
    - Add filters for entity type
    - Add date range filter
    - Add search by entity ID
    - _Requirements: 12.1_

  - [ ] 14.3 Add retry functionality
    - Add retry button for failed operations
    - Show retry progress
    - Update status after retry
    - Show success/error notification
    - _Requirements: 12.5_

  - [ ] 14.4 Implement pagination
    - Add pagination controls
    - Load operations in batches
    - Show total count
    - _Requirements: 12.1_

- [ ] 15. Phase 13: Frontend - Conflicts Page
  - [ ] 15.1 Create Conflicts page component
    - Create table to display conflicts
    - Show entity type and ID
    - Show local value vs Shopify value
    - Show timestamps for both updates
    - Show conflict status
    - _Requirements: 5.4, 5.9_

  - [ ] 15.2 Implement manual conflict resolution
    - Add buttons to choose local or Shopify value
    - Add button to apply latest_wins strategy
    - Show resolution preview
    - Confirm before applying resolution
    - Update conflict status after resolution
    - _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9_

  - [ ] 15.3 Add conflict history view
    - Show resolved conflicts
    - Display resolution strategy used
    - Display final value applied
    - Display resolution timestamp
    - _Requirements: 5.9, 5.10_

- [ ] 16. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Phase 14: Integration Testing
  - [ ]\* 17.1 Write integration test for product update flow
    - Test complete flow: UI update → local save → Shopify sync → confirmation
    - Verify database state at each step
    - Verify sync_operations logging
    - Verify optimistic UI behavior
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]\* 17.2 Write integration test for webhook processing
    - Test webhook receipt → validation → processing → database update
    - Verify HMAC signature validation
    - Verify webhook_events logging
    - Verify real-time UI updates
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]\* 17.3 Write integration test for conflict resolution
    - Test concurrent local and Shopify updates
    - Verify conflict detection
    - Verify conflict queue saving
    - Verify automatic resolution
    - Verify final data state
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9_

  - [ ]\* 17.4 Write integration test for refund processing
    - Test refund webhook → inventory update → order status update
    - Verify inventory increase calculation
    - Verify restock_type handling
    - Verify sync_operations logging
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]\* 17.5 Write property test for webhook idempotency
    - **Property 7: Idempotency for Webhooks**
    - **Validates: Requirements 4.5**
    - Test that processing the same webhook multiple times produces the same result

- [ ] 18. Phase 15: Performance Optimization
  - [ ] 18.1 Optimize database queries
    - Add missing indexes identified during testing
    - Use SELECT with specific columns instead of SELECT \*
    - Implement pagination for large result sets
    - Analyze slow queries with EXPLAIN ANALYZE
    - _Requirements: All_

  - [ ] 18.2 Implement caching strategy
    - Cache frequently accessed products in Redis
    - Set appropriate TTL (5 minutes for products)
    - Invalidate cache on updates
    - Cache Shopify tokens
    - _Requirements: 1.1, 2.1, 6.1_

  - [ ] 18.3 Optimize webhook processing
    - Implement parallel processing for independent webhooks
    - Batch database updates where possible
    - Optimize conflict detection algorithm
    - _Requirements: 4.5, 5.1_

  - [ ]\* 18.4 Run performance tests
    - Test with 10 concurrent users updating products
    - Test with 50 webhooks per minute
    - Test with 100 concurrent sync operations
    - Test with 1000+ products in database
    - Verify response times meet targets (<200ms local, <2s sync)

- [ ] 19. Phase 16: Security Hardening
  - [ ] 19.1 Implement input validation
    - Validate all user inputs with Joi schemas
    - Sanitize HTML in notes and comments
    - Validate UUID formats
    - Prevent SQL injection with parameterized queries
    - _Requirements: 1.6, 1.7, 2.6, 2.7, 9.2, 9.7, 10.2_

  - [ ] 19.2 Implement API rate limiting
    - Add express-rate-limit to API endpoints
    - Set 100 requests per 15 minutes per IP
    - Set 60 webhooks per minute per shop
    - _Requirements: 3.1_

  - [ ] 19.3 Implement token encryption
    - Encrypt Shopify access tokens before storing
    - Use AES-256-GCM encryption
    - Store encryption key in environment variable
    - Decrypt tokens only when needed
    - _Requirements: 4.1_

  - [ ] 19.4 Add security headers
    - Implement Helmet middleware
    - Enable HSTS with 1-year max-age
    - Force HTTPS in production
    - Add CSP headers
    - _Requirements: All_

  - [ ]\* 19.5 Run security tests
    - Test HMAC signature validation
    - Test authorization checks
    - Test input validation
    - Test XSS prevention
    - Test SQL injection prevention

- [ ] 20. Phase 17: Monitoring and Logging
  - [ ] 20.1 Set up application logging
    - Configure Winston logger
    - Log all sync operations
    - Log all webhook events
    - Log all errors with stack traces
    - Log security events
    - _Requirements: 4.6, 12.1_

  - [ ] 20.2 Implement error tracking
    - Set up Sentry for error tracking
    - Configure error grouping
    - Add user context to errors
    - Set up error notifications
    - _Requirements: 1.5, 2.5, 4.8_

  - [ ] 20.3 Add performance monitoring
    - Track sync operation duration
    - Track webhook processing time
    - Track database query time
    - Track API response times
    - Set up alerts for slow operations
    - _Requirements: All_

  - [ ] 20.4 Create monitoring dashboard
    - Display sync success rate
    - Display average sync time
    - Display webhook processing stats
    - Display conflict resolution rate
    - Display rate limit hits
    - Display failed operations count
    - _Requirements: 12.1_

- [ ] 21. Phase 18: Documentation and Deployment
  - [ ] 21.1 Write API documentation
    - Document all API endpoints
    - Include request/response examples
    - Document authentication requirements
    - Document error codes and messages
    - _Requirements: All_

  - [ ] 21.2 Write deployment guide
    - Document environment variables
    - Document database setup steps
    - Document Redis setup
    - Document Shopify webhook configuration
    - Document production deployment steps
    - _Requirements: All_

  - [ ] 21.3 Write user guide
    - Document how to update products
    - Document how to manage orders
    - Document how to view sync logs
    - Document how to resolve conflicts
    - Document troubleshooting steps
    - _Requirements: All_

  - [ ] 21.4 Deploy to staging environment
    - Set up staging server
    - Deploy backend and frontend
    - Configure webhooks for staging
    - Run smoke tests
    - _Requirements: All_

  - [ ] 21.5 Deploy to production
    - Set up production server with load balancer
    - Deploy backend and frontend
    - Configure webhooks for production
    - Enable monitoring and alerts
    - Run post-deployment verification
    - _Requirements: All_

- [ ] 22. Final Checkpoint - Complete system verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end flows
- The implementation follows the 8-phase plan from the design document
- TypeScript is used for all backend and frontend code
- All sync operations are logged for audit and retry capability
- Conflict resolution uses the latest_wins strategy by default
- Rate limiting ensures compliance with Shopify's 2 requests/second limit
