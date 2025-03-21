import { ConnectedClient } from '../types';
import { colorize } from './colors';
import { writeToClient } from './socketWriter';

// Define valid color types to match what colorize accepts
type ColorType = 'blink' | 'reset' | 'bright' | 'dim' | 'underscore' | 'reverse' | 'hidden' |
                'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white' |
                'boldBlack' | 'boldRed' | 'boldGreen' | 'boldYellow' | 'boldBlue' |
                'boldMagenta' | 'boldCyan' | 'boldWhite' | 'clear';

/**
 * Writes a command prompt to the client based on their stats
 */
export function writeCommandPrompt(client: ConnectedClient): void {
  if (!client.user) return;
  
  const promptText = getPromptText(client);
  writeToClient(client, promptText);
}

/**
 * Returns the command prompt text (without writing to client)
 */
export function getPromptText(client: ConnectedClient): string {
  if (!client.user) return '';
  
  // Reset any previous color formatting
  const ANSI_RESET = '\x1b[0m';
  
  // Format the HP numbers in green
  const hpNumbers = colorize(`${client.user.health}/${client.user.maxHealth}`, 'green');
  
  // Build the prompt with white base color and green HP numbers
  let prompt = colorize(`[HP=`, 'white') + 
               hpNumbers + 
               colorize(`]`, 'white');
  
  // Add combat indicator if in combat
  if (client.user.inCombat) {
    prompt += colorize(' [COMBAT]', 'boldYellow');
  }
  
  prompt += colorize(': ', 'white');
  
  // Write the prompt with a reset first to ensure clean formatting
  return ANSI_RESET + prompt;
}
