/**
 * In-memory ring buffer log service for capturing application logs.
 * Replaces console.log/warn/error with structured, exportable log entries.
 */

export interface LogEntry {
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    tag: string;
    message: string;
}

export class LogService {
    private static logs: LogEntry[] = [];
    private static readonly MAX_LOGS = 500;

    /**
     * Log an info-level message
     * @param tag - Category tag (e.g., 'CastManager', 'SSDP')
     * @param message - Log message
     */
    static info(tag: string, message: string): void {
        this.addEntry('info', tag, message);
        console.log(`[${tag}] ${message}`);
    }

    /**
     * Log a warning-level message
     * @param tag - Category tag
     * @param message - Log message
     */
    static warn(tag: string, message: string): void {
        this.addEntry('warn', tag, message);
        console.warn(`[${tag}] ${message}`);
    }

    /**
     * Log an error-level message
     * @param tag - Category tag
     * @param message - Log message
     */
    static error(tag: string, message: string): void {
        this.addEntry('error', tag, message);
        console.error(`[${tag}] ${message}`);
    }

    /**
     * Get all stored log entries
     * @returns Copy of the log entries array
     */
    static getLogs(): LogEntry[] {
        return [...this.logs];
    }

    /**
     * Get log entry count
     * @returns Number of stored log entries
     */
    static getCount(): number {
        return this.logs.length;
    }

    /**
     * Export all logs as a formatted text string
     * @returns Formatted log text ready for sharing
     */
    static export(): string {
        if (this.logs.length === 0) {
            return 'No logs recorded.';
        }

        return this.logs.map(entry => {
            const date = new Date(entry.timestamp).toISOString();
            return `${date} [${entry.level.toUpperCase()}] [${entry.tag}] ${entry.message}`;
        }).join('\n');
    }

    /**
     * Clear all stored log entries
     */
    static clear(): void {
        this.logs = [];
    }

    /**
     * Add a log entry to the ring buffer
     */
    private static addEntry(level: 'info' | 'warn' | 'error', tag: string, message: string): void {
        this.logs.push({
            timestamp: Date.now(),
            level,
            tag,
            message,
        });

        if (this.logs.length > this.MAX_LOGS) {
            this.logs.shift();
        }
    }
}
