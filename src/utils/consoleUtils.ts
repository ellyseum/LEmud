// filepath: /Users/jelden/projects/game/src/utils/consoleUtils.ts

import readline from 'readline';

/**
 * Read a password from the console with character masking
 * @param prompt The prompt to display to the user
 * @returns A promise that resolves to the password entered
 */
export function readPasswordFromConsole(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    // Save the current settings
    const originalStdinIsTTY = stdin.isTTY;
    const originalRawMode = originalStdinIsTTY ? stdin.isRaw : false;
    
    // Define the proper type for data listeners
    type DataListener = (chunk: Buffer) => void;
    
    // Store and remove existing listeners to prevent interference
    const existingListeners = stdin.listeners('data').slice() as DataListener[];
    stdin.removeAllListeners('data');
    
    // Write the prompt first
    stdout.write(prompt);
    
    let password = '';
    
    // Create a raw mode handler function
    const onData = (key: Buffer) => {
      const keyStr = key.toString();
      
      // Handle Ctrl+C
      if (keyStr === '\u0003') {
        stdout.write('\n');
        if (originalStdinIsTTY) {
          stdin.setRawMode(false);
        }
        stdin.removeListener('data', onData);
        
        // Restore original listeners
        restoreConsoleState();
        
        process.exit(1);
      }
      
      // Handle Enter key
      if (keyStr === '\r' || keyStr === '\n') {
        stdout.write('\n');
        if (originalStdinIsTTY) {
          stdin.setRawMode(false);
        }
        stdin.removeListener('data', onData);
        
        // Restore original listeners
        restoreConsoleState();
        
        resolve(password);
        return;
      }
      
      // Handle backspace
      if (keyStr === '\b' || keyStr === '\x7F') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b'); // erase the last character
        }
        return;
      }
      
      // Ignore non-printable characters
      if (keyStr.length === 1 && keyStr.charCodeAt(0) >= 32 && keyStr.charCodeAt(0) <= 126) {
        // Add to password and show asterisk
        password += keyStr;
        stdout.write('*');
      }
    };
    
    // Function to restore console state
    const restoreConsoleState = () => {
      // Delay restoration to ensure it doesn't interfere with the current operation
      process.nextTick(() => {
        if (originalStdinIsTTY) {
          stdin.setRawMode(originalRawMode);
        }
        // Re-attach the original listeners
        existingListeners.forEach(listener => stdin.on('data', listener));
      });
    };
    
    // Enable raw mode to prevent terminal echo
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }
    
    // Listen for keypress events
    stdin.on('data', onData);
  });
}