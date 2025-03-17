/**
 * Formats a username to have its first letter capitalized
 */
export function formatUsername(username: string): string {
  if (!username || username.length === 0) return '';
  return username.charAt(0).toUpperCase() + username.slice(1);
}

/**
 * Standardizes a username to lowercase
 */
export function standardizeUsername(username: string): string {
  return username.toLowerCase();
}

/**
 * Validates a username according to the rules:
 * - Only alphabetic characters (a-z, A-Z)
 * - No special characters or whitespace
 * - Less than 13 characters long
 * 
 * @returns Object containing validation result and optional error message
 */
export function validateUsername(username: string): { isValid: boolean; message?: string } {
  if (!username || username.trim().length === 0) {
    return { isValid: false, message: 'Username cannot be empty' };
  }
  
  if (username.length >= 13) {
    return { isValid: false, message: 'Username must be less than 13 characters long' };
  }
  
  if (!/^[a-zA-Z]+$/.test(username)) {
    return { isValid: false, message: 'Username must contain only letters (a-z)' };
  }
  
  return { isValid: true };
}
