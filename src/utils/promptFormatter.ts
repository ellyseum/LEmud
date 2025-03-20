import { ConnectedClient } from '../types';
import { colorize } from './colors';
import { writeToClient } from './socketWriter';

/**
 * Writes a command prompt to the client based on their stats
 */
export function writeCommandPrompt(client: ConnectedClient): void {
  if (!client.user) return;
  
  const healthStr = getPromptText(client);
  writeToClient(client, healthStr);
}

/**
 * Returns the command prompt text (without writing to client)
 */
export function getPromptText(client: ConnectedClient): string {
  if (!client.user) return '';
  
  const health = client.user.health;
  const maxHealth = client.user.maxHealth;
  
  // Color the health portion based on health percentage
  let healthColor: 'red' | 'yellow' | 'green' = 'green';
  const healthPercentage = (health / maxHealth) * 100;
  
  if (healthPercentage < 30) healthColor = 'red';
  else if (healthPercentage < 70) healthColor = 'yellow';
  
  const healthDisplay = colorize(`${health}/${maxHealth}`, healthColor);
  // Remove the \r\n at the beginning to avoid extra blank lines
  return `[HP=${healthDisplay}]: `;
}
