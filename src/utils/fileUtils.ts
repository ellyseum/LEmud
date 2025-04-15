import fs from 'fs';
import path from 'path';
import { systemLogger } from './logger';
import { parseAndValidateJson } from './jsonUtils';

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