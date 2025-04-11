// Import all commands to ensure they're registered
import './adminmanage.command';
import './attack.command';
import './break.command';
import './damage.command';
import './drop.command';
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
import './say.command';
import './scores.command';
import './snake.command';
import './spawn.command';
import './stats.command';
import './sudo.command';
import './unequip.command';
import './yell.command';

// Export ScoresCommand so it can be registered properly
export * from './scores.command';

// This file ensures all commands are imported and registered with the command registry
console.log('[CommandRegistry] Loading all commands');