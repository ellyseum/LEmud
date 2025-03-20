import { ConnectedClient } from '../types';
import { writeCommandPrompt, getPromptText } from './promptFormatter';

/**
 * Writes data to the client connection, buffering if the client is currently typing
 */
export function writeToClient(client: ConnectedClient, data: string): void {
  // Always write to the actual client
  client.connection.write(data);
  
  // If this client is being monitored, also send to the admin
  if (client.isBeingMonitored && client.adminMonitorSocket) {
    client.adminMonitorSocket.emit('monitor-output', { data });
  }
}

/**
 * Writes data to client, erasing and restoring the command prompt if necessary
 * This is used for real-time messages like chat or system notifications
 */
export function writeMessageToClient(client: ConnectedClient, message: string): void {
  // If the client is currently typing (has a prompt displayed)
  if (client.isTyping && client.buffer.length > 0) {
    // Save current input
    const currentInput = client.buffer;
    const promptLength = getPromptText(client).length;
    
    // Clear the current line
    client.connection.write('\r' + ' '.repeat(promptLength + currentInput.length) + '\r');
    
    // Write the message
    writeToClient(client, message);
    
    // Restore the prompt and current input
    const promptText = getPromptText(client);
    writeToClient(client, promptText + currentInput);
    
    // Buffer the message for later if we're in a buffering state
    if (client.isTyping) {
      client.outputBuffer.push(message);
    }
  } else {
    // Just write the message directly
    writeToClient(client, message);
  }
}

/**
 * Buffers output to be sent later
 */
export function bufferOutput(client: ConnectedClient, data: string): void {
  client.outputBuffer.push(data);
}

/**
 * Flushes all buffered output to the client
 */
export function flushClientBuffer(client: ConnectedClient): void {
  if (client.outputBuffer.length > 0) {
    // Send all buffered messages
    const output = client.outputBuffer.join('');
    client.connection.write(output);
    client.outputBuffer = [];
  }
}

/**
 * Stops buffering and flushes all buffered output
 */
export function stopBuffering(client: ConnectedClient): void {
  client.isTyping = false;
  flushClientBuffer(client);
}
