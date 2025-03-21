import { ConnectedClient } from '../types';
import { colorize, ColorType } from './colors';
import { writeToClient } from './socketWriter';

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

/**
 * Clears the current line and draws the command prompt
 * This function ensures that the prompt is properly displayed
 * without duplicates by always clearing the line first
 */
export function drawCommandPrompt(client: ConnectedClient): void {
  if (!client.user) return;
  
  // ANSI sequence to clear the current line
  const clearLineSequence = '\r\x1B[K';
  
  // Get the prompt text
  const promptText = getPromptText(client);
  
  // Write the clear line sequence followed by the prompt
  writeToClient(client, clearLineSequence + promptText);
  
  // Redraw any partially typed command
  if (client.buffer && client.buffer.length > 0) {
    writeToClient(client, client.buffer);
  }
}
