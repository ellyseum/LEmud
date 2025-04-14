/**
 * Event bus for combat system communication
 * Uses a publish-subscribe pattern to decouple components
 */
export class CombatEventBus {
  private listeners: Map<string, Function[]> = new Map();
  
  /**
   * Register a callback for a specific event
   */
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }
  
  /**
   * Emit an event with optional data
   */
  emit(event: string, data?: any): void {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach(callback => callback(data));
    }
  }
  
  /**
   * Remove a specific callback for an event
   */
  off(event: string, callback: Function): void {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)!;
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
      
      // Clean up if no more listeners
      if (callbacks.length === 0) {
        this.listeners.delete(event);
      }
    }
  }
  
  /**
   * Remove all listeners for an event
   */
  offAll(event: string): void {
    this.listeners.delete(event);
  }
  
  /**
   * Check if an event has listeners
   */
  hasListeners(event: string): boolean {
    return this.listeners.has(event) && this.listeners.get(event)!.length > 0;
  }
}