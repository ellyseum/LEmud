import fs from 'fs';
import path from 'path';
import { systemLogger } from './logger';
import { parseAndValidateJson } from './jsonUtils';
import { isDebugMode } from './debugUtils';

/**
 * Load and validate a JSON file with the specified schema
 * 
 * @param filePath Path to the JSON file
 * @param dataType Type of data for validation
 * @returns The validated data or undefined if validation fails
 */
export function loadAndValidateJsonFile<T>(
  filePath: string,
  dataType: 'rooms' | 'users' | 'items' | 'npcs'
): T | undefined {
  try {
    if (!fs.existsSync(filePath)) {
      systemLogger.warn(`File not found: ${filePath}`);
      return undefined;
    }
    
    const data = fs.readFileSync(filePath, 'utf8');
    return parseAndValidateJson<T>(data, dataType);
  } catch (error) {
    systemLogger.error(`Error loading ${dataType} from ${filePath}:`, error);
    return undefined;
  }
}

/**
 * Save data to a JSON file
 * 
 * @param filePath Path to save the file
 * @param data Data to save
 * @returns True if successful, false otherwise
 */
export function saveJsonFile(filePath: string, data: any): boolean {
  try {
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    systemLogger.error(`Error saving to ${filePath}:`, error);
    return false;
  }
}

/**
 * Creates a reference file with log information for debugging
 * 
 * @param client The connected client object
 * @param username The username of the player/admin
 * @param isAdmin Whether this is an admin session
 * @returns void
 */
export function createSessionReferenceFile(client: any, username: string, isAdmin: boolean = false): void {
    try {
        // Only create the session reference file if debug mode is enabled
        // Debug mode is enabled either via CLI flag or active local session
        if (!isDebugMode()) {
            systemLogger.debug(`Session reference file not created: debug mode is disabled. Use --debug flag or start a local session.`);
            return;
        }

        const now = new Date();
        const dateTime = now.toISOString();
        const datePart = dateTime.split('T')[0]; // Extract YYYY-MM-DD
        
        // Find the raw log file using the same logic as bug report command
        let rawLogPath = null;
        if (client && client.connection) {
            const connectionId = client.connection.getId();
            if (connectionId) {
                const logFilename = `${connectionId}-${datePart}.log`;
                const logFilePath = path.join(process.cwd(), 'logs', 'raw-sessions', logFilename);
                
                if (fs.existsSync(logFilePath)) {
                    rawLogPath = `/logs/raw-sessions/${logFilename}`;
                    systemLogger.info(`Found raw log file for session reference: ${logFilename}`);
                } else {
                    systemLogger.warn(`Raw log file not found: ${logFilename}`);
                }
            }
        }
        
        // Player log path
        const playerLogPath = `/logs/players/${username}-${datePart}.log`;
        
        // Create the simplified template
        const content = `User Name: ${username}${isAdmin ? ' (admin)' : ''}
Date Time: ${dateTime}
Raw Log: ${rawLogPath || 'Not available'}
User Log: ${playerLogPath}`;
        
        // Write to the last-session.md file in the project root
        fs.writeFileSync(path.join(process.cwd(), 'last-session.md'), content);
        
        systemLogger.info(`Created simplified session reference file for user ${username}`);
    } catch (error) {
        systemLogger.error(`Failed to create session reference file: ${error}`);
    }
}

/**
 * Clears the last-session.md file, creating a placeholder instead
 * Used when starting the server in debug mode
 * 
 * @returns void
 */
export function clearSessionReferenceFile(): void {
    try {
        const placeholderContent = `User Name: None
Date Time: N/A
Raw Log: Not available
User Log: Not available`;
        
        // Write to the last-session.md file in the project root
        fs.writeFileSync(path.join(process.cwd(), 'last-session.md'), placeholderContent);
        
        systemLogger.debug(`Cleared session reference file on server startup`);
    } catch (error) {
        systemLogger.error(`Failed to clear session reference file: ${error}`);
    }
}