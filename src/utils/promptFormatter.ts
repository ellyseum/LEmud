import { ConnectedClient } from '../types';
import { colorize } from './colors';
import { writeToClient } from './socketWriter';

/**
 * Generates a command prompt that includes the user's health status
 * and writes it to the client
 */
export function writeCommandPrompt(client: ConnectedClient): void {
  if (!client.user) return;
  
  const health = client.user.health;
  const maxHealth = client.user.maxHealth;
  
  // Color the health portion based on health percentage
  let healthColor: 'red' | 'yellow' | 'green' = 'green';
  const healthPercentage = (health / maxHealth) * 100;
  
  if (healthPercentage < 30) healthColor = 'red';
  else if (healthPercentage < 70) healthColor = 'yellow';
  
  const healthDisplay = colorize(`${health}/${maxHealth}`, healthColor);
  // Remove the \r\n at the beginning to avoid extra blank lines
  const prompt = `[HP=${healthDisplay}]: `;
  
  writeToClient(client, prompt);
}
