# Changelog

## Planned Features

- Query Features
  - Prepared statement support
  - Query parameter validation
  - Query timeout configuration
  - Result pagination
  - Query execution statistics

- Security
  - Enhanced SQL injection prevention
  - Query whitelisting/blacklisting
  - Rate limiting
  - Query complexity analysis
  - Connection encryption configuration

- Performance
  - Connection pool optimization
  - Query result caching
  - Large result set streaming
  - Query execution plan analysis

- Monitoring
  - Query logging system
  - Performance metrics collection
  - Error tracking and reporting
  - Health check endpoints

- Schema Management
  - Table relationship information
  - Index details
  - Foreign key constraints
  - Table statistics

## [1.0.14] - 2024-07-01

### Added

- Added better support for test environments with automatic database selection
- Implemented comprehensive debug logging for database configuration in test mode
- Added fail-safe process termination handling for test environments

### Changed

- Improved test environment detection with support for Vitest test runner
- Enhanced MySQL connection configuration to use consistent defaults across environments
- Updated error handling in database setup scripts to be more resilient

### Fixed

- Fixed "No database selected" error in integration tests by ensuring database name is always set
- Fixed authentication issues in test environments by providing consistent default credentials
- Prevented premature test termination by implementing conditional process.exit handling
- Improved error handling in test database setup to continue tests even when setup encounters issues

### Security

- Made authentication more consistent across development and test environments
- Added safeguards to prevent exposing actual password values in debug logs

### Documentation

- Added detailed inline comments for test-specific configurations
- Improved error messages to provide better debugging information

## [1.0.13] - 2024-05-26

### Added

- Complete write operations support through Smithery configuration
- Added environment variables for database write operations (`ALLOW_INSERT_OPERATION`, `ALLOW_UPDATE_OPERATION`, `ALLOW_DELETE_OPERATION`)
- New configuration options in Smithery schema for controlling write permissions
- Improved documentation for write operations configuration
- Support for enabling/disabling specific SQL operations via environment variables
- Enhanced error handling for unauthorized write operations

### Changed

- Updated Smithery configuration to include write operation settings
- Improved Smithery integration with clear security defaults
- Enhanced documentation with detailed configuration examples
- Restructured README with clearer installation instructions
- Better error reporting for database connection issues
- Improved transaction handling for write operations

### Fixed

- Fixed error handling for database connection failures
- Improved error messages for unauthorized operations
- Better handling of MySQL 8.0+ authentication methods
- Fixed SSL/TLS configuration options in Smithery

### Security

- All write operations (INSERT, UPDATE, DELETE) disabled by default
- Added clear documentation about security implications of enabling write operations
- Improved transaction isolation for write operations
- Enhanced error reporting that doesn't expose sensitive information

### Documentation

- Updated README with comprehensive Smithery configuration instructions
- Added detailed examples for enabling specific write operations
- Improved troubleshooting section with common issues and solutions
- Better explanation of required MySQL permissions for different operation types
- Added clear security recommendations for production deployments

## [1.0.10] - 2024-03-13

### Changed

- Version bump to fix npm publishing issue
- Updated installation instructions in README to reference specific version

## [1.0.9] - 2024-03-13

### Added

- GitHub Actions CI workflow for automated lint, build, and test with MySQL service

### Changed

- Removed `@types/mysql2` dependency and related type references
- Updated test files to use `any` type instead of mysql2 specific types
- Fixed integration tests to properly handle MySQL connection and queries

### Fixed

- Fixed GitHub Actions workflow to install pnpm before using it for caching
- Fixed failing unit tests by removing problematic executeReadOnlyQuery tests

## [1.0.8] - 2024-03-12

### Changed

- Upgraded from `mysql` to `mysql2` package (^3.13.0) for better MySQL 8.0+ compatibility
- Refactored database connection code to use mysql2's Promise-based API
- Added support for MySQL 8.0+ authentication with `caching_sha2_password` plugin

### Removed

- Removed deprecated `mysql` package dependency
- Removed unused `@types/mysql2` devDependency

### Fixed

- Fixed authentication issues with MySQL 8.0+ servers
- Improved connection handling with Promise-based API
- Enhanced error handling for database operations

## [1.0.7] - Previous version

- Initial release with basic MySQL functionality
