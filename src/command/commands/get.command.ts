import { ConnectedClient } from '../../types';
import { Command } from '../command.interface';
import { PickupCommand } from './pickup.command';
import { RoomManager } from '../../room/roomManager';
import { UserManager } from '../../user/userManager';

/**
 * This is an explicit alias for the PickupCommand
 */
export class GetCommand implements Command {
  name = 'get';
  description = 'Pick up an item or currency from the room (alias for pickup)';
  private pickupCommand: PickupCommand;

  constructor(
    roomManager: RoomManager,
    userManager: UserManager
  ) {
    this.pickupCommand = new PickupCommand(roomManager, userManager);
  }

  execute(client: ConnectedClient, args: string): void {
    // Simply forward to the pickup command
    this.pickupCommand.execute(client, args);
  }
}
