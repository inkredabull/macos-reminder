/**
 * Configuration interface for macOS reminder service
 */
export interface ReminderConfig {
  list_name: string;
  default_priority: number;
  tags: string;
  due_date: {
    today: boolean;
    days_offset: number;
    time: string;
  };
  title_template: string;
  notes_template: string;
}

/**
 * Data structure for creating a reminder
 */
export interface ReminderData {
  title: string;
  notes?: string;
  list: string;
  priority?: number;
  tags?: string[];
  dueDate?: string;
  dueTime?: string;
}

/**
 * Options for creating reminders with conditional time rules
 */
export interface ReminderOptions {
  /** Override the automatic time detection */
  overrideDueTime?: string;
  /** Disable automatic time detection based on content */
  disableAutoTime?: boolean;
}

/**
 * Template variables that can be used in title and notes templates
 */
export interface TemplateVariables {
  [key: string]: string;
}

/**
 * Result of reminder creation operation
 */
export interface ReminderResult {
  success: boolean;
  error?: string;
}