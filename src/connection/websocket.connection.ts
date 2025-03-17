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
    
    // Check if this is a single character (echo)
    if (data.length === 1 || data === '\b \b' || data === '\r\n') {
      // Send as echo for character-by-character display
      this.ws.send(JSON.stringify({
        type: 'echo',
        char: data
      }));
    } else {
      // Send as normal output
      this.ws.send(JSON.stringify({
        type: 'output',
        data: htmlData,
        mask: this.maskInput
      }));
    }
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
        // Handle full input lines (backward compatibility)
        this.emit('data', data.text);
      } 
      else if (data.type === 'keypress') {
        // Handle individual keypresses
        this.emit('data', data.key);
      }
      else if (data.type === 'special') {
        // Handle special keys
        switch(data.key) {
          case '\r\n':
            this.emit('data', '\r\n');
            break;
          case '\b':
            this.emit('data', '\b');
            break;
          case '\t':
            this.emit('data', '\t');
            break;
          default:
            // Other special keys can be handled as needed
            break;
        }
      }
      else if (data.type === 'history') {
        // Don't send history navigation events to the server
        // They're handled client-side
      }
    } catch (e) {
      // If not JSON, treat as plain text input
      this.emit('data', message.toString());
    }
  }

  private convertAnsiToHtml(text: string): string {
    // More comprehensive conversion of ANSI color codes to HTML
    return text
      .replace(/\r\n/g, '<br>')
      .replace(/\n/g, '<br>')
      .replace(/\x1b\[0m/g, '</span>')
      .replace(/\x1b\[1m/g, '<span class="bright">')
      .replace(/\x1b\[2m/g, '<span class="dim">')
      .replace(/\x1b\[4m/g, '<span class="underline">')
      .replace(/\x1b\[5m/g, '<span class="blink">')
      .replace(/\x1b\[31m/g, '<span class="red">')
      .replace(/\x1b\[32m/g, '<span class="green">')
      .replace(/\x1b\[33m/g, '<span class="yellow">')
      .replace(/\x1b\[34m/g, '<span class="blue">')
      .replace(/\x1b\[35m/g, '<span class="magenta">')
      .replace(/\x1b\[36m/g, '<span class="cyan">')
      .replace(/\x1b\[37m/g, '<span class="white">')
      // Handle the clear screen command
      .replace(/\x1b\[2J\x1b\[0;0H/g, '<!-- clear -->');
  }
}
