# Phase 4: Admin Scenario Integration

## Context
The goal of this phase is to complete the end-to-end workflow for "Admin Scenarios" (banned stations, rain zones, and blocked segments). This allows administrators using the Admin Studio to define real-world incidents that automatically update the routing engine's paths and the GIS Studio's visualization.

## Technical Goals
- **Persistence**: Finalize the API for reading/writing `admin_scenarios.json`.
- **Runtime Integration**: Inject these scenarios into the `SubwayNetwork` loading process.
- **Cache Invalidation**: Ensure that saving a scenario immediately clears the routing and GIS caches.
- **Visual Feedback**: Flag closed elements in the GIS API so the map can render them in an "incident" state.

## Constraints
- **Speed**: Cache lookups must remains fast (using file timestamps for invalidation).
- **Public API**: Admin endpoints will remain public for this MVP phase.
- **GIS Flagging**: Elements should not be removed from the GIS view; instead, they should carry an `is_closed: true` property.
