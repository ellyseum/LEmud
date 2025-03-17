import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { IConnection } from './interfaces/connection.interface';

export class WebSocketConnection extends EventEmitter implements IConnection {
  private id: string;
  private maskInput: boolean = false;
  private buffer: string = '';

  constructor(private ws: WebSocket, private clientId: string) {
    super();
    this.id = `ws:${clientId}`;
    
    // Set up event listeners
    ws.on('message', (message: WebSocket.Data) => this.handleMessage(message));
    ws.on('close', () => this.emit('end'));
    ws.on('error', (err: Error) => this.emit('error', err));
  }

  write(data: string): void {
    // Convert ANSI color codes to HTML for WebSocket clients
    const htmlData = this.convertAnsiToHtml(data);
    
    // Send as JSON to enable client to distinguish between types of messages
    this.ws.send(JSON.stringify({
      type: 'output',
      data: htmlData,
      mask: this.maskInput
    }));
  }

  end(): void {
    this.ws.close();
  }

  getId(): string {
    return this.id;
  }

  getType(): 'telnet' | 'websocket' {
    return 'websocket';
  }

  setMaskInput(mask: boolean): void {
    this.maskInput = mask;
    
    // Inform client about masking state
    this.ws.send(JSON.stringify({ type: 'mask', mask }));
  }

  getRawConnection(): WebSocket {
    return this.ws;
  }

  private handleMessage(message: WebSocket.Data): void {
    try {
      // Parse incoming JSON messages
      const data = JSON.parse(message.toString());
      
      if (data.type === 'input') {
        // Forward the input data as if it were typed
        this.emit('data', data.text);
      }
    } catch (e) {
      // If not JSON, treat as plain text input
      this.emit('data', message.toString());
    }
  }

  private convertAnsiToHtml(text: string): string {
    // Basic conversion of ANSI color codes to HTML
    // In a real implementation, you would want a more complete conversion
    return text
      .replace(/\x1b\[0m/g, '</span>')
      .replace(/\x1b\[1m/g, '<span class="bright">')
      .replace(/\x1b\[31m/g, '<span class="red">')
      .replace(/\x1b\[32m/g, '<span class="green">')
      .replace(/\x1b\[33m/g, '<span class="yellow">')
      .replace(/\x1b\[34m/g, '<span class="blue">')
      .replace(/\x1b\[35m/g, '<span class="magenta">')
      .replace(/\x1b\[36m/g, '<span class="cyan">')
      .replace(/\r\n/g, '<br>');
  }
}
