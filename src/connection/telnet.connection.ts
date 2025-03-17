import { EventEmitter } from 'events';
import { Socket } from 'net';
import { IConnection } from './interfaces/connection.interface';

export class TelnetConnection extends EventEmitter implements IConnection {
  private id: string;
  private maskInput: boolean = false;

  constructor(private socket: Socket) {
    super();
    this.id = `telnet:${socket.remoteAddress}:${socket.remotePort}`;
    
    // Forward socket events to connection interface
    socket.on('data', (data) => this.handleData(data));
    socket.on('end', () => this.emit('end'));
    socket.on('error', (err) => this.emit('error', err));
    
    // Configure proper TELNET options
    this.negotiateTelnetOptions();
  }

  write(data: string): void {
    this.socket.write(data);
  }

  end(): void {
    this.socket.end();
  }

  getId(): string {
    return this.id;
  }

  getType(): 'telnet' | 'websocket' {
    return 'telnet';
  }

  setMaskInput(mask: boolean): void {
    this.maskInput = mask;
  }

  getRawConnection(): Socket {
    return this.socket;
  }

  private negotiateTelnetOptions(): void {
    // Tell client we will handle echo
    this.sendTelnetCommand([255, 251, 1]);  // IAC WILL ECHO
    
    // Disable linemode - force character mode
    this.sendTelnetCommand([255, 254, 34]); // IAC DONT LINEMODE
    
    // Force character-at-a-time mode
    this.sendTelnetCommand([255, 250, 34, 1, 0, 255, 240]); // IAC SB LINEMODE MODE 0 IAC SE
    
    // Ask client to send us all keyboard input
    this.sendTelnetCommand([255, 253, 6]);  // IAC DO TIMING_MARK (helps flush the pipeline)
    this.sendTelnetCommand([255, 251, 3]);  // IAC WILL SUPPRESS_GO_AHEAD (allows us to process each character)
    this.sendTelnetCommand([255, 253, 3]);  // IAC DO SUPPRESS_GO_AHEAD (symmetrical)
  }

  private sendTelnetCommand(command: number[]): void {
    this.socket.write(Buffer.from(command));
  }

  private handleData(data: Buffer): void {
    // Process data byte by byte to handle special TELNET sequences and other operations
    let processedData = '';
    let i = 0;

    while (i < data.length) {
      const byte = data[i];
      
      // Skip TELNET command sequences
      if (byte === 255) { // IAC (Interpret As Command)
        // Skip command and its parameters (at least 2 more bytes)
        if (i + 2 < data.length) {
          i += 2;
        }
        i++;
        continue;
      }
      
      // Handle backspace (ASCII 8) or delete (ASCII 127) key
      if (byte === 8 || byte === 127) {
        processedData += '\b';
        i++;
        continue;
      }
      
      // Handle Enter key (CR or CR+LF)
      if (byte === 13) {
        processedData += '\r\n';
        
        // Skip LF if it follows CR
        if (i + 1 < data.length && data[i + 1] === 10) {
          i++;
        }
        i++;
        continue;
      }
      
      // Handle normal printable characters - DO NOT ECHO HERE
      // Echo is now handled in server.ts handleClientData function
      if (byte >= 32 && byte < 127) {
        const char = String.fromCharCode(byte);
        processedData += char;
      }
      
      i++;
    }
    
    // If we have processed data, emit it
    if (processedData.length > 0) {
      this.emit('data', processedData);
    }
  }
}
