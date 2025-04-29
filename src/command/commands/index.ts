import './adminmanage.command';
import './attack.command';
import './break.command';
import './damage.command';
import './debug.command';
import './destroy.command';
import './drop.command';
import './effect.command';
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
import './rename.command';
import './resetname.command';
import './repair.command';
import './restrict.command';
import './root.command';
import './say.command';
import './scores.command';
import './snake.command';
import './spawn.command';
import './stats.command';
import './sudo.command';
import './unequip.command';
import './yell.command';
import './addflag.command';
import './removeflag.command';
import './listflags.command';
import './changePassword.command'; // Import the new ChangePasswordCommand
import { systemLogger } from '../../utils/logger';

export * from './scores.command';
export * from './changePassword.command'; // Export the new ChangePasswordCommand

systemLogger.info('Loading all commands');
