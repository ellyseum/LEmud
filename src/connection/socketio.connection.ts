import { Socket } from 'socket.io';
import { EventEmitter } from 'events';
import { IConnection } from './interfaces/connection.interface';

export class SocketIOConnection extends EventEmitter implements IConnection {
  private socket: Socket;
  private id: string;
  private maskInput: boolean = false;

  constructor(socket: Socket) {
    super();
    this.socket = socket;
    this.id = socket.id;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Handle keypress events from the client
    this.socket.on('keypress', (data) => {
      this.emit('data', data);
    });

    // Handle special key events
    this.socket.on('special', (data) => {
      // For arrow keys and other special inputs
      if (data.key === 'up') {
        this.emit('data', '\u001b[A');
      } else if (data.key === 'down') {
        this.emit('data', '\u001b[B');
      } else if (data.key === 'left') {
        this.emit('data', '\u001b[D');
      } else if (data.key === 'right') {
        this.emit('data', '\u001b[C');
      }
    });

    // Handle disconnect
    this.socket.on('disconnect', () => {
      this.emit('end');
    });

    // Handle errors
    this.socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private convertAnsiToHtml(text: string): string {
    // More comprehensive conversion of ANSI color codes to HTML
    let htmlData = text
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

    return htmlData;
  }

  public write(data: string): void {
    // Convert ANSI to HTML before sending to the client
    const htmlData = this.convertAnsiToHtml(data);
    this.socket.emit('output', { data: htmlData });
  }

  public end(): void {
    this.socket.disconnect();
  }

  public getId(): string {
    return this.id;
  }

  public getType(): string {
    return 'websocket';
  }

  public setMaskInput(mask: boolean): void {
    this.maskInput = mask;
    this.socket.emit('mask', { mask });
  }

  public getRawConnection(): Socket {
    return this.socket;
  }

  // Expose the remote address
  get remoteAddress(): string {
    return this.socket.handshake.address || 'unknown';
  }
}
