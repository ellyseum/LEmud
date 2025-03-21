import { ConnectedClient } from '../types';
import { getPromptText } from './promptFormatter';

// Max message buffering delay - not currently used but kept for potential future use
// const MAX_OUTPUT_DELAY = 100;

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
  
  if (client.connection.getType() === 'telnet') {
    // Always clear the line for combat messages
    if (isCombatMessage || client.user.inCombat) {
      const clearLineSequence = '\r\x1B[K';
      writeToClient(client, clearLineSequence);
    }
    
    // Write the actual message
    writeToClient(client, message);
    
    // For combat messages or if in combat, always redraw the prompt
    if (isCombatMessage || client.user.inCombat) {
      // Redraw the prompt using our standard prompt formatter
      const promptText = getPromptText(client);
      writeToClient(client, promptText);
      
      // Redraw any partially typed command
      if (client.buffer.length > 0) {
        writeToClient(client, client.buffer);
      }
    }
  } else {
    // For websocket clients, just write the message
    writeToClient(client, message);
  }
}

// Function to stop buffering and flush any buffered output
export function stopBuffering(client: ConnectedClient): void {
  // Only proceed if client is buffering
  if (!client.isTyping || client.outputBuffer.length === 0) {
    client.isTyping = false;
    return;
  }
  
  // Clear current line first if telnet
  if (client.connection.getType() === 'telnet' && client.buffer.length > 0) {
    const clearLineSequence = '\r\x1B[K';
    writeToClient(client, clearLineSequence);
  }
  
  // Process all buffered messages
  for (const message of client.outputBuffer) {
    writeToClient(client, message);
  }
  
  // Clear the buffer
  client.outputBuffer = [];
  
  // Reset isTyping flag
  client.isTyping = false;
  
  // Redraw the prompt using our standard prompt formatter
  if (client.connection.getType() === 'telnet' && client.user) {
    const promptText = getPromptText(client);
    writeToClient(client, promptText);
    
    // Redraw any partially typed command
    if (client.buffer.length > 0) {
      writeToClient(client, client.buffer);
    }
  }
}

/**
 * Writes a formatted message to the client with proper prompt handling
 * Ensures the line is cleared first, then adds the message, then redraws the prompt
 * @param client The connected client to write to
 * @param message The message to send
 */
export function writeFormattedMessageToClient(client: ConnectedClient, message: string): void {
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
  
  // Always redraw the prompt using our standard prompt formatter
  const promptText = getPromptText(client);
  client.connection.write(promptText);
  
  // Redraw any partially typed command
  if (client.buffer.length > 0) {
    client.connection.write(client.buffer);
  }
}

// Re-export writeCommandPrompt to make it available to importers
export { writeCommandPrompt } from './promptFormatter';
