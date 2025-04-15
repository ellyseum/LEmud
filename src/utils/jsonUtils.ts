import { systemLogger } from './logger';
import { 
  validateRooms, 
  validateUsers, 
  validateItems,
  validateItemInstances,
  validateNpcs
} from '../schemas';

/**
 * Error class for JSON validation errors
 */
export class JsonValidationError extends Error {
  constructor(message: string, public errors?: any[]) {
    super(message);
    this.name = 'JsonValidationError';
  }
}

/**
 * Parse and validate JSON input based on its data type
 * 
 * @param jsonString The JSON string to parse and validate
 * @param dataType The type of data to validate ('rooms', 'users', 'items', 'npcs')
 * @returns The parsed and validated data or undefined if validation fails
 */
export function parseAndValidateJson<T>(
  jsonString: string | null | undefined, 
  dataType: 'rooms' | 'users' | 'items' | 'npcs'
): T | undefined {
  if (!jsonString) {
    return undefined;
  }
  
  try {
    // Parse the JSON string
    const data = JSON.parse(jsonString);
    
    // Select the appropriate validator based on data type
    let isValid = false;
    let validator: any;
    
    switch (dataType) {
      case 'rooms':
        isValid = validateRooms(data);
        validator = validateRooms;
        break;
      case 'users':
        isValid = validateUsers(data);
        validator = validateUsers;
        break;
      case 'items':
        // Check if this might be item instances instead of regular items
        if (data.length > 0 && data[0].instanceId) {
          isValid = validateItemInstances(data);
          validator = validateItemInstances;
        } else {
          isValid = validateItems(data);
          validator = validateItems;
        }
        break;
      case 'npcs':
        isValid = validateNpcs(data);
        validator = validateNpcs;
        break;
    }
    
    if (!isValid) {
      systemLogger.error(`Invalid ${dataType} data structure`);
      if (validator.errors) {
        validator.errors.forEach((err: any) => {
          systemLogger.error(`- ${err.instancePath} ${err.message}`);
        });
      }
      return undefined;
    }
    
    // Additional business logic validation
    try {
      validateBusinessRules(data, dataType);
    } catch (error) {
      if (error instanceof JsonValidationError) {
        systemLogger.error(`Business rule validation error: ${error.message}`);
        if (error.errors) {
          error.errors.forEach((err: any) => {
            systemLogger.error(`- ${err.instancePath} ${err.message}`);
          });
        }
      } else {
        systemLogger.error(`Business rule validation error: ${error instanceof Error ? error.message : String(error)}`);
      }
      return undefined;
    }
    
    return data as T;
  } catch (error) {
    if (error instanceof JsonValidationError) {
      systemLogger.error(`JSON validation error: ${error.message}`);
      if (error.errors) {
        error.errors.forEach((err: any) => {
          systemLogger.error(`- ${err.instancePath} ${err.message}`);
        });
      }
    } else if (error instanceof SyntaxError) {
      systemLogger.error(`JSON parse error: ${error.message}`);
    } else {
      systemLogger.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }
}

/**
 * Additional business rule validations beyond schema validation
 */
function validateBusinessRules(data: any, dataType: string): void {
  switch (dataType) {
    case 'rooms':
      validateRoomBusinessRules(data);
      break;
    case 'users':
      validateUserBusinessRules(data);
      break;
    case 'items':
      // Detect if these are item instances or regular items
      if (data.length > 0 && data[0].instanceId) {
        validateItemInstanceBusinessRules(data);
      } else {
        validateItemBusinessRules(data);
      }
      break;
    case 'npcs':
      validateNpcBusinessRules(data);
      break;
  }
}

/**
 * Validate room-specific business rules
 */
function validateRoomBusinessRules(rooms: any[]): void {
  // Check for duplicate room IDs
  const roomIds = new Set<string>();
  rooms.forEach((room, index) => {
    if (roomIds.has(room.id)) {
      throw new JsonValidationError(`Duplicate room ID: ${room.id} at index ${index}`);
    }
    roomIds.add(room.id);
    
    // Check that exit targets exist if exits is an array (current format)
    if (Array.isArray(room.exits)) {
      room.exits.forEach((exit: any, exitIndex: number) => {
        // Skip validation if roomId is not a string (could be an object or something else)
        if (typeof exit.roomId === 'string' && !rooms.some(r => r.id === exit.roomId)) {
          throw new JsonValidationError(
            `Room ${room.id} has exit to non-existent room ID: ${exit.roomId} at exit index ${exitIndex}`
          );
        }
      });
    } 
    // Also handle exits as an object (alternative format)
    else if (room.exits && typeof room.exits === 'object') {
      Object.entries(room.exits).forEach(([direction, targetId]) => {
        // Skip validation if targetId is not a string
        if (typeof targetId === 'string' && !rooms.some(r => r.id === targetId)) {
          throw new JsonValidationError(
            `Room ${room.id} has exit to non-existent room ID: ${targetId} in direction ${direction}`
          );
        }
      });
    }
  });
}

/**
 * Validate user-specific business rules
 */
function validateUserBusinessRules(users: any[]): void {
  // Check for duplicate usernames
  const usernames = new Set<string>();
  users.forEach((user, index) => {
    if (usernames.has(user.username.toLowerCase())) {
      throw new JsonValidationError(`Duplicate username: ${user.username} at index ${index}`);
    }
    usernames.add(user.username.toLowerCase());
  });
}

/**
 * Validate item-specific business rules
 */
function validateItemBusinessRules(items: any[]): void {
  // Check for duplicate item IDs
  const itemIds = new Set<string>();
  items.forEach((item, index) => {
    if (item.id && itemIds.has(item.id)) {
      throw new JsonValidationError(`Duplicate item ID: ${item.id} at index ${index}`);
    }
    if (item.id) {
      itemIds.add(item.id);
    }
  });
}

/**
 * Validate item instance-specific business rules
 */
function validateItemInstanceBusinessRules(instances: any[]): void {
  // Check for duplicate instance IDs
  const instanceIds = new Set<string>();
  instances.forEach((instance, index) => {
    if (instance.instanceId && instanceIds.has(instance.instanceId)) {
      throw new JsonValidationError(`Duplicate item instance ID: ${instance.instanceId} at index ${index}`);
    }
    if (instance.instanceId) {
      instanceIds.add(instance.instanceId);
    }
  });
}

/**
 * Validate NPC-specific business rules
 */
function validateNpcBusinessRules(npcs: any[]): void {
  // Check for duplicate NPC IDs
  const npcIds = new Set<string>();
  npcs.forEach((npc, index) => {
    if (npcIds.has(npc.id)) {
      throw new JsonValidationError(`Duplicate NPC ID: ${npc.id} at index ${index}`);
    }
    npcIds.add(npc.id);
  });
}

/**
 * Simple JSON parsing without validation
 */
export function parseJsonArg<T>(jsonString: string | null | undefined, defaultValue?: T): T | undefined {
  if (!jsonString) {
    return defaultValue;
  }
  
  try {
    return JSON.parse(jsonString) as T;
  } catch (error) {
    systemLogger.error(`Error parsing JSON argument: ${error instanceof Error ? error.message : String(error)}`);
    systemLogger.error(`Problematic JSON string: ${jsonString.substring(0, 100)}${jsonString.length > 100 ? '...' : ''}`);
    return defaultValue;
  }
}

/**
 * Format validation errors to provide human-readable output
 */
export function formatValidationErrors(errors: any[]): string {
  return errors.map(error => {
    const path = error.instancePath || 'root';
    let message = `- ${path}: ${error.message}`;
    
    if (error.keyword === 'required') {
      message = `- ${path}: Missing required property: ${error.params.missingProperty}`;
    }
    else if (error.keyword === 'type') {
      message = `- ${path}: Expected ${error.params.type}, got ${typeof error.data}`;
    }
    else if (error.keyword === 'enum') {
      message = `- ${path}: Must be one of: ${error.params.allowedValues.join(', ')}`;
    }
    
    return message;
  }).join('\n');
}