import fs from 'fs';
import path from 'path';

/**
 * Format a date to the desired string format
 * @param date The date to format
 * @param format The format string (only yyyy-MM-dd HH:mm:ss supported)
 */
function formatDate(date: Date, format: string): string {
  const pad = (num: number, size: number = 2) => String(num).padStart(size, '0');
  
  if (format === 'yyyy-MM-dd') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  
  if (format === 'yyyy-MM-dd HH:mm:ss') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
           `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  
  if (format === 'HH:mm:ss') {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
  
  return date.toISOString();
}

/**
 * RawSessionLogger - Logs raw session data directly to files without using Winston
 * Creates daily log files for each session
 */
export class RawSessionLogger {
  private logStream: fs.WriteStream | null = null;
  private logDir: string;
  private sessionId: string;
  private currentDate: string;
  private logFilePath: string = '';
  private maskingActive: boolean = false;
  private passwordMessageLogged: boolean = false;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.logDir = path.join(__dirname, '..', '..', 'logs', 'raw-sessions');
    this.currentDate = formatDate(new Date(), 'yyyy-MM-dd');
    
    // Ensure log directory exists
    this.ensureLogDirectoryExists();
    
    // Initialize log file
    this.createLogStream();
  }

  /**
   * Ensures the log directory exists
   */
  private ensureLogDirectoryExists(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Creates or rotates the log stream if needed
   */
  private createLogStream(): void {
    const today = formatDate(new Date(), 'yyyy-MM-dd');
    
    // If date has changed, close the current stream and create a new one
    if (this.currentDate !== today || !this.logStream) {
      this.closeStream();
      
      this.currentDate = today;
      this.logFilePath = path.join(this.logDir, `${this.sessionId}-${this.currentDate}.log`);
      
      // Create new write stream in append mode
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
      
      // Log session start
      const startMessage = `\n--- Session started/resumed at ${formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')} ---\n`;
      this.logStream.write(startMessage);
    }
  }

  /**
   * Sets whether password masking is active
   * @param active Whether masking is active
   */
  public setMasking(active: boolean): void {
    // If we're turning masking on
    if (active && !this.maskingActive) {
      this.maskingActive = true;
      this.passwordMessageLogged = false;
    } 
    // If we're turning masking off and it was previously on
    else if (!active && this.maskingActive) {
      this.maskingActive = false;
      
      if (this.logStream && this.logStream.writable) {
        const timestamp = formatDate(new Date(), 'HH:mm:ss');
        this.logStream.write(`[${timestamp}] >> [PASSWORD INPUT COMPLETE]\n`);
      }
    }
  }

  /**
   * Logs client input
   * @param data The raw input data from client
   */
  public logInput(data: string): void {
    this.checkDate();
    
    // If input masking is active (password input), don't log individual keystrokes
    if (this.maskingActive) {
      // Only log the masking notice once per password entry session
      if (!this.passwordMessageLogged && this.logStream && this.logStream.writable) {
        const timestamp = formatDate(new Date(), 'HH:mm:ss');
        this.logStream.write(`[${timestamp}] >> [PASSWORD INPUT MASKED]\n`);
        this.passwordMessageLogged = true;
      }
      return;
    }
    
    // Otherwise log normal input
    if (this.logStream && this.logStream.writable) {
      const timestamp = formatDate(new Date(), 'HH:mm:ss');
      this.logStream.write(`[${timestamp}] >> ${data}\n`);
    }
  }

  /**
   * Logs server output
   * @param data The raw output data sent to client
   */
  public logOutput(data: string): void {
    this.checkDate();
    if (this.logStream && this.logStream.writable) {
      const timestamp = formatDate(new Date(), 'HH:mm:ss');
      this.logStream.write(`[${timestamp}] << ${data}\n`);
    }
  }

  /**
   * Checks if date has changed and rotates log file if needed
   */
  private checkDate(): void {
    const today = formatDate(new Date(), 'yyyy-MM-dd');
    if (this.currentDate !== today) {
      this.createLogStream();
    }
  }

  /**
   * Closes the log stream
   */
  public closeStream(): void {
    if (this.logStream) {
      const endMessage = `--- Session ended at ${formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')} ---\n`;
      this.logStream.write(endMessage);
      this.logStream.end();
      this.logStream = null;
    }
  }
  
  /**
   * Check if masking is currently active
   */
  public isMaskingActive(): boolean {
    return this.maskingActive;
  }
}

/**
 * Factory function to create or retrieve a session logger
 */
const sessionLoggers = new Map<string, RawSessionLogger>();

export function getSessionLogger(sessionId: string): RawSessionLogger {
  if (!sessionLoggers.has(sessionId)) {
    sessionLoggers.set(sessionId, new RawSessionLogger(sessionId));
  }
  return sessionLoggers.get(sessionId)!;
}

/**
 * Closes a specific session logger
 */
export function closeSessionLogger(sessionId: string): void {
  const logger = sessionLoggers.get(sessionId);
  if (logger) {
    logger.closeStream();
    sessionLoggers.delete(sessionId);
  }
}

/**
 * Closes all session loggers
 */
export function closeAllSessionLoggers(): void {
  for (const [id, logger] of sessionLoggers.entries()) {
    logger.closeStream();
    sessionLoggers.delete(id);
  }
}