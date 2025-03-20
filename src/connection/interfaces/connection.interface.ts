import { EventEmitter } from 'events';

export interface IConnection extends EventEmitter {
  // Core methods
  write(data: string): void;
  end(): void;
  
  // Connection information
  getId(): string;
  getType(): string;
  
  // Specific options for different connection types
  setMaskInput(mask: boolean): void;
  
  // Raw socket/connection access if needed by implementation
  getRawConnection(): any;
  remoteAddress?: string;
}

export interface ConnectionEvents {
  on(event: 'data', listener: (data: string) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  
  emit(event: 'data', data: string): boolean;
  emit(event: 'end'): boolean;
  emit(event: 'error', err: Error): boolean;
}
