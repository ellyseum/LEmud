/**
 * Utility functions for formatting messages in decorative boxes
 */

/**
 * Creates a 3D boxed message for admin messages with magenta border
 * @param message The message to be displayed in the box
 * @returns Formatted string with ANSI colors and box drawing characters
 */
export function createAdminMessageBox(message: string): string {
  // Create an array of lines from the message, breaking at proper word boundaries
  const lines = [];
  const words = message.split(' ');
  let currentLine = '';
  
  // Max length for each line inside the box (adjust for box padding)
  const maxLineLength = 50;
  
  for (const word of words) {
    // Check if adding this word would exceed the max line length
    if ((currentLine + ' ' + word).length <= maxLineLength) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      // Add the current line to our lines array and start a new line
      lines.push(currentLine);
      currentLine = word;
    }
  }
  
  // Don't forget to add the last line
  if (currentLine) {
    lines.push(currentLine);
  }
  
  // ANSI color for a bright magenta
  const color = '\x1b[95m';
  const reset = '\x1b[0m';
  
  // Unicode box drawing characters for a 3D effect
  const topLeft = '╔';
  const topRight = '╗';
  const bottomLeft = '╚';
  const bottomRight = '╝';
  const horizontal = '═';
  const vertical = '║';
  
  // Calculate box width based on the longest line
  const boxWidth = Math.max(...lines.map(line => line.length), 'MESSAGE FROM ADMIN:'.length) + 4; // Add padding
  
  // Build the box
  let result = '\r\n'; // Start with a new line
  
  // Top border with 3D effect
  result += color + topLeft + horizontal.repeat(boxWidth - 2) + topRight + reset + '\r\n';
  
  // Add the "MESSAGE FROM ADMIN:" header
  result += color + vertical + reset + ' ' + color + 'MESSAGE FROM ADMIN:' + reset + ' '.repeat(boxWidth - 'MESSAGE FROM ADMIN:'.length - 3) + color + vertical + reset + '\r\n';
  
  // Add a separator line
  result += color + vertical + reset + ' ' + horizontal.repeat(boxWidth - 4) + ' ' + color + vertical + reset + '\r\n';
  
  // Content lines
  for (const line of lines) {
    const padding = ' '.repeat(boxWidth - line.length - 4);
    result += color + vertical + reset + ' ' + line + padding + ' ' + color + vertical + reset + '\r\n';
  }
  
  // Bottom border with 3D effect
  result += color + bottomLeft + horizontal.repeat(boxWidth - 2) + bottomRight + reset + '\r\n';
  
  return result;
}

/**
 * Creates a 3D boxed message for system messages with cyan border
 * @param message The message to be displayed in the box
 * @returns Formatted string with ANSI colors and box drawing characters
 */
export function createSystemMessageBox(message: string): string {
  // Create an array of lines from the message, breaking at proper word boundaries
  const lines = [];
  const words = message.split(' ');
  let currentLine = '';
  
  // Max length for each line inside the box (adjust for box padding)
  const maxLineLength = 50;
  
  for (const word of words) {
    // Check if adding this word would exceed the max line length
    if ((currentLine + ' ' + word).length <= maxLineLength) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      // Add the current line to our lines array and start a new line
      lines.push(currentLine);
      currentLine = word;
    }
  }
  
  // Don't forget to add the last line
  if (currentLine) {
    lines.push(currentLine);
  }
  
  // ANSI color for a bright cyan
  const color = '\x1b[96m';
  const reset = '\x1b[0m';
  
  // Unicode box drawing characters for a 3D effect
  const topLeft = '╔';
  const topRight = '╗';
  const bottomLeft = '╚';
  const bottomRight = '╝';
  const horizontal = '═';
  const vertical = '║';
  
  // Calculate box width based on the longest line
  const boxWidth = Math.max(...lines.map(line => line.length), 'SYSTEM MESSAGE:'.length) + 4; // Add padding
  
  // Build the box
  let result = '\r\n'; // Start with a new line
  
  // Top border with 3D effect
  result += color + topLeft + horizontal.repeat(boxWidth - 2) + topRight + reset + '\r\n';
  
  // Add the "SYSTEM MESSAGE:" header
  result += color + vertical + reset + ' ' + color + 'SYSTEM MESSAGE:' + reset + ' '.repeat(boxWidth - 'SYSTEM MESSAGE:'.length - 3) + color + vertical + reset + '\r\n';
  
  // Add a separator line
  result += color + vertical + reset + ' ' + horizontal.repeat(boxWidth - 4) + ' ' + color + vertical + reset + '\r\n';
  
  // Content lines
  for (const line of lines) {
    const padding = ' '.repeat(boxWidth - line.length - 4);
    result += color + vertical + reset + ' ' + line + padding + ' ' + color + vertical + reset + '\r\n';
  }
  
  // Bottom border with 3D effect
  result += color + bottomLeft + horizontal.repeat(boxWidth - 2) + bottomRight + reset + '\r\n';
  
  return result;
}