import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ReminderConfig, ReminderData, TemplateVariables, ReminderResult, ReminderOptions } from './types';

export class MacOSReminderService {
  private config!: ReminderConfig; // Definite assignment assertion
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || this.findConfigFile();
    this.loadConfig();
  }

  /**
   * Find the configuration file in common locations
   */
  private findConfigFile(): string {
    const possiblePaths = [
      path.resolve('reminder-config.yaml'),
      path.resolve('macos-reminder-config.yaml'),
      path.resolve('config/reminder-config.yaml'),
      path.resolve(process.cwd(), 'reminder-config.yaml'),
    ];

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
      // Also check for .example versions
      if (fs.existsSync(configPath + '.example')) {
        return configPath + '.example';
      }
    }

    // Default to the first path if none found
    return possiblePaths[0];
  }

  private loadConfig(): void {
    try {
      // If the config file doesn't exist, try to use the example file
      let configFile = this.configPath;
      if (!fs.existsSync(this.configPath)) {
        const examplePath = this.configPath + '.example';
        if (fs.existsSync(examplePath)) {
          console.log(`⚠️  Config file not found at ${this.configPath}, using example file`);
          console.log(`💡 Copy ${examplePath} to ${this.configPath} to customize settings`);
          configFile = examplePath;
        } else {
          throw new Error(`Config file not found: ${this.configPath} (and no .example file found)`);
        }
      }

      const configContent = fs.readFileSync(configFile, 'utf8');
      const configData = yaml.load(configContent) as { reminder_config: ReminderConfig };
      
      if (!configData || !configData.reminder_config) {
        throw new Error('Invalid config file format: missing reminder_config section');
      }
      
      this.config = configData.reminder_config;

      console.log('📋 macOS reminder config loaded from:', configFile);
    } catch (error) {
      console.error('❌ Failed to load macOS reminder config:', error);
      throw new Error(`Failed to load reminder config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create a reminder with the provided data
   */
  async createReminder(reminderData: ReminderData): Promise<ReminderResult> {
    try {
      console.log('📝 Creating macOS reminder:', {
        title: reminderData.title,
        list: reminderData.list,
        priority: reminderData.priority
      });

      const success = await this.executeReminderCreation(reminderData);
      
      if (success) {
        console.log('✅ Successfully created reminder');
        return { success: true };
      } else {
        console.error('❌ Failed to create reminder');
        return { success: false, error: 'AppleScript execution failed' };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Error creating reminder:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Create a reminder using template-based configuration
   */
  async createReminderFromTemplate(variables: TemplateVariables, options?: ReminderOptions): Promise<ReminderResult> {
    try {
      const reminderData = this.prepareReminderDataFromTemplate(variables, options);
      return await this.createReminder(reminderData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Error creating reminder from template:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private prepareReminderDataFromTemplate(variables: TemplateVariables, options?: ReminderOptions): ReminderData {
    // Replace variables in title template
    let title = this.config.title_template;
    Object.entries(variables).forEach(([key, value]) => {
      title = title.replace(new RegExp(`{${key}}`, 'g'), value);
    });

    // Replace variables in notes template
    let notes = this.config.notes_template;
    Object.entries(variables).forEach(([key, value]) => {
      notes = notes.replace(new RegExp(`{${key}}`, 'g'), value);
    });

    // Parse tags
    const tags = this.config.tags.split(/\s+/).filter(tag => tag.length > 0);

    // Calculate due date
    let dueDate: string | undefined;
    let dueTime: string | undefined;

    if (this.config.due_date.today) {
      dueDate = new Date().toISOString().split('T')[0]; // Today's date in YYYY-MM-DD format
    } else if (this.config.due_date.days_offset > 0) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + this.config.due_date.days_offset);
      dueDate = targetDate.toISOString().split('T')[0];
    }

    // Determine due time based on options, content, or configuration
    if (options?.overrideDueTime) {
      // Use explicit override time
      dueTime = options.overrideDueTime;
      console.log(`⏰ Using override due time: ${dueTime}`);
    } else if (!options?.disableAutoTime) {
      // Use automatic time detection based on content
      dueTime = this.determineDueTime(title, notes, variables);
    }
    
    // Fallback to config time if no time was set
    if (!dueTime && this.config.due_date.time && this.config.due_date.time.trim()) {
      dueTime = this.config.due_date.time;
    }

    return {
      title,
      notes: notes.trim(),
      list: this.config.list_name,
      priority: this.config.default_priority,
      tags,
      dueDate,
      dueTime
    };
  }

  /**
   * Determine the due time based on reminder content patterns
   */
  private determineDueTime(title: string, notes: string, variables: TemplateVariables): string | undefined {
    // Combine title, notes, and all variable values for pattern matching
    const contentToCheck = [
      title.toLowerCase(),
      notes.toLowerCase(),
      ...Object.values(variables).map(v => v.toLowerCase())
    ].join(' ');

    // Check for lesson-related content - due at 7 AM
    if (contentToCheck.includes('lesson:')) {
      console.log('📚 Lesson reminder detected - setting due time to 7:00 AM');
      return '07:00';
    }

    // Check for habit-related content - due at 7 PM
    if (contentToCheck.includes('habit:')) {
      console.log('🔄 Habit reminder detected - setting due time to 7:00 PM');
      return '19:00';
    }

    // Check for review-related content - due at 7 PM
    if (contentToCheck.includes('review:')) {
      console.log('📝 Review reminder detected - setting due time to 7:00 PM');
      return '19:00';
    }

    // No specific pattern matched
    return undefined;
  }

  private async executeReminderCreation(reminderData: ReminderData): Promise<boolean> {
    try {
      console.log('📝 Creating reminder using AppleScript:', {
        list: reminderData.list,
        title: reminderData.title
      });

      // Build AppleScript to create reminder (create list if it doesn't exist)
      let appleScript = `
tell application "Reminders"
  -- Try to get the list, create it if it doesn't exist
  try
    set reminderList to list "${reminderData.list}"
  on error
    set reminderList to make new list with properties {name:"${reminderData.list}"}
  end try
  
  set newReminder to make new reminder in reminderList with properties {name:"${reminderData.title.replace(/"/g, '\\"')}"`;

      // Add notes if provided
      if (reminderData.notes && reminderData.notes.trim()) {
        const escapedNotes = reminderData.notes.replace(/"/g, '\\"').replace(/\n/g, '\\n');
        appleScript += `, body:"${escapedNotes}"`;
      }

      // Add due date if provided
      if (reminderData.dueDate) {
        // Convert YYYY-MM-DD to AppleScript date format (MM/DD/YYYY)
        const dateParts = reminderData.dueDate.split('-');
        if (dateParts.length === 3) {
          const appleScriptDate = `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`;
          console.log(`📅 Converting date: ${reminderData.dueDate} -> ${appleScriptDate}`);
          
          // If a specific time is provided, include it; otherwise just set the date
          if (reminderData.dueTime && reminderData.dueTime.trim()) {
            console.log(`⏰ Setting due time: ${reminderData.dueTime}`);
            appleScript += `, due date:date "${appleScriptDate} ${reminderData.dueTime}"`;
          } else {
            // Set only the date (will be treated as all-day by default)
            console.log(`📅 Setting due date only (no specific time)`);
            appleScript += `, due date:date "${appleScriptDate}"`;
          }
        } else {
          // Fallback to original format if parsing fails
          console.log(`⚠️  Date parsing failed, using original: ${reminderData.dueDate}`);
          if (reminderData.dueTime && reminderData.dueTime.trim()) {
            appleScript += `, due date:date "${reminderData.dueDate} ${reminderData.dueTime}"`;
          } else {
            appleScript += `, due date:date "${reminderData.dueDate}"`;
          }
        }
      }

      // Add priority if specified (AppleScript uses numeric values 1-9, where 9 is highest)
      if (reminderData.priority !== undefined && reminderData.priority >= 1 && reminderData.priority <= 9) {
        console.log(`📊 Setting priority: ${reminderData.priority}`);
        appleScript += `, priority:${reminderData.priority}`;
      }

      appleScript += `}
end tell`;

      console.log('🔧 Executing AppleScript to create reminder');
      
      // Execute AppleScript using osascript (write to temp file to avoid quoting issues)
      const { execSync } = await import('child_process');
      const tempScriptFile = path.join(process.cwd(), 'temp-reminder-script.scpt');
      
      // Write script to temporary file
      fs.writeFileSync(tempScriptFile, appleScript, 'utf8');
      
      try {
        const result = execSync(`osascript "${tempScriptFile}"`, {
          encoding: 'utf8',
          timeout: 10000 // 10 second timeout
        });
        
        // Clean up temp file
        fs.unlinkSync(tempScriptFile);
      } catch (error) {
        // Clean up temp file even on error
        try { fs.unlinkSync(tempScriptFile); } catch {}
        throw error;
      }

      console.log('✅ Reminder created successfully via AppleScript');
      return true;

    } catch (error) {
      console.error('❌ Failed to create reminder via AppleScript:', error);
      
      if (error instanceof Error) {
        if (error.message.includes('timeout')) {
          console.error('⏰ AppleScript execution timed out');
        } else if (error.message.includes('execution error')) {
          console.error('📱 Reminders app permission may be required');
          console.error('💡 Go to System Preferences > Privacy & Security > Automation to grant permissions');
        }
      }
      
      return false;
    }
  }

  /**
   * Test the AppleScript reminder creation
   */
  async testConnection(): Promise<boolean> {
    try {
      console.log('🧪 Testing AppleScript access to Reminders app...');
      
      // Test simple AppleScript execution
      const { execSync } = await import('child_process');
      const testScript = `tell application "Reminders" to get name of lists`;
      
      const result = execSync(`osascript -e '${testScript}'`, {
        encoding: 'utf8',
        timeout: 5000
      });

      console.log('✅ Reminders app access successful');
      console.log('📝 Available reminder lists:', result.trim());
      return true;

    } catch (error) {
      console.error('❌ Reminders app access test failed:', error);
      
      if (error instanceof Error && error.message.includes('execution error')) {
        console.error('📱 Reminders app permission may be required');
        console.error('💡 Go to System Preferences > Privacy & Security > Automation to grant permissions');
      }
      
      return false;
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): ReminderConfig {
    return { ...this.config };
  }

  /**
   * Reload configuration from file
   */
  reloadConfig(): void {
    this.loadConfig();
  }

  /**
   * Create a default configuration file
   */
  static createDefaultConfig(configPath: string): void {
    const defaultConfig = {
      reminder_config: {
        list_name: "Tasks",
        default_priority: 5,
        tags: "reminder",
        due_date: {
          today: true,
          days_offset: 0,
          time: ""
        },
        title_template: "{title}",
        notes_template: "{notes}"
      }
    };

    const yamlContent = yaml.dump(defaultConfig, {
      indent: 2,
      lineWidth: -1
    });

    fs.writeFileSync(configPath, yamlContent, 'utf8');
    console.log(`✅ Created default config file: ${configPath}`);
  }
}