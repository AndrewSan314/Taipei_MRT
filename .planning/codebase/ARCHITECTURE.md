# Architecture

## Overview
The application follows a Service-Oriented Architecture (SOA) specialized for Geographic Information Systems (GIS) and routing logic. It acts as a middleware between static GIS data and dynamic frontend visualization.

## Layers

### 1. API Layer (`app/api/`)
- Handles HTTP requests using FastAPI.
- Manages routing endpoints for routing calculations and GIS data retrieval.
- Performs parameter validation (targets, coordinates).

### 2. Service Layer (`app/services/`)
- **GIS Loader**: Bridges GeoJSON files and in-memory data structures.
- **Route Engine**: Complex Dijkstra-based subway routing.
- **Walk Network Service**: Specialized graph operations for pedestrian pathfinding.
- **Runtime Artifacts**: Handles pre-computation and persistent caching of GIS results.

### 3. Domain Layer (`app/domain/`)
- Defines core business entities like `SubwayNetwork`, `Station`, `Line`, and `Segment`.
- Decouples logic from data storage formats.

### 4. Data Layer (`app/data/`)
- Static assets (GeoJSON, JSON scenarios).
- Dynamic cache (`.runtime-cache/`).

## Design Patterns
- **Memoization**: Heavy use of `lru_cache` and persistent file-based caching to avoid redundant heavy GIS computations.
- **Dependency Injection**: Services are injected into API routes.
- **Fallback Mechanisms**: Robust logic that can revert to simplified calculations (e.g., straight-line distance) if complex networks are unavailable.
