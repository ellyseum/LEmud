import { ConnectedClient, EquipmentSlot } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { ItemManager } from '../../utils/itemManager';
import { colorizeItemName } from '../../utils/itemNameColorizer';

export class EquipmentCommand implements Command {
  name = 'equipment';
  description = 'View your equipped items by slot';
  private itemManager: ItemManager;

  constructor() {
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    const user = client.user;
    
    writeToClient(client, colorize('=== Your Equipment ===\r\n', 'magenta'));
    
    // Initialize equipment if it doesn't exist
    if (!user.equipment) {
      user.equipment = {};
    }
    
    // Create a formatted list of all equipment slots
    this.displayEquipmentByGroup(client);
    
    // Show total bonuses from equipment
    const statBonuses = this.itemManager.calculateStatBonuses(user);
    const hasBonuses = Object.values(statBonuses).some(bonus => bonus > 0);
    
    if (hasBonuses) {
      writeToClient(client, colorize('\r\n=== Stat Bonuses from Equipment ===\r\n', 'magenta'));
      if (statBonuses.strength > 0) {
        writeToClient(client, colorize(`Strength: +${statBonuses.strength}\r\n`, 'cyan'));
      }
      if (statBonuses.dexterity > 0) {
        writeToClient(client, colorize(`Dexterity: +${statBonuses.dexterity}\r\n`, 'cyan'));
      }
      if (statBonuses.agility > 0) {
        writeToClient(client, colorize(`Agility: +${statBonuses.agility}\r\n`, 'cyan'));
      }
      if (statBonuses.constitution > 0) {
        writeToClient(client, colorize(`Constitution: +${statBonuses.constitution}\r\n`, 'cyan'));
      }
      if (statBonuses.wisdom > 0) {
        writeToClient(client, colorize(`Wisdom: +${statBonuses.wisdom}\r\n`, 'cyan'));
      }
      if (statBonuses.intelligence > 0) {
        writeToClient(client, colorize(`Intelligence: +${statBonuses.intelligence}\r\n`, 'cyan'));
      }
      if (statBonuses.charisma > 0) {
        writeToClient(client, colorize(`Charisma: +${statBonuses.charisma}\r\n`, 'cyan'));
      }
    }
    
    // Show attack and defense provided by equipment
    const attackFromEquipment = user.attack ? user.attack - Math.floor(user.strength / 2) : 0;
    const defenseFromEquipment = user.defense ? user.defense - Math.floor(user.constitution / 2) : 0;
    
    writeToClient(client, colorize('\r\n=== Combat Stats from Equipment ===\r\n', 'magenta'));
    writeToClient(client, colorize(`Attack: +${attackFromEquipment}\r\n`, 'red'));
    writeToClient(client, colorize(`Defense: +${defenseFromEquipment}\r\n`, 'blue'));
    
    writeToClient(client, colorize('\r\nUse "equip [item]" to equip items from your inventory\r\n', 'dim'));
    writeToClient(client, colorize('Use "unequip [slot/item]" to remove equipped items\r\n', 'dim'));
    writeToClient(client, colorize('===========================\r\n', 'magenta'));
  }
  
  /**
   * Display equipment organized by logical groups/regions
   */
  private displayEquipmentByGroup(client: ConnectedClient): void {
    if (!client.user) return;
    
    const user = client.user;
    
    // HEAD REGION
    writeToClient(client, colorize('\r\n[Head Region]\r\n', 'yellow'));
    this.displaySlot(client, EquipmentSlot.HEAD, 'Head');
    this.displaySlot(client, EquipmentSlot.NECK, 'Neck');
    
    // TORSO REGION
    writeToClient(client, colorize('\r\n[Torso Region]\r\n', 'yellow'));
    this.displaySlot(client, EquipmentSlot.CHEST, 'Chest');
    this.displaySlot(client, EquipmentSlot.BACK, 'Back');
    
    // ARMS REGION
    writeToClient(client, colorize('\r\n[Arms Region]\r\n', 'yellow'));
    this.displaySlot(client, EquipmentSlot.ARMS, 'Arms');
    this.displaySlot(client, EquipmentSlot.HANDS, 'Hands');
    this.displaySlot(client, EquipmentSlot.FINGER, 'Finger');
    
    // WEAPONS
    writeToClient(client, colorize('\r\n[Weapons]\r\n', 'yellow'));
    this.displaySlot(client, EquipmentSlot.MAIN_HAND, 'Main Hand');
    this.displaySlot(client, EquipmentSlot.OFF_HAND, 'Off Hand');
    
    // LOWER REGION
    writeToClient(client, colorize('\r\n[Lower Region]\r\n', 'yellow'));
    this.displaySlot(client, EquipmentSlot.WAIST, 'Waist');
    this.displaySlot(client, EquipmentSlot.LEGS, 'Legs');
    this.displaySlot(client, EquipmentSlot.FEET, 'Feet');
  }
  
  /**
   * Display a single equipment slot
   */
  private displaySlot(client: ConnectedClient, slot: EquipmentSlot, slotDisplayName: string): void {
    if (!client.user || !client.user.equipment) return;
    
    const itemId = client.user.equipment[slot];
    
    if (itemId) {
      // First check if it's an item instance
      const instance = this.itemManager.getItemInstance(itemId);
      
      if (instance) {
        // It's an item instance, get the template and check for custom name
        const template = this.itemManager.getItem(instance.templateId);
        
        if (template) {
          let itemDisplayName = template.name;
          
          // Use custom name if available
          if (instance.properties?.customName) {
            itemDisplayName = colorizeItemName(instance.properties.customName);
          }
          
          writeToClient(client, colorize(`${slotDisplayName}: ${itemDisplayName}\r\n`, 'cyan'));
        } else {
          writeToClient(client, colorize(`${slotDisplayName}: <unknown item>\r\n`, 'red'));
        }
      } else {
        // Try as a legacy item
        const item = this.itemManager.getItem(itemId);
        if (item) {
          writeToClient(client, colorize(`${slotDisplayName}: ${item.name}\r\n`, 'cyan'));
        } else {
          writeToClient(client, colorize(`${slotDisplayName}: <unknown item>\r\n`, 'red'));
        }
      }
    } else {
      writeToClient(client, colorize(`${slotDisplayName}: <empty>\r\n`, 'dim'));
    }
  }
}