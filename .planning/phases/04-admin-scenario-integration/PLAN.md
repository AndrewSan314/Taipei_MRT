# Plan: Phase 4 - Admin Scenario Integration

## Research Task
- Confirm interaction between `apply_admin_scenarios_to_network` and `RouteEngine` initialization. `RouteEngine` precomputes paths, so we MUST ensure it uses the filtered network.
- Verify GeoJSON property injection point in `get_gis_network`.

## Checklist

### 1. Preparation
- [ ] Verify `app/data/admin_scenarios.json` path in `config.py`.

### 2. Runtime & Caching Logic
- [ ] **[MODIFY] `app/services/runtime.py`**:
    - [ ] Update `_load_network_cached` to load `admin_scenarios.json` and attach effects as metadata. 
    - [ ] Update `_load_route_engine_cached` to apply filtering to the network before initializing `RouteEngine`.
    - [ ] Update `_build_signature` to include `settings.admin_scenarios_file` timestamp.

### 3. API Endpoints
- [ ] **[MODIFY] `app/api/routes.py`**:
    - [ ] Define `AdminScenarioSaveRequest` Pydantic model.
    - [ ] Implement `GET /api/admin/scenarios` (fetch from service).
    - [ ] Implement `PUT /api/admin/scenarios` (save + refresh cache).
    - [ ] Implement `DELETE /api/admin/scenarios` (reset + refresh cache).
    - [ ] Update `get_gis_network` to inject `is_closed: true` into GeoJSON features for stations and segments.

### 4. Verification
- [ ] **Manual Test: Banned Station**:
    - [ ] Save a ban for "Taipei Main Station".
    - [ ] Check `/api/gis/network` to see if `"is_closed": true` property is present for the station.
    - [ ] Try to route through the station and verify a detour is found.
- [ ] **Manual Test: Reset**:
    - [ ] Call `DELETE` and verify the network returns to normal.
