import { EventEmitter } from 'events';
import { Socket } from 'socket.io';
import { IConnection } from './interfaces/connection.interface';

export class SocketIOConnection extends EventEmitter implements IConnection {
  private id: string;
  private maskInput: boolean = false;

  constructor(private socket: Socket) {
    super();
    this.id = `socketio:${socket.id}`;
    
    // Set up event listeners
    socket.on('input', (data: string) => this.emit('data', data));
    socket.on('keypress', (data: string) => this.emit('data', data));
    socket.on('special', (data: { key: string }) => this.emit('data', data.key));
    socket.on('disconnect', () => this.emit('end'));
    socket.on('error', (err: Error) => this.emit('error', err));
  }

  write(data: string): void {
    // Convert ANSI color codes to HTML for web clients
    const htmlData = this.convertAnsiToHtml(data);
    
    // Single character or special sequences (echo)
    if (data.length === 1 || data === '\b \b' || data === '\r\n') {
      this.socket.emit('echo', { char: data });
    } else {
      // Full output
      this.socket.emit('output', { 
        data: htmlData,
        mask: this.maskInput 
      });
    }
  }

  end(): void {
    this.socket.disconnect();
  }

  getId(): string {
    return this.id;
  }

  getType(): 'telnet' | 'websocket' {
    return 'websocket'; // We use the same type for backward compatibility
  }

  setMaskInput(mask: boolean): void {
    this.maskInput = mask;
    this.socket.emit('mask', { mask });
  }

  getRawConnection(): Socket {
    return this.socket;
  }

  private convertAnsiToHtml(text: string): string {
    // More comprehensive conversion of ANSI color codes to HTML
    return text
      .replace(/\r\n/g, '<br>')
      .replace(/\n/g, '<br>')
      .replace(/\r/g, '<br>') // Make sure standalone \r is also handled
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
