import { Socket } from 'net';
import { EventEmitter } from 'events';
import { IConnection } from './interfaces/connection.interface';

export class TelnetConnection extends EventEmitter implements IConnection {
  private socket: Socket;
  private id: string;
  private maskInput: boolean = false;

  constructor(socket: Socket) {
    super();
    this.socket = socket;
    this.id = `telnet-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    this.setupListeners();
  }

  private setupListeners(): void {
    // Forward data events from the socket
    this.socket.on('data', (data) => {
      this.emit('data', data.toString());
    });

    // Forward end events
    this.socket.on('end', () => {
      this.emit('end');
    });

    // Forward error events
    this.socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  public write(data: string): void {
    if (this.socket.writable) {
      this.socket.write(data);
    }
  }

  public end(): void {
    this.socket.end();
  }

  public getId(): string {
    return this.id;
  }

  public getType(): string {
    return 'telnet';
  }

  public setMaskInput(mask: boolean): void {
    this.maskInput = mask;
  }

  public getRawConnection(): Socket {
    return this.socket;
  }

  // Expose the remote address
  get remoteAddress(): string {
    return this.socket.remoteAddress || 'unknown';
  }
}
