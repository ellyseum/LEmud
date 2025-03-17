import { ConnectedClient } from '../types';
import { writeCommandPrompt } from './promptFormatter';

/**
 * Writes data to the client connection, buffering if the client is currently typing
 */
export function writeToClient(client: ConnectedClient, data: string): void {
  if (client.isTyping) {
    // Buffer the output
    client.outputBuffer.push(data);
  } else {
    // Direct write
    client.connection.write(data);
  }
}

/**
 * Writes data to client, erasing and restoring the command prompt if necessary
 * This is used for real-time messages like chat or system notifications
 */
export function writeMessageToClient(client: ConnectedClient, data: string): void {
  if (!client.authenticated || !client.user) {
    // For non-authenticated users, just use the standard method
    writeToClient(client, data);
    return;
  }

  if (client.isTyping) {
    // If typing, just buffer the output for later
    client.outputBuffer.push(data);
  } else {
    // Handle websocket and telnet connections differently
    if (client.connection.getType() === 'websocket') {
      // For WebSockets, we need more explicit handling
      client.connection.write('\r\n' + data); // Add an explicit newline before the message
      writeCommandPrompt(client);
    } else {
      // For telnet connections, use the standard approach
      if (client.state === 'authenticated') {
        // First move to the beginning of the line and clear it
        client.connection.write('\r');
        
        // Write the actual message
        client.connection.write(data);
        
        // Redraw the prompt
        writeCommandPrompt(client);
      } else {
        client.connection.write(data);
      }
    }
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
