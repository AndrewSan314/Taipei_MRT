# Conventions

## Coding Style
- **PEP 8**: Focus on readable naming conventions and clear structure.
- **Type Hinting**: Extensive use of Python type hints for better maintainability and code analysis.
- **Docstrings**: Services and utility functions are expected to have descriptive docstrings (though consistency varies).

## Architecture Patterns
- **Async/Await**: Preferred for all API routes and IO-bound operations (though some core graph logic remains synchronous for performance reasons).
- **Service Decoupling**: API routes should call services rather than implementing business logic directly.
- **Data Encapsulation**: Domain models are used to encapsulate network state.

## GIS & Optimization Conventions
- **Signatures**: Large data files use MD5 or SHA-256 signatures to detect changes and invalidate caches.
- **Caching**: 
  - `lru_cache` for in-memory memoization.
  - `pickle` for cross-session persistence of pre-computed graphs.
- **Dijkstra Early-Exit**: Standardized practice for walk network searches to minimize computation.

## Project Workflow
- **PowerShell Integration**: Primary automation shell for Windows environments.
- **Modular Scripts**: Maintenance tasks (like cache building) are kept in a separate `scripts/` folder.
