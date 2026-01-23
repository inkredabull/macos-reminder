# Changelog

## [1.2.0] - 2025-08-24

### Added
- **Review reminders**: Automatically set to 7:00 PM when title/content contains "review:"

### Changed
- Enhanced smart time detection to include review reminders alongside habit reminders for 7:00 PM scheduling
- Updated documentation with review reminder examples

## [1.1.0] - 2025-08-24

### Added
- **Smart Time Detection**: Automatic due time setting based on content patterns
- **Lesson reminders**: Automatically set to 7:00 AM when title/content contains "lesson:"
- **Habit reminders**: Automatically set to 7:00 PM when title/content contains "habit:"
- **ReminderOptions**: New options interface for controlling time behavior
  - `overrideDueTime`: Override automatic time detection
  - `disableAutoTime`: Disable automatic time detection
- Enhanced `createReminderFromTemplate()` method to accept options parameter
- Comprehensive logging for time detection decisions

### Changed
- Improved API with better type safety for options
- Enhanced documentation with smart time detection examples

## [1.0.0] - 2025-08-24

### Added
- Initial release of macOS Reminder service as standalone package
- TypeScript support with full type definitions
- YAML-based configuration system
- Template-based reminder creation
- AppleScript integration for native Reminders app
- Comprehensive error handling and permission guidance
- Connection testing functionality
- Support for due dates, priorities, and tags
- All-day and timed reminder support

### Extracted from
- Original job-extractor project MacOSReminderService
- Enhanced with improved API and better error handling
- Fixed AppleScript syntax issues for better compatibility