import { ConnectedClient } from '../types';

/**
 * Writes data to the client socket, buffering if the client is currently typing
 */
export function writeToClient(client: ConnectedClient, data: string): void {
  if (client.isTyping) {
    // Buffer the output
    client.outputBuffer.push(data);
  } else {
    // Direct write
    client.socket.write(data);
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
    client.socket.write(output);
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
