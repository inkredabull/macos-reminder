# macOS Reminder

A TypeScript library for creating and managing macOS reminders via AppleScript.

## Features

- 🍎 **macOS Native**: Uses AppleScript to interact with the built-in Reminders app
- ⚡ **TypeScript**: Full type safety and IntelliSense support
- 🎨 **Configurable**: YAML-based configuration with template support
- 📅 **Flexible Scheduling**: Support for due dates, times, and all-day reminders
- 🕐 **Smart Time Detection**: Automatic due time setting based on content patterns
- 🏷️ **Rich Metadata**: Tags, priorities, and custom notes
- 🛡️ **Error Handling**: Comprehensive error handling and permission guidance

## Installation

```bash
npm install @inkredabull/macos-reminder
```

## Quick Start

```typescript
import { MacOSReminderService } from '@inkredabull/macos-reminder';

const reminderService = new MacOSReminderService();

// Create a simple reminder
await reminderService.createReminder({
  title: 'Call the dentist',
  notes: 'Schedule annual cleaning appointment',
  list: 'Personal',
  dueDate: '2025-08-25'
});

// Smart time detection based on content
await reminderService.createReminderFromTemplate({
  title: 'Lesson: Spanish Grammar',
  notes: 'Review present tense conjugations'
}); // Automatically sets due time to 7:00 AM

await reminderService.createReminderFromTemplate({
  title: 'Habit: Daily Exercise', 
  notes: 'Complete 30 minutes of cardio'
}); // Automatically sets due time to 7:00 PM

await reminderService.createReminderFromTemplate({
  title: 'Review: Weekly Report',
  notes: 'Analyze project progress and metrics'
}); // Automatically sets due time to 7:00 PM
```

## Configuration

Create a `reminder-config.yaml` file:

```yaml
reminder_config:
  list_name: "Tasks"
  default_priority: 5
  tags: "reminder important"
  due_date:
    today: true
    days_offset: 0
    time: ""
  title_template: "{title}"
  notes_template: "{notes}"
```

## Smart Time Detection

The service automatically sets due times based on reminder content:

- **Lesson reminders** (containing "lesson:"): Set to **7:00 AM**
- **Habit reminders** (containing "habit:"): Set to **7:00 PM**
- **Review reminders** (containing "review:"): Set to **7:00 PM**
- **Other reminders**: Use configuration default or all-day

### Override Options

```typescript
// Override automatic time detection
await reminderService.createReminderFromTemplate(variables, {
  overrideDueTime: '14:30'  // 2:30 PM
});

// Disable automatic time detection
await reminderService.createReminderFromTemplate(variables, {
  disableAutoTime: true
});
```

## API Reference

### `MacOSReminderService`

#### Constructor

```typescript
new MacOSReminderService(configPath?: string)
```

- `configPath`: Optional path to YAML configuration file. If not provided, searches common locations.

#### Methods

- `createReminder(data: ReminderData): Promise<ReminderResult>`
- `createReminderFromTemplate(variables: TemplateVariables, options?: ReminderOptions): Promise<ReminderResult>`
- `testConnection(): Promise<boolean>`
- `getConfig(): ReminderConfig`
- `reloadConfig(): void`

#### Types

```typescript
interface ReminderData {
  title: string;
  notes?: string;
  list: string;
  priority?: number;      // 1-9, where 9 is highest
  tags?: string[];
  dueDate?: string;       // YYYY-MM-DD format
  dueTime?: string;       // HH:MM format (24-hour)
}

interface ReminderOptions {
  overrideDueTime?: string;    // Override automatic time detection
  disableAutoTime?: boolean;   // Disable automatic time detection
}

interface ReminderResult {
  success: boolean;
  error?: string;
}
```

## Requirements

- macOS 10.14 (Mojave) or later
- Node.js 16.0 or later
- Reminders app permissions

### Permissions

The library uses AppleScript to interact with the macOS Reminders app. When you first run the code:

1. macOS will prompt you to grant automation permissions
2. If not prompted automatically, go to **System Settings > Privacy & Security > Automation**
3. Enable permissions for your Terminal or application to control Reminders

## How It Works

### AppleScript Execution

The library:
1. Generates AppleScript code based on your reminder data
2. Writes the script to a temporary file (`temp-reminder-script.scpt`)
3. Executes the script using `osascript`
4. Cleans up the temporary file after execution

### Timeouts

- AppleScript execution has a **10-second timeout**
- If execution exceeds this limit, the operation will fail
- This prevents hanging if the Reminders app is unresponsive

### List Creation

If the specified reminder list doesn't exist, it will be created automatically.

## Troubleshooting

### Permission Errors

**Error**: `execution error` or `Reminders app permission may be required`

**Solution**:
1. Open **System Settings** (or System Preferences on older macOS)
2. Navigate to **Privacy & Security > Automation**
3. Find your Terminal app or Node.js application
4. Enable the checkbox for **Reminders**

### Timeout Errors

**Error**: `AppleScript execution timed out`

**Possible causes**:
- Reminders app is not responding
- System is under heavy load
- Complex AppleScript operation

**Solutions**:
- Close and reopen the Reminders app
- Restart your system if the issue persists
- Check Activity Monitor for Reminders app responsiveness

### Configuration Not Found

**Error**: `Config file not found`

**Solution**:
- Copy `config/reminder-config.yaml.example` to `reminder-config.yaml`
- Place the config file in your project root or current working directory
- Or specify a custom path: `new MacOSReminderService('/path/to/config.yaml')`

### Script Execution Fails

**Error**: Various AppleScript errors

**Debug steps**:
1. Test connection: `await reminderService.testConnection()`
2. Check the temporary script file if it wasn't cleaned up
3. Try running a simple AppleScript manually:
   ```bash
   osascript -e 'tell application "Reminders" to get name of lists'
   ```
4. Verify the Reminders app opens and responds normally

## Configuration File Locations

The service searches for configuration files in this order:

1. Path provided to constructor
2. `./reminder-config.yaml`
3. `./macos-reminder-config.yaml`
4. `./config/reminder-config.yaml`
5. `<cwd>/reminder-config.yaml`

If no config file is found, it will attempt to use `.example` versions.

## Advanced Usage

### Custom Time Patterns

You can extend the time detection by checking for custom patterns in your reminder content. The library provides basic patterns for lesson, habit, and review reminders.

### Priority Levels

AppleScript supports priority levels 1-9:
- **9**: Highest priority (!!!)
- **5**: Medium priority (!!)
- **1**: Low priority (!)
- **0**: No priority

### Tags

Tags are automatically split by whitespace:
```yaml
tags: "work urgent project-alpha"
```
Results in three tags: `["work", "urgent", "project-alpha"]`

## Examples

### Basic Task Reminder
```typescript
await reminderService.createReminder({
  title: 'Buy groceries',
  notes: 'Milk, eggs, bread',
  list: 'Shopping',
  priority: 7,
  dueDate: '2025-08-26'
});
```

### Template-Based Reminder
```typescript
await reminderService.createReminderFromTemplate({
  title: 'Meeting with {name}',
  notes: 'Discuss {topic}',
  name: 'Sarah',
  topic: 'Q3 planning'
});
```

### All-Day Event
```typescript
await reminderService.createReminder({
  title: 'Team offsite',
  list: 'Work',
  dueDate: '2025-09-15'
  // No dueTime = all-day reminder
});
```

### Specific Time
```typescript
await reminderService.createReminder({
  title: 'Doctor appointment',
  list: 'Personal',
  dueDate: '2025-08-30',
  dueTime: '14:30'  // 2:30 PM
});
```

## Testing

Run the connection test to verify permissions:

```typescript
const service = new MacOSReminderService();
const connected = await service.testConnection();

if (connected) {
  console.log('Ready to create reminders!');
} else {
  console.log('Check permissions in System Settings');
}
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and changes.