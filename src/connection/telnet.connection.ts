import { Socket } from 'net';
import { EventEmitter } from 'events';
import { IConnection } from './interfaces/connection.interface';

// Telnet control codes
const IAC = 255;  // Interpret As Command
const WILL = 251;
const WONT = 252;
const DO = 253;
const DONT = 254;
const SB = 250;   // Subnegotiation Begin
const SE = 240;   // Subnegotiation End

// Telnet options
const ECHO = 1;
const SUPPRESS_GO_AHEAD = 3;
const TERMINAL_TYPE = 24;
const NAWS = 31;  // Negotiate About Window Size
const LINEMODE = 34;

export class TelnetConnection extends EventEmitter implements IConnection {
  private socket: Socket;
  private id: string;
  private maskInput: boolean = false;
  private negotiationsComplete: boolean = false;
  private buffer: Buffer = Buffer.alloc(0);
  private processingCommand: boolean = false;

  constructor(socket: Socket) {
    super();
    this.socket = socket;
    this.id = `telnet-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Start telnet negotiations immediately
    this.negotiateTelnetOptions();
    
    // Set up socket listeners
    this.setupListeners();
  }

  private setupListeners(): void {
    // Raw data handler
    this.socket.on('data', (data) => this.handleData(data));

    // Forward end events
    this.socket.on('end', () => {
      this.emit('end');
    });

    // Forward error events
    this.socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private negotiateTelnetOptions(): void {
    // Tell the client we will handle echo (disables client-side echo)
    this.sendCommand([IAC, WILL, ECHO]);
    
    // Disable linemode - we want character-at-a-time mode
    this.sendCommand([IAC, DONT, LINEMODE]);
    
    // Suppress GA to enable character-at-a-time processing
    this.sendCommand([IAC, WILL, SUPPRESS_GO_AHEAD]);
    this.sendCommand([IAC, DO, SUPPRESS_GO_AHEAD]);
    
    // Request terminal type for better compatibility
    this.sendCommand([IAC, DO, TERMINAL_TYPE]);
    
    // Request window size
    this.sendCommand([IAC, DO, NAWS]);

    // Send extra negotiation to ensure correct mode
    this.sendCommand([IAC, SB, LINEMODE, 1, 0, IAC, SE]);

    // Mark negotiations as complete (we don't wait for client responses)
    this.negotiationsComplete = true;
  }

  private sendCommand(bytes: number[]): void {
    if (this.socket.writable) {
      this.socket.write(Buffer.from(bytes));
    }
  }

  private handleData(data: Buffer): void {
    // Process telnet commands and escape sequences
    let i = 0;
    let processedData = '';
    
    // Debug - uncomment to see what's being received
    // console.log('Raw data:', Array.from(data).map(b => b.toString(16)).join(' '));
    
    while (i < data.length) {
      // Check for IAC (Interpret As Command)
      if (data[i] === IAC) {
        // Debug telnet commands
        // console.log('TELNET CMD:', data[i], data[i+1], data[i+2]);
        
        // Skip the telnet command sequence (at least IAC + command code)
        i += 2;
        // If it's a subnegotiation, skip until the end (IAC SE)
        if (i < data.length && data[i-1] === SB) {
          while (i < data.length && !(data[i-1] === IAC && data[i] === SE)) {
            i++;
          }
          i++;
        }
        continue;
      }
      
      // Handle ASCII control characters
      if (data[i] < 32) {
        // Special handling for common control chars
        if (data[i] === 8 || data[i] === 127) {  // Backspace or Delete
          processedData += '\b';
        } else if (data[i] === 13) {  // Carriage Return
          processedData += '\r';
          // Skip LF if it follows CR (CRLF sequence)
          if (i + 1 < data.length && data[i + 1] === 10) {
            i++;
          }
        } else if (data[i] === 10) {  // Line Feed
          processedData += '\n';
        } else if (data[i] === 27) {  // Escape (start of escape sequence)
          // Handle common arrow key sequences
          if (i + 2 < data.length && data[i+1] === 91) {
            if (data[i+2] === 65) {  // Up arrow
              processedData += '\u001b[A';
              i += 2;
            } else if (data[i+2] === 66) {  // Down arrow
              processedData += '\u001b[B';
              i += 2;
            }
          }
        }
      } else {
        // Normal character
        processedData += String.fromCharCode(data[i]);
      }
      i++;
    }
    
    // If we have processed data, emit it
    if (processedData.length > 0) {
      this.emit('data', processedData);
    }
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
