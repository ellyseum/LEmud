// Import all commands to ensure they're registered
import './adminmanage.command';
import './attack.command';
import './break.command';
import './damage.command';
import './debug.command'; // Import our new debug command
import './destroy.command'; // Import our new destroy command
import './drop.command';
import './effect.command'; // Add our new effect command
import './equip.command';
import './equipment.command';
import './get.command';
import './giveitem.command';
import './heal.command';
import './help.command';
import './history.command';
import './inventory.command';
import './list.command';
import './look.command';
import './move.command';
import './pickup.command';
import './quit.command';
import './rename.command'; // Import our new rename command
import './repair.command'; // Import our new repair command
import './restrict.command'; // Import our restrict command
import './root.command'; // Import our new root command
import './say.command';
import './scores.command';
import './snake.command';
import './spawn.command';
import './stats.command';
import './sudo.command';
import './unequip.command';
import './yell.command';
import './addflag.command'; // Import flag management commands
import './removeflag.command';
import './listflags.command';

// Export ScoresCommand so it can be registered properly
export * from './scores.command';

// This file ensures all commands are imported and registered with the command registry
console.log('[CommandRegistry] Loading all commands');