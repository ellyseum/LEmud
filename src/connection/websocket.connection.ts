import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { IConnection } from './interfaces/connection.interface';
import { getSessionLogger, closeSessionLogger } from '../utils/rawSessionLogger';

export class WebSocketConnection extends EventEmitter implements IConnection {
  private id: string;
  private maskInput: boolean = false;
  private buffer: string = '';
  private rawLoggingEnabled: boolean = true;
  private passwordMessageLogged: boolean = false;

  constructor(private ws: WebSocket, private clientId: string) {
    super();
    this.id = `ws:${clientId}`;
    
    // Set up event listeners
    ws.on('message', (message: WebSocket.Data) => this.handleMessage(message));
    ws.on('close', () => {
      if (this.rawLoggingEnabled) {
        closeSessionLogger(this.id);
      }
      this.emit('end');
    });
    ws.on('error', (err: Error) => {
      if (this.rawLoggingEnabled) {
        const logger = getSessionLogger(this.id);
        logger.logOutput(`[ERROR] ${err.message}`);
      }
      this.emit('error', err);
    });
  }

  write(data: string): void {
    // Log output if raw logging is enabled
    if (this.rawLoggingEnabled) {
      const logger = getSessionLogger(this.id);
      logger.logOutput(data);
    }
    
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
    if (this.rawLoggingEnabled) {
      closeSessionLogger(this.id);
    }
    this.ws.close();
  }

  getId(): string {
    return this.id;
  }

  getType(): string {
    return 'websocket';
  }

  setMaskInput(mask: boolean): void {
    // If we're turning masking on (entering password mode)
    if (mask && !this.maskInput) {
      this.maskInput = true;
      this.passwordMessageLogged = false;
    } 
    // If we're turning masking off (exiting password mode)
    else if (!mask && this.maskInput) {
      this.maskInput = false;
      
      // Log that password entry is complete
      if (this.rawLoggingEnabled) {
        const logger = getSessionLogger(this.id);
        logger.logInput('[PASSWORD INPUT COMPLETE]');
      }
    }
    
    // Inform client about masking state
    this.ws.send(JSON.stringify({ type: 'mask', mask }));
  }

  getRawConnection(): WebSocket {
    return this.ws;
  }

  // Enable or disable raw session logging
  public enableRawLogging(enabled: boolean): void {
    this.rawLoggingEnabled = enabled;
  }

  // Check if raw logging is enabled
  public isRawLoggingEnabled(): boolean {
    return this.rawLoggingEnabled;
  }

  // Add remote address getter
  get remoteAddress(): string {
    // Extract client IP address from WebSocket
    const ip = (this.ws as any)._socket?.remoteAddress || 'unknown';
    return ip;
  }

  private handleMessage(message: WebSocket.Data): void {
    try {
      // Parse incoming JSON messages
      const data = JSON.parse(message.toString());
      
      if (data.type === 'input') {
        // Handle full input lines
        if (this.rawLoggingEnabled && !this.maskInput) {
          // Only log if not in password mode
          const logger = getSessionLogger(this.id);
          logger.logInput(data.text);
        }
        // For password input, log a single message
        else if (this.rawLoggingEnabled && this.maskInput && !this.passwordMessageLogged) {
          const logger = getSessionLogger(this.id);
          logger.logInput('[PASSWORD INPUT MASKED]');
          this.passwordMessageLogged = true;
        }
        
        this.emit('data', data.text);
      } 
      else if (data.type === 'keypress') {
        // Handle individual keypresses
        if (this.rawLoggingEnabled && !this.maskInput) {
          // Only log if not in password mode
          const logger = getSessionLogger(this.id);
          logger.logInput(data.key);
        }
        // For password input, log a single message
        else if (this.rawLoggingEnabled && this.maskInput && !this.passwordMessageLogged) {
          const logger = getSessionLogger(this.id);
          logger.logInput('[PASSWORD INPUT MASKED]');
          this.passwordMessageLogged = true;
        }
        
        this.emit('data', data.key);
      }
      else if (data.type === 'special') {
        // Skip logging special keys during password entry
        if (this.rawLoggingEnabled && !this.maskInput) {
          const logger = getSessionLogger(this.id);
          logger.logInput(`[SPECIAL:${data.key}]`);
        }
        
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
      if (this.rawLoggingEnabled && !this.maskInput) {
        const logger = getSessionLogger(this.id);
        logger.logInput(message.toString());
      }
      // For password input, log a single message
      else if (this.rawLoggingEnabled && this.maskInput && !this.passwordMessageLogged) {
        const logger = getSessionLogger(this.id);
        logger.logInput('[PASSWORD INPUT MASKED]');
        this.passwordMessageLogged = true;
      }
      
      this.emit('data', message.toString());
    }
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
}
