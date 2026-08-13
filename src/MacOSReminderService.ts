import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ReminderConfig, ReminderData, TemplateVariables, ReminderResult, ReminderOptions } from './types';

/**
 * The Reminders app answers Apple Events off a single serialized queue, and its
 * latency scales with how many reminders the target list already holds — a list
 * with a few hundred items can take 20s+ just to resolve. Keep the ceiling
 * generous so a slow-but-working Reminders app doesn't look like a failure.
 */
const DEFAULT_OSASCRIPT_TIMEOUT_MS = 120_000;

export class MacOSReminderService {
  private config!: ReminderConfig; // Definite assignment assertion
  private configPath: string;
  private static tempFileCounter = 0;

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
    const [result] = await this.createReminders([reminderData]);
    return result;
  }

  /**
   * Create several reminders in a single osascript invocation.
   *
   * Creating them one-at-a-time pays the Reminders app's multi-second Apple
   * Event startup cost per reminder, which is what pushes individual calls past
   * their timeout. Batching pays it once for the whole set.
   */
  async createReminders(reminders: ReminderData[]): Promise<ReminderResult[]> {
    if (reminders.length === 0) {
      return [];
    }

    console.log(`📝 Creating ${reminders.length} macOS reminder(s):`);
    reminders.forEach(r => {
      console.log(`   • ${r.title} (list: ${r.list}, priority: ${r.priority})`);
    });

    try {
      return await this.executeReminderCreation(reminders);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Error creating reminders:', errorMessage);
      return reminders.map(() => ({ success: false, error: errorMessage }));
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

  /**
   * Escape a value for interpolation into a double-quoted AppleScript string.
   * Backslashes must go first so the escapes we add aren't themselves escaped.
   */
  private escapeForAppleScript(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  /**
   * Build an AppleScript expression for a `YYYY-MM-DD` (+ optional `HH:MM`) due date.
   *
   * Deliberately avoids `date "..."` string coercion, which is locale-dependent
   * and fails *silently*: under en_US a 24-hour time like "14:00" parses to
   * midnight rather than erroring, so timed reminders quietly lose their time.
   * The makeReminderDate handler sets the date components directly instead.
   *
   * The components are also validated here rather than in AppleScript because an
   * unparseable date is a *compile* error, which aborts the whole script instead
   * of just the one reminder - a per-reminder `try` block can't contain that.
   */
  private toAppleScriptDateExpression(dueDate: string, dueTime?: string): string {
    const dateMatch = dueDate.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!dateMatch) {
      throw new Error(`Invalid dueDate "${dueDate}" (expected YYYY-MM-DD)`);
    }

    const [year, month, day] = dateMatch.slice(1).map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error(`Invalid dueDate "${dueDate}" (month or day out of range)`);
    }

    // No time means midnight, which Reminders shows as an all-day reminder
    let secondsIntoDay = 0;
    if (dueTime && dueTime.trim()) {
      const timeMatch = dueTime.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!timeMatch) {
        throw new Error(`Invalid dueTime "${dueTime}" (expected HH:MM)`);
      }
      const [hours, minutes] = timeMatch.slice(1).map(Number);
      if (hours > 23 || minutes > 59) {
        throw new Error(`Invalid dueTime "${dueTime}" (hour or minute out of range)`);
      }
      secondsIntoDay = hours * 3600 + minutes * 60;
    }

    return `my makeReminderDate(${year}, ${month}, ${day}, ${secondsIntoDay})`;
  }

  /**
   * AppleScript handler that assembles a date from its components.
   * `day` is pinned to 1 before setting the month so a source date late in the
   * month can't roll over into the next one (e.g. Jan 31 -> month 2).
   */
  private static readonly MAKE_DATE_HANDLER = [
    'on makeReminderDate(y, m, d, secondsIntoDay)',
    '  set dueDate to current date',
    '  set day of dueDate to 1',
    '  set year of dueDate to y',
    '  set month of dueDate to m',
    '  set day of dueDate to d',
    '  set time of dueDate to secondsIntoDay',
    '  return dueDate',
    'end makeReminderDate'
  ].join('\n');

  /**
   * Render a reminder's `with properties {...}` record for AppleScript.
   * Throws if the reminder's due date can't be represented.
   */
  private buildPropertiesRecord(reminderData: ReminderData): string {
    const properties = [`name:"${this.escapeForAppleScript(reminderData.title)}"`];

    if (reminderData.notes && reminderData.notes.trim()) {
      properties.push(`body:"${this.escapeForAppleScript(reminderData.notes)}"`);
    }

    if (reminderData.dueDate) {
      properties.push(`due date:${this.toAppleScriptDateExpression(reminderData.dueDate, reminderData.dueTime)}`);
    }

    // AppleScript priorities are 1-9, where 9 is highest
    if (reminderData.priority !== undefined && reminderData.priority >= 1 && reminderData.priority <= 9) {
      properties.push(`priority:${reminderData.priority}`);
    }

    return `{${properties.join(', ')}}`;
  }

  /**
   * Build one script that resolves each target list once and creates every
   * reminder, reporting per-reminder success so a single bad reminder can't
   * take the whole batch down.
   */
  private buildBatchScript(reminders: ReminderData[]): { script: string; scripted: number[]; rejected: Map<number, string> } {
    // Render every record first: anything we can't represent is rejected here so
    // it never reaches the script and can't break the reminders around it.
    const records = new Map<number, string>();
    const rejected = new Map<number, string>();
    reminders.forEach((reminder, index) => {
      try {
        records.set(index, this.buildPropertiesRecord(reminder));
      } catch (error) {
        rejected.set(index, error instanceof Error ? error.message : String(error));
      }
    });

    const scripted = [...records.keys()];
    if (scripted.length === 0) {
      return { script: '', scripted, rejected };
    }

    const listVariable = new Map<string, string>();
    const lines: string[] = ['set statuses to {}', 'tell application "Reminders"'];

    [...new Set(scripted.map(index => reminders[index].list))].forEach((listName, listIndex) => {
      const variable = `targetList${listIndex}`;
      listVariable.set(listName, variable);
      const escaped = this.escapeForAppleScript(listName);
      lines.push(
        '  -- Reuse the list if it exists, otherwise create it',
        '  try',
        `    set ${variable} to list "${escaped}"`,
        '  on error',
        `    set ${variable} to make new list with properties {name:"${escaped}"}`,
        '  end try'
      );
    });

    scripted.forEach(index => {
      lines.push(
        '  try',
        `    make new reminder in ${listVariable.get(reminders[index].list)} with properties ${records.get(index)}`,
        `    set end of statuses to "OK\t${index}"`,
        '  on error errorMessage',
        `    set end of statuses to "ERR\t${index}\t" & errorMessage`,
        '  end try'
      );
    });

    lines.push(
      'end tell',
      // Delimiter assignment has to sit outside the `tell` so it targets AppleScript itself
      "set AppleScript's text item delimiters to linefeed",
      'return statuses as text',
      MacOSReminderService.MAKE_DATE_HANDLER
    );

    return { script: lines.join('\n'), scripted, rejected };
  }

  /**
   * How long osascript gets before we give up. The Reminders app can need tens
   * of seconds per call on large lists, so the ceiling scales with batch size.
   */
  private resolveTimeoutMs(reminderCount: number): number {
    const override = Number(process.env.MACOS_REMINDER_TIMEOUT_MS);
    if (Number.isFinite(override) && override > 0) {
      return override;
    }
    return DEFAULT_OSASCRIPT_TIMEOUT_MS + Math.max(0, reminderCount - 1) * 15_000;
  }

  private async executeReminderCreation(reminders: ReminderData[]): Promise<ReminderResult[]> {
    const { script, scripted, rejected } = this.buildBatchScript(reminders);

    // Start from the rejected-before-scripting verdicts; the script fills in the rest
    const results: ReminderResult[] = reminders.map((_, index) => ({
      success: false,
      error: rejected.get(index) ?? 'AppleScript did not report a result for this reminder'
    }));

    if (scripted.length > 0) {
      const timeoutMs = this.resolveTimeoutMs(scripted.length);
      console.log(`🔧 Executing AppleScript to create ${scripted.length} reminder(s) (timeout ${timeoutMs}ms)`);

      // Write the script to a temp file so we don't have to quote it through the shell.
      // Unique per call: concurrent runs share a cwd and would clobber a fixed name.
      const { execSync } = await import('child_process');
      const uniqueSuffix = `${process.pid}-${MacOSReminderService.tempFileCounter++}`;
      const tempScriptFile = path.join(os.tmpdir(), `macos-reminder-${uniqueSuffix}.applescript`);

      let output = '';
      let failure: string | undefined;
      try {
        fs.writeFileSync(tempScriptFile, script, 'utf8');
        output = execSync(`osascript "${tempScriptFile}"`, {
          encoding: 'utf8',
          timeout: timeoutMs,
          killSignal: 'SIGKILL'
        });
      } catch (error) {
        failure = this.describeAppleScriptFailure(error, timeoutMs);
      } finally {
        try { fs.unlinkSync(tempScriptFile); } catch { /* best effort cleanup */ }
      }

      if (failure) {
        scripted.forEach(index => { results[index] = { success: false, error: failure }; });
      } else {
        this.applyBatchOutput(output, results);
      }
    }

    results.forEach((result, index) => {
      if (result.success) {
        console.log(`✅ Created reminder: ${reminders[index].title}`);
      } else {
        console.error(`❌ Failed to create reminder "${reminders[index].title}": ${result.error}`);
      }
    });

    return results;
  }

  /**
   * Fold per-reminder "OK<tab>index" / "ERR<tab>index<tab>message" lines from the
   * script back into `results`. Indices are the caller's, so they map directly.
   */
  private applyBatchOutput(output: string, results: ReminderResult[]): void {
    for (const line of output.split('\n')) {
      const match = line.match(/^(OK|ERR)\t(\d+)(?:\t([\s\S]*))?$/);
      if (!match) continue;

      const index = Number(match[2]);
      if (index < 0 || index >= results.length) continue;

      results[index] = match[1] === 'OK'
        ? { success: true }
        : { success: false, error: (match[3] || 'AppleScript execution failed').trim() };
    }
  }

  private describeAppleScriptFailure(error: unknown, timeoutMs: number): string {
    const stderr = (error as { stderr?: string })?.stderr?.trim();
    const message = stderr || (error instanceof Error ? error.message : String(error));
    const timedOut = (error as { code?: string })?.code === 'ETIMEDOUT' || message.includes('ETIMEDOUT');

    if (timedOut) {
      console.error(`⏰ AppleScript execution timed out after ${timeoutMs}ms`);
      console.error('💡 The Reminders app gets slower as its lists grow - archive completed reminders,');
      console.error('   or raise the ceiling with MACOS_REMINDER_TIMEOUT_MS');
      console.error('⚠️  Some reminders may still have been created before the timeout');
      return `osascript timed out after ${timeoutMs}ms`;
    }

    console.error('❌ osascript failed:', message);

    if (message.includes('execution error')) {
      console.error('📱 Reminders app permission may be required');
      console.error('💡 Go to System Preferences > Privacy & Security > Automation to grant permissions');
    }

    return message;
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
        timeout: this.resolveTimeoutMs(1)
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