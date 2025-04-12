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

  public write(data: string): void {
    // Now that we're using xterm.js, we can send raw ANSI codes directly
    // without converting to HTML - xterm.js will handle them natively
    this.socket.emit('output', { data });
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
