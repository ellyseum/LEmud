import fs from 'fs';
import path from 'path';
import { parseAndValidateJson, formatValidationErrors, JsonValidationError } from './jsonUtils';
import { systemLogger } from './logger';

/**
 * Validates a JSON file against the appropriate schema
 * 
 * @param filePath Path to the JSON file
 * @param dataType Type of data to validate
 * @returns Object with validation result and error messages
 */
function validateJsonFile(filePath: string, dataType: 'rooms' | 'users' | 'items' | 'npcs'): { 
  valid: boolean; 
  message: string;
  data?: any;
} {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        message: `File not found: ${filePath}`
      };
    }
    
    const data = fs.readFileSync(filePath, 'utf8');
    const validatedData = parseAndValidateJson(data, dataType);
    
    return {
      valid: true,
      message: `✓ File is valid: ${filePath}`,
      data: validatedData
    };
  } catch (error: unknown) {
    if (error instanceof JsonValidationError) {
      let errorMsg = `✗ Validation failed for ${filePath}:\n`;
      errorMsg += error.message;
      
      if (error.errors) {
        errorMsg += '\n' + formatValidationErrors(error.errors);
      }
      
      return {
        valid: false,
        message: errorMsg
      };
    } else if (error instanceof SyntaxError) {
      return {
        valid: false,
        message: `✗ Invalid JSON syntax in ${filePath}: ${error.message}`
      };
    } else {
      return {
        valid: false,
        message: `✗ Error validating ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Print colorful validation result
 */
function printValidationResult(result: { valid: boolean; message: string }): void {
  if (result.valid) {
    console.log(`\x1b[32m${result.message}\x1b[0m`); // Green text for valid
  } else {
    console.log(`\x1b[31m${result.message}\x1b[0m`); // Red text for invalid
  }
}

/**
 * Validate all files in the data directory
 */
function validateAllFiles(dataDir: string): boolean {
  console.log(`\n------ Validating files in ${dataDir} ------\n`);
  let allValid = true;
  
  // Map of files to their data types
  const fileDataTypes: Record<string, 'rooms' | 'users' | 'items' | 'npcs'> = {
    'rooms.json': 'rooms',
    'users.json': 'users',
    'items.json': 'items',
    'itemInstances.json': 'items', // This will be detected as item instances automatically
    'npcs.json': 'npcs'
  };
  
  // Validate each supported file
  for (const [filename, dataType] of Object.entries(fileDataTypes)) {
    const filePath = path.join(dataDir, filename);
    if (fs.existsSync(filePath)) {
      const result = validateJsonFile(filePath, dataType);
      printValidationResult(result);
      if (!result.valid) {
        allValid = false;
      }
    } else {
      console.log(`\x1b[33m⚠ File not found: ${filePath}\x1b[0m`); // Yellow warning
    }
  }
  
  console.log('\n-----------------------------------------\n');
  
  return allValid;
}

/**
 * Main function when script is executed directly
 */
function main(): void {
  // Get command line arguments
  const args = process.argv.slice(2);
  const defaultDataDir = path.join(__dirname, '..', '..', 'data');
  
  // Show help message if requested
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run validate [options] [file-paths...]');
    console.log('\nOptions:');
    console.log('  --help, -h     Show this help message');
    console.log('  --all, -a      Validate all known data files');
    console.log('  --dir=PATH     Specify a custom data directory');
    console.log('\nExamples:');
    console.log('  npm run validate                         # Validates all files in default data directory');
    console.log('  npm run validate data/rooms.json         # Validates specific file');
    console.log('  npm run validate --dir=custom/data       # Validates all files in custom directory');
    return;
  }
  
  // Check if we should validate all files
  const validateAll = args.includes('--all') || args.includes('-a') || args.length === 0;
  
  // Get data directory from args or use default
  let dataDir = defaultDataDir;
  const dirArg = args.find(arg => arg.startsWith('--dir='));
  if (dirArg) {
    dataDir = dirArg.replace('--dir=', '');
  }
  
  if (validateAll) {
    // Validate all files in the data directory
    const allValid = validateAllFiles(dataDir);
    if (allValid) {
      console.log('\x1b[32m✓ All files are valid!\x1b[0m'); // Green text
      process.exit(0);
    } else {
      console.log('\x1b[31m✗ Some files failed validation. See errors above.\x1b[0m'); // Red text
      process.exit(1);
    }
  } else {
    // Validate specific files passed as arguments
    let allValid = true;
    const filePaths = args.filter(arg => !arg.startsWith('-'));
    
    for (const filePath of filePaths) {
      const fileName = path.basename(filePath);
      let dataType: 'rooms' | 'users' | 'items' | 'npcs' = 'items'; // Default
      
      // Determine data type based on file name
      if (fileName.includes('room')) {
        dataType = 'rooms';
      } else if (fileName.includes('user')) {
        dataType = 'users';
      } else if (fileName.includes('npc')) {
        dataType = 'npcs';
      }
      
      const result = validateJsonFile(filePath, dataType);
      printValidationResult(result);
      if (!result.valid) {
        allValid = false;
      }
    }
    
    if (allValid) {
      console.log('\x1b[32m✓ All specified files are valid!\x1b[0m'); // Green text
      process.exit(0);
    } else {
      console.log('\x1b[31m✗ Some files failed validation. See errors above.\x1b[0m'); // Red text
      process.exit(1);
    }
  }
}

// Execute main function when run directly
if (require.main === module) {
  main();
}

// Export for use in other modules
export { validateJsonFile, validateAllFiles };