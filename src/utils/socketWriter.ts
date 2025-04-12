import { ConnectedClient } from '../types';
import { drawCommandPrompt, getPromptText } from './promptFormatter';

// Write directly to the client without buffering
export function writeToClient(client: ConnectedClient, data: string): void {
  // Write directly to the connection
  client.connection.write(data);
  
  // If this client is being monitored, also send to the admin
  if (client.isBeingMonitored && client.adminMonitorSocket) {
    client.adminMonitorSocket.emit('monitor-output', { data });
  }
}

// Write message to client with proper handling of the prompt
export function writeMessageToClient(client: ConnectedClient, message: string): void {
  if (!client.user) {
    writeToClient(client, message);
    return;
  }
  
  // If user is actively typing (has something in buffer), buffer the output
  if (client.isTyping && client.buffer.length > 0) {
    // Add to output buffer
    client.outputBuffer.push(message);
    return;
  }
  
  // Improved combat message detection
  const isCombatMessage = 
    message.includes('Combat') || 
    message.includes('combat') ||
    message.includes('swing') || 
    message.includes('hit') || 
    message.includes('attacks') ||
    message.includes('miss') ||
    message.includes('damage') ||
    message.includes('lunges') ||
    message.includes('swipes') ||
    message.includes('hisses') ||
    message.includes('dies') ||
    message.includes('sad meow') ||
    message.includes('moves to attack');
  
  // Always clear the line for combat messages
  if (isCombatMessage || client.user.inCombat) {
    const clearLineSequence = '\r\x1B[K';
    writeToClient(client, clearLineSequence);
  }
  
  // Write the actual message
  writeToClient(client, message);
  
  // For combat messages or if in combat, always redraw the prompt
  if (isCombatMessage || client.user.inCombat) {
    // Use our new utility function to draw the prompt
    drawCommandPrompt(client);
  }
}

// Function to stop buffering and flush any buffered output
export function stopBuffering(client: ConnectedClient): void {
  // Only proceed if client is buffering
  if (!client.isTyping || client.outputBuffer.length === 0) {
    client.isTyping = false;
    return;
  }
  
  // Process all buffered messages
  for (const message of client.outputBuffer) {
    writeToClient(client, message);
  }
  
  // Clear the buffer
  client.outputBuffer = [];
  
  // Reset isTyping flag
  client.isTyping = false;
  
  // Always draw prompt if user is authenticated
  if (client.user) {
    drawCommandPrompt(client);
  }
}

/**
 * Writes a formatted message to the client with proper prompt handling
 * Ensures the line is cleared first, then adds the message, then redraws the prompt
 * @param client The connected client to write to
 * @param message The message to send
 * @param drawPrompt Whether to redraw the prompt after writing the message (default: true)
 */
export function writeFormattedMessageToClient(
  client: ConnectedClient, 
  message: string,
  drawPrompt: boolean = true
): void {
  // For users who are not authenticated, use simple writeToClient
  if (!client.authenticated || !client.user) {
    writeToClient(client, message);
    return;
  }
  
  // If user is actively typing (has something in buffer), buffer the output
  if (client.isTyping && client.buffer.length > 0) {
    // Add to output buffer
    client.outputBuffer.push(message);
    return;
  }
  
  // First clear the current line
  client.connection.write('\r\x1B[K');
  
  // Write the message
  client.connection.write(message);
  
  // Only draw the prompt if requested
  if (drawPrompt) {
    // Use our utility function to draw the prompt
    drawCommandPrompt(client);
  }
}

// Re-export our prompt functions to make them available to importers
export { writeCommandPrompt, drawCommandPrompt, getPromptText } from './promptFormatter';
