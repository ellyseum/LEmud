import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { formatUsername } from '../../utils/formatters';

export class StatsCommand implements Command {
  name = 'stats';
  description = 'Show your character stats';

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    const user = client.user;
    writeToClient(client, colorize('=== Your Character Stats ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Username: ${formatUsername(user.username)}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Health: ${user.health}/${user.maxHealth}\r\n`, 'green'));
    writeToClient(client, colorize(`Level: ${user.level}\r\n`, 'yellow'));
    writeToClient(client, colorize(`Experience: ${user.experience}\r\n`, 'blue'));
    
    // Display the character attributes/statistics
    writeToClient(client, colorize('\r\n=== Attributes ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Strength: ${user.strength}\r\n`, 'white'));
    writeToClient(client, colorize(`Dexterity: ${user.dexterity}\r\n`, 'white'));
    writeToClient(client, colorize(`Agility: ${user.agility}\r\n`, 'white'));
    writeToClient(client, colorize(`Constitution: ${user.constitution}\r\n`, 'white'));
    writeToClient(client, colorize(`Wisdom: ${user.wisdom}\r\n`, 'white'));
    writeToClient(client, colorize(`Intelligence: ${user.intelligence}\r\n`, 'white'));
    writeToClient(client, colorize(`Charisma: ${user.charisma}\r\n`, 'white'));
    
    writeToClient(client, colorize('\r\n=== Account Info ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Member since: ${user.joinDate.toLocaleDateString()}\r\n`, 'dim'));
    writeToClient(client, colorize(`Last login: ${user.lastLogin.toLocaleDateString()}\r\n`, 'dim'));
    writeToClient(client, colorize('===========================\r\n', 'magenta'));
  }
}
