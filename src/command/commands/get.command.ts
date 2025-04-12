import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { PickupCommand } from './pickup.command';
import { UserManager } from '../../user/userManager';

/**
 * This is an explicit alias for the PickupCommand
 */
export class GetCommand implements Command {
  name = 'get';
  description = 'Pick up an item or currency from the room (alias for pickup). Supports partial currency names like "get g", "get go", "get gol" for gold.';
  private pickupCommand: PickupCommand;

  constructor(
    clients: Map<string, ConnectedClient>,
    userManager: UserManager
  ) {
    // Pass the clients directly to PickupCommand
    this.pickupCommand = new PickupCommand(clients, userManager);
  }

  execute(client: ConnectedClient, args: string): void {
    // Simply forward to the pickup command
    this.pickupCommand.execute(client, args);
  }
}
