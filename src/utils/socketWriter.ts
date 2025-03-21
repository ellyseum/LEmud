import { ConnectedClient } from '../types';
import { getPromptText } from './promptFormatter';

// Max delay between messages when buffering
const MAX_OUTPUT_DELAY = 100;

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
  
  // Special case for combat engagement message to prevent double prompt
  if (message.includes('*Combat Engaged*')) {
    // For combat engagement, just write the message - the prompt has already been cleared
    writeToClient(client, message);
    
    // Write the prompt again
    const promptText = getPromptText(client);
    writeToClient(client, promptText);
    return;
  }
  
  // Check if this is combat-related message
  const isCombatMessage = 
    message.includes('swing') || 
    message.includes('hit') || 
    message.includes('attacks') ||
    message.includes('miss') ||
    message.includes('Combat') ||
    message.includes('combat') ||
    message.includes('moves to attack');
  
  if (client.connection.getType() === 'telnet') {
    // First, clear the current line for all combat-related messages regardless of combat status
    // This ensures no prompt doubling or line issues
    if (isCombatMessage) {
      const clearLineSequence = '\r\x1B[K';
      writeToClient(client, clearLineSequence);
    }
    
    // Write the actual message
    writeToClient(client, message);
    
    // For combat messages, we always need to redraw the prompt
    if (isCombatMessage) {
      // Redraw the prompt
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
  
  // Redraw the prompt
  if (client.connection.getType() === 'telnet' && client.user) {
    const promptText = getPromptText(client);
    writeToClient(client, promptText);
    
    // Redraw any partially typed command
    if (client.buffer.length > 0) {
      writeToClient(client, client.buffer);
    }
  }
}
