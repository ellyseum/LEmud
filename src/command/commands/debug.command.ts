import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { NPC, NPCData } from '../../combat/npc';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';
import { CombatSystem } from '../../combat/combatSystem';
import { ItemManager } from '../../utils/itemManager';

export class DebugCommand implements Command {
  name = 'debug';
  description = 'Inspect game elements and data (admin only)';
  private itemManager: ItemManager;

  constructor(
    private roomManager: RoomManager,
    private userManager: UserManager,
    private combatSystem: CombatSystem
  ) {
    this.itemManager = ItemManager.getInstance();
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;
    
    // Check if user has admin privileges
    if (!SudoCommand.isAuthorizedUser(client.user.username)) {
      writeToClient(client, colorize('You do not have permission to use this command.\r\n', 'red'));
      return;
    }

    const [subcommand, ...subArgs] = args.trim().split(' ');
    const target = subArgs.join(' ').trim();

    if (!subcommand) {
      this.showHelp(client);
      return;
    }

    // Handle different subcommands
    switch (subcommand.toLowerCase()) {
      case 'npc':
        this.debugNPC(client, target);
        break;
      case 'room':
        this.debugRoom(client, target);
        break;
      case 'player':
        this.debugPlayer(client, target);
        break;
      case 'combat':
        this.debugCombat(client, target);
        break;
      case 'system':
        this.debugSystem(client);
        break;
      case 'item':
        this.debugItem(client, target);
        break;
      default:
        writeToClient(client, colorize(`Unknown debug subcommand: ${subcommand}\r\n`, 'red'));
        this.showHelp(client);
        break;
    }
  }

  private showHelp(client: ConnectedClient): void {
    writeToClient(client, colorize('Debug Command - Admin Only\r\n', 'green'));
    writeToClient(client, colorize('------------------------\r\n', 'green'));
    writeToClient(client, colorize('Usage: debug <subcommand> [target]\r\n\r\n', 'cyan'));
    
    writeToClient(client, colorize('Available subcommands:\r\n', 'yellow'));
    writeToClient(client, colorize('  npc <id/name>   - Show details about an NPC (instance or template)\r\n', 'white'));
    writeToClient(client, colorize('  room <id>       - Show details about a room\r\n', 'white'));
    writeToClient(client, colorize('  player <name>   - Show details about a player\r\n', 'white'));
    writeToClient(client, colorize('  combat <roomId> - Show active combat information\r\n', 'white'));
    writeToClient(client, colorize('  item <id/name>  - Show details about an item template or instance\r\n', 'white'));
    writeToClient(client, colorize('  system          - Show system information\r\n', 'white'));
  }

  private debugItem(client: ConnectedClient, target: string): void {
    if (!target) {
      writeToClient(client, colorize('Usage: debug item <id/name>\r\n', 'yellow'));
      writeToClient(client, colorize('Options:\r\n', 'yellow'));
      writeToClient(client, colorize('  debug item <template_id> - Show details about an item template\r\n', 'white'));
      writeToClient(client, colorize('  debug item instance <instance_id> - Show details about a specific item instance\r\n', 'white'));
      writeToClient(client, colorize('  debug item list [type] - List all item templates (optional: filter by type)\r\n', 'white'));
      writeToClient(client, colorize('  debug item instances [username] - List all item instances (optional: filter by owner)\r\n', 'white'));
      return;
    }

    const args = target.split(' ');
    const firstArg = args[0].toLowerCase();

    // Handle listing all items
    if (firstArg === 'list') {
      const typeFilter = args[1]?.toLowerCase();
      this.listItemTemplates(client, typeFilter);
      return;
    }

    // Handle listing all item instances
    if (firstArg === 'instances') {
      const usernameFilter = args[1];
      this.listItemInstances(client, usernameFilter);
      return;
    }

    // Handle looking up a specific instance
    if (firstArg === 'instance') {
      const instanceId = args[1];
      if (!instanceId) {
        writeToClient(client, colorize('Usage: debug item instance <instance_id>\r\n', 'yellow'));
        return;
      }
      this.showItemInstance(client, instanceId);
      return;
    }

    // First try to see if this is directly an instance ID
    const instance = this.itemManager.getItemInstance(target);
    if (instance) {
      // It's an instance ID, show the instance details
      this.showItemInstance(client, target);
      return;
    }

    // Search for item instances by custom name or template name
    const instancesByCustomName = this.findInstancesByNameMatch(target);
    if (instancesByCustomName.length > 0) {
      // Show the matching instances
      writeToClient(client, colorize(`Found ${instancesByCustomName.length} items with names matching '${target}':\r\n`, 'green'));
      instancesByCustomName.forEach((instance, index) => {
        const template = this.itemManager.getItem(instance.templateId);
        const displayName = instance.properties?.customName || (template ? template.name : 'Unknown');
        const ownerInfo = this.getItemOwner(instance.instanceId);
        const ownerText = ownerInfo.username || 'No owner';
        const slotText = ownerInfo.slot ? ` (Slot: ${ownerInfo.slot})` : '';
        writeToClient(client, colorize(`${index + 1}. ${displayName} (ID: ${instance.instanceId}, Owner: ${ownerText}${slotText})\r\n`, 'cyan'));
      });
      
      // Display the first match in detail
      writeToClient(client, colorize(`\r\nShowing details for first match:\r\n`, 'yellow'));
      this.showItemInstance(client, instancesByCustomName[0].instanceId);
      return;
    }

    // If no instances found, try to find a template
    this.findAndShowItemTemplate(client, target);
  }

  /**
   * Find item instances by name match (searches both custom names and template names)
   */
  private findInstancesByNameMatch(nameQuery: string): any[] {
    const { stripColorCodes } = require('../../utils/itemNameColorizer');
    const normalizedQuery = nameQuery.toLowerCase();
    const matchingInstances: any[] = [];
    
    // Get all item instances
    const allInstances = this.itemManager.getAllItemInstances();
    
    // First check custom names
    for (const instance of allInstances) {
      // Check custom name if it exists
      if (instance.properties?.customName) {
        const cleanCustomName = stripColorCodes(instance.properties.customName).toLowerCase();
        if (cleanCustomName.includes(normalizedQuery)) {
          matchingInstances.push(instance);
          continue;
        }
      }
      
      // Check template name
      const template = this.itemManager.getItem(instance.templateId);
      if (template) {
        const cleanTemplateName = stripColorCodes(template.name).toLowerCase();
        if (cleanTemplateName.includes(normalizedQuery)) {
          matchingInstances.push(instance);
        }
      }
    }
    
    return matchingInstances;
  }

  private findAndShowItemTemplate(client: ConnectedClient, identifier: string): void {
    const itemId = identifier.toLowerCase();
    
    // Try to get the item directly by ID
    const item = this.itemManager.getItem(itemId);
    
    if (item) {
      this.displayItemTemplate(client, item);
      return;
    }
    
    const { stripColorCodes } = require('../../utils/itemNameColorizer');
    
    // If not found by exact ID, try to find by name (case-insensitive partial match)
    const allItems = this.itemManager.getAllItems();
    const matchingItems = allItems.filter(i => {
      const cleanName = stripColorCodes(i.name).toLowerCase();
      const cleanId = stripColorCodes(i.id).toLowerCase();
      
      return cleanName.includes(itemId) || cleanId.includes(itemId);
    });
    
    if (matchingItems.length === 0) {
      writeToClient(client, colorize(`No item templates found matching '${identifier}'.\r\n`, 'yellow'));
      return;
    }
    
    if (matchingItems.length === 1) {
      this.displayItemTemplate(client, matchingItems[0]);
      return;
    }
    
    // Multiple matches found, display a list
    writeToClient(client, colorize(`Found ${matchingItems.length} items matching '${identifier}':\r\n`, 'green'));
    matchingItems.forEach((item, index) => {
      writeToClient(client, colorize(`${index + 1}. ${item.name} (ID: ${item.id})\r\n`, 'cyan'));
    });
    
    // Display the first match in detail
    writeToClient(client, colorize(`\r\nShowing details for first match:\r\n`, 'yellow'));
    this.displayItemTemplate(client, matchingItems[0]);
  }

  private displayItemTemplate(client: ConnectedClient, item: any): void {
    writeToClient(client, colorize(`Item Template: ${item.id}\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    writeToClient(client, colorize(`Name: ${item.name}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Type: ${item.type}\r\n`, 'cyan'));
    
    if (item.description) {
      writeToClient(client, colorize(`Description: ${item.description}\r\n`, 'cyan'));
    }
    
    writeToClient(client, colorize(`Value: ${item.value}\r\n`, 'cyan'));
    
    if (item.weight) {
      writeToClient(client, colorize(`Weight: ${item.weight}\r\n`, 'cyan'));
    }
    
    if (item.slot) {
      writeToClient(client, colorize(`Equipment Slot: ${item.slot}\r\n`, 'cyan'));
    }
    
    // Display stats if present
    if (item.stats) {
      writeToClient(client, colorize(`\r\nStats:\r\n`, 'yellow'));
      for (const [statName, statValue] of Object.entries(item.stats)) {
        writeToClient(client, colorize(`  ${statName}: ${statValue}\r\n`, 'white'));
      }
    }
    
    // Display requirements if present
    if (item.requirements) {
      writeToClient(client, colorize(`\r\nRequirements:\r\n`, 'yellow'));
      for (const [reqName, reqValue] of Object.entries(item.requirements)) {
        writeToClient(client, colorize(`  ${reqName}: ${reqValue}\r\n`, 'white'));
      }
    }
    
    // Show instances of this item - using findInstancesByTemplate which is a public method
    const instances = this.itemManager.findInstancesByTemplate(item.id);
    
    writeToClient(client, colorize(`\r\nItem Instances: ${instances.length}\r\n`, 'yellow'));
    if (instances.length > 0) {
      instances.forEach((instance, index) => {
        const ownerInfo = this.getItemOwner(instance.instanceId);
        const ownerText = ownerInfo.username || 'No owner';
        const slotText = ownerInfo.slot ? ` (Slot: ${ownerInfo.slot})` : '';
        
        writeToClient(client, colorize(`  ${index + 1}. ${instance.instanceId}${ownerText}${slotText}\r\n`, 'white'));
      });
    } else {
      writeToClient(client, colorize(`  No instances of this item exist\r\n`, 'white'));
    }
  }

  private showItemInstance(client: ConnectedClient, instanceId: string): void {
    // If it's an exact match, use the direct method
    const exactInstance = this.itemManager.getItemInstance(instanceId);
    
    if (exactInstance) {
      this.displayItemInstanceDetails(client, instanceId, exactInstance);
      return;
    }
    
    // If not an exact match but at least 8 characters, try partial matching
    if (instanceId.length >= 8) {
      // Try to find instance by partial ID
      const instance = this.itemManager.findInstanceByPartialId(instanceId);
      
      // If undefined, it means multiple items matched (ambiguous)
      if (instance === undefined) {
        writeToClient(client, colorize(`Multiple items match ID '${instanceId}'. Please use a longer ID to be more specific.\r\n`, 'yellow'));
        
        // Show the matching instances for convenience
        const matchingInstances = this.findInstancesByPartialId(instanceId);
        if (matchingInstances.length > 0) {
          writeToClient(client, colorize(`Matching instances:\r\n`, 'cyan'));
          matchingInstances.forEach((matchInstance, index) => {
            const template = this.itemManager.getItem(matchInstance.templateId);
            const displayName = matchInstance.properties?.customName || (template ? template.name : 'Unknown');
            writeToClient(client, colorize(`  ${index + 1}. ${displayName} (ID: ${matchInstance.instanceId})\r\n`, 'white'));
          });
        }
        return;
      }
      
      // If a unique match was found, use it
      if (instance) {
        this.displayItemInstanceDetails(client, instance.instanceId, instance);
        return;
      }
    }
    
    // If we get here, the item instance wasn't found
    writeToClient(client, colorize(`No item instance found with ID '${instanceId}'.\r\n`, 'yellow'));
  }

  /**
   * Helper method to find instances by partial ID
   */
  private findInstancesByPartialId(partialId: string): any[] {
    const allItems = this.itemManager.getAllItems();
    const matchingInstances: any[] = [];
    
    // Check all templates and find their instances with matching IDs
    for (const item of allItems) {
      const instances = this.itemManager.findInstancesByTemplate(item.id);
      for (const instance of instances) {
        if (instance.instanceId.toLowerCase().startsWith(partialId.toLowerCase())) {
          matchingInstances.push(instance);
        }
      }
    }
    
    return matchingInstances;
  }
  
  /**
   * Display item instance details
   */
  private displayItemInstanceDetails(client: ConnectedClient, instanceId: string, instance: any): void {
    const template = this.itemManager.getItem(instance.templateId);
    
    writeToClient(client, colorize(`Item Instance: ${instance.instanceId}\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    writeToClient(client, colorize(`Template ID: ${instance.templateId}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Name: ${template ? template.name : 'Unknown'}\r\n`, 'cyan'));
    
    if (instance.properties?.customName) {
      writeToClient(client, colorize(`Custom Name: ${instance.properties.customName}\r\n`, 'cyan'));
    }
    
    writeToClient(client, colorize(`Created: ${instance.created}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Created By: ${instance.createdBy}\r\n`, 'cyan'));
    
    // Display item owner
    const ownerInfo = this.getItemOwner(instanceId);
    const ownerText = ownerInfo.username || 'None (item may be in a room or lost)';
    
    if (ownerInfo.slot) {
      // Show the equipped slot in red next to the owner's name
      writeToClient(client, colorize(`Current Owner: ${ownerText} `, 'cyan') + 
                           colorize(`(${ownerInfo.slot})`, 'red') + 
                           colorize(`\r\n`, 'cyan'));
    } else {
      // No slot, just show the owner
      writeToClient(client, colorize(`Current Owner: ${ownerText}\r\n`, 'cyan'));
    }
    
    // Display instance properties
    if (instance.properties) {
      writeToClient(client, colorize(`\r\nProperties:\r\n`, 'yellow'));
      
      // Handle durability specially
      if (instance.properties.durability) {
        const durability = instance.properties.durability;
        writeToClient(client, colorize(`  Durability: ${durability.current}/${durability.max} (${Math.floor(durability.current/durability.max*100)}%)\r\n`, 'white'));
      }
      
      // Handle quality
      if (instance.properties.quality) {
        writeToClient(client, colorize(`  Quality: ${instance.properties.quality}\r\n`, 'white'));
      }
      
      // Handle soulbound
      if (instance.properties.soulbound) {
        writeToClient(client, colorize(`  Soulbound: Yes\r\n`, 'white'));
        if (instance.properties.boundTo) {
          writeToClient(client, colorize(`  Bound To: ${instance.properties.boundTo}\r\n`, 'white'));
        }
      }
      
      // Handle charges
      if (instance.properties.charges !== undefined) {
        writeToClient(client, colorize(`  Charges: ${instance.properties.charges}\r\n`, 'white'));
      }
      
      // Handle enchantments
      if (instance.properties.enchantments && instance.properties.enchantments.length > 0) {
        writeToClient(client, colorize(`\r\n  Enchantments:\r\n`, 'yellow'));
        instance.properties.enchantments.forEach((enchant: any, index: number) => {
          writeToClient(client, colorize(`    ${index + 1}. ${enchant.name}: ${enchant.effect}\r\n`, 'white'));
          if (enchant.bonuses) {
            for (const [stat, bonus] of Object.entries(enchant.bonuses)) {
              writeToClient(client, colorize(`       ${stat}: +${bonus}\r\n`, 'dim'));
            }
          }
        });
      }
      
      // Display any remaining properties (excluding ones we already handled)
      const handledProps = ['durability', 'quality', 'soulbound', 'boundTo', 'charges', 'enchantments', 'customName'];
      const remainingProps = Object.keys(instance.properties).filter(prop => !handledProps.includes(prop));
      
      if (remainingProps.length > 0) {
        writeToClient(client, colorize(`\r\n  Other Properties:\r\n`, 'yellow'));
        for (const prop of remainingProps) {
          writeToClient(client, colorize(`    ${prop}: ${JSON.stringify(instance.properties[prop])}\r\n`, 'white'));
        }
      }
    }
    
    // Display item history
    if (instance.history && instance.history.length > 0) {
      writeToClient(client, colorize(`\r\nHistory:\r\n`, 'yellow'));
      instance.history.forEach((entry: any, index: number) => {
        const timestamp = new Date(entry.timestamp).toLocaleString();
        writeToClient(client, colorize(`  ${index + 1}. [${timestamp}] ${entry.event}${entry.details ? `: ${entry.details}` : ''}\r\n`, 'white'));
      });
    }
  }

  private listItemTemplates(client: ConnectedClient, typeFilter?: string): void {
    const allItems = this.itemManager.getAllItems();
    
    let filteredItems = allItems;
    if (typeFilter) {
      filteredItems = allItems.filter(item => item.type.toLowerCase() === typeFilter.toLowerCase());
    }
    
    if (filteredItems.length === 0) {
      if (typeFilter) {
        writeToClient(client, colorize(`No items found of type '${typeFilter}'.\r\n`, 'yellow'));
      } else {
        writeToClient(client, colorize(`No item templates found.\r\n`, 'yellow'));
      }
      return;
    }
    
    const typeLabel = typeFilter ? ` (type: ${typeFilter})` : '';
    writeToClient(client, colorize(`Item Templates${typeLabel}: ${filteredItems.length}\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    
    // Group items by type for better organization
    const itemsByType: Record<string, any[]> = {};
    
    filteredItems.forEach(item => {
      if (!itemsByType[item.type]) {
        itemsByType[item.type] = [];
      }
      itemsByType[item.type].push(item);
    });
    
    // Display items grouped by type
    for (const [type, items] of Object.entries(itemsByType)) {
      writeToClient(client, colorize(`\r\n${type.toUpperCase()} (${items.length}):\r\n`, 'yellow'));
      
      items.forEach((item, index) => {
        // Count instances of this item using findInstancesByTemplate
        const instanceCount = this.itemManager.findInstancesByTemplate(item.id).length;
        
        const statsStr = item.stats ? 
          ` - Stats: ${Object.entries(item.stats).map(([k, v]) => `${k}:${v}`).join(', ')}` : '';
        
        writeToClient(client, colorize(`  ${index + 1}. ${item.name} (ID: ${item.id})${statsStr} [${instanceCount} instances]\r\n`, 'white'));
      });
    }
  }

  private listItemInstances(client: ConnectedClient, usernameFilter?: string): void {
    // We need to get all instances. Since there's no direct public method,
    // we'll collect instances by querying all templates and finding their instances
    const allItems = this.itemManager.getAllItems();
    const allInstances: any[] = [];
    
    // Collect all instances across all item templates
    for (const item of allItems) {
      const instances = this.itemManager.findInstancesByTemplate(item.id);
      allInstances.push(...instances);
    }
    
    if (allInstances.length === 0) {
      writeToClient(client, colorize(`No item instances found.\r\n`, 'yellow'));
      return;
    }
    
    // Filter by owner if username provided
    let filteredInstances = allInstances;
    let ownedInstances: Record<string, any[]> = {};
    
    if (usernameFilter) {
      // Get the specific user's inventory
      const user = this.userManager.getUser(usernameFilter);
      if (!user) {
        writeToClient(client, colorize(`User '${usernameFilter}' not found.\r\n`, 'red'));
        return;
      }
      
      // Map of instance IDs to their owners
      const itemOwners = this.buildItemOwnershipMap();
      
      // Filter instances owned by this user
      filteredInstances = allInstances.filter(instance => 
        itemOwners[instance.instanceId] === usernameFilter
      );
      
      if (filteredInstances.length === 0) {
        writeToClient(client, colorize(`User '${usernameFilter}' doesn't own any item instances.\r\n`, 'yellow'));
        return;
      }
      
      ownedInstances[usernameFilter] = filteredInstances;
    } else {
      // Group instances by owner
      ownedInstances = this.groupInstancesByOwner(allInstances);
    }
    
    const userLabel = usernameFilter ? ` owned by ${usernameFilter}` : '';
    writeToClient(client, colorize(`Item Instances${userLabel}: ${filteredInstances.length}\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    
    // Display instances grouped by owner
    for (const [owner, instances] of Object.entries(ownedInstances)) {
      writeToClient(client, colorize(`\r\nOwner: ${owner || 'Unowned'} (${instances.length})\r\n`, 'yellow'));
      
      instances.forEach((instance, index) => {
        const template = this.itemManager.getItem(instance.templateId);
        const templateName = template ? template.name : instance.templateId;
        const customName = instance.properties?.customName ? ` (${instance.properties.customName})` : '';
        
        // Get display name using the itemManager method if available
        let displayName = templateName + customName;
        if (typeof this.itemManager.getItemDisplayName === 'function') {
          displayName = this.itemManager.getItemDisplayName(instance.instanceId);
          if (customName && !displayName.includes(instance.properties.customName)) {
            displayName += customName;
          }
        }
        
        // Show durability if available
        let durabilityStr = '';
        if (instance.properties?.durability) {
          const durability = instance.properties.durability;
          const durabilityPct = Math.floor((durability.current / durability.max) * 100);
          durabilityStr = ` - Durability: ${durability.current}/${durability.max} (${durabilityPct}%)`;
        }
        
        // Show quality if available
        const qualityStr = instance.properties?.quality ? ` - Quality: ${instance.properties.quality}` : '';
        
        writeToClient(client, colorize(`  ${index + 1}. ${displayName} [${instance.instanceId}]${durabilityStr}${qualityStr}\r\n`, 'white'));
      });
    }
  }

  private getItemOwner(instanceId: string): { username: string | null, slot: string | null } {
    // Check all users' inventories and equipment
    const allUsers = this.userManager.getAllUsers();
    
    for (const user of allUsers) {
      // Check inventory
      if (user.inventory && user.inventory.items && 
          user.inventory.items.includes(instanceId)) {
        return { username: user.username, slot: null };
      }
      
      // Check equipment
      if (user.equipment) {
        for (const slot in user.equipment) {
          if (user.equipment[slot] === instanceId) {
            return { username: user.username, slot };
          }
        }
      }
    }
    
    // Check all rooms using the proper itemInstances method
    const allRooms = this.roomManager.getAllRooms();
    for (const room of allRooms) {
      if (room.hasItemInstance(instanceId)) {
        return { username: `Room: ${room.id}`, slot: null };
      }
      
      // Also check legacy items for backward compatibility
      if (room.items && Array.isArray(room.items)) {
        if (room.items.some(item => typeof item === 'string' ? item === instanceId : false)) {
          return { username: `Room: ${room.id} (legacy)`, slot: null };
        }
      }
    }
    
    return { username: null, slot: null };
  }

  private buildItemOwnershipMap(): Record<string, string> {
    const itemOwners: Record<string, string> = {};
    const allUsers = this.userManager.getAllUsers();
    
    for (const user of allUsers) {
      // Check inventory
      if (user.inventory && user.inventory.items) {
        for (const itemId of user.inventory.items) {
          itemOwners[itemId] = user.username;
        }
      }
      
      // Check equipment
      if (user.equipment) {
        for (const slot in user.equipment) {
          const itemId = user.equipment[slot];
          if (itemId) {
            itemOwners[itemId] = user.username;
          }
        }
      }
    }
    
    return itemOwners;
  }

  private groupInstancesByOwner(instances: any[]): Record<string, any[]> {
    const itemOwners = this.buildItemOwnershipMap();
    const instancesByOwner: Record<string, any[]> = {};
    
    for (const instance of instances) {
      const owner = itemOwners[instance.instanceId] || 'Unowned';
      
      if (!instancesByOwner[owner]) {
        instancesByOwner[owner] = [];
      }
      
      instancesByOwner[owner].push(instance);
    }
    
    return instancesByOwner;
  }

  private debugNPC(client: ConnectedClient, target: string): void {
    if (!target) {
      writeToClient(client, colorize('Usage: debug npc <id/name>\r\n', 'yellow'));
      return;
    }

    // Load all NPC templates
    const npcTemplates = NPC.loadNPCData();
    
    // Check if there's a template with this ID
    if (npcTemplates.has(target)) {
      // Show template data
      const template = npcTemplates.get(target)!;
      this.displayNPCTemplate(client, template);
      return;
    }

    // If no template found, check for active NPC instances
    if (!client.user?.currentRoomId) {
      writeToClient(client, colorize('You must be in a room to check NPCs.\r\n', 'yellow'));
      return;
    }

    // Get current room
    const room = this.roomManager.getRoom(client.user.currentRoomId);
    if (!room) {
      writeToClient(client, colorize('You are not in a valid room.\r\n', 'red'));
      return;
    }

    // First check if there's an exact match for instance ID
    const npcByInstance = room.getNPC(target);
    if (npcByInstance) {
      this.displayNPCInstance(client, npcByInstance);
      return;
    }

    // Check if there's an NPC with a template ID that matches
    const matchingTemplateNPCs = room.findNPCsByTemplateId(target);
    if (matchingTemplateNPCs.length > 0) {
      writeToClient(client, colorize(`Found ${matchingTemplateNPCs.length} NPCs with template ID '${target}':\r\n`, 'green'));
      
      // Show a list of matching NPCs
      matchingTemplateNPCs.forEach((npc, index) => {
        writeToClient(client, colorize(`${index + 1}. ${npc.name} (Instance ID: ${npc.instanceId})\r\n`, 'cyan'));
      });
      
      // Show the first one in detail
      this.displayNPCInstance(client, matchingTemplateNPCs[0]);
      return;
    }

    // Check if there's an NPC with a name that matches
    const npcsInRoom = Array.from(room.npcs.values());
    const matchingNameNPCs = npcsInRoom.filter(npc => 
      npc.name.toLowerCase() === target.toLowerCase() ||
      npc.name.toLowerCase().includes(target.toLowerCase())
    );

    if (matchingNameNPCs.length > 0) {
      writeToClient(client, colorize(`Found ${matchingNameNPCs.length} NPCs named '${target}':\r\n`, 'green'));
      
      // Show a list of matching NPCs
      matchingNameNPCs.forEach((npc, index) => {
        writeToClient(client, colorize(`${index + 1}. ${npc.name} (Instance ID: ${npc.instanceId})\r\n`, 'cyan'));
      });
      
      // Show the first one in detail
      this.displayNPCInstance(client, matchingNameNPCs[0]);
      return;
    }

    // No matching NPC found
    writeToClient(client, colorize(`No NPC found with identifier '${target}'.\r\n`, 'yellow'));
    
    // Show available NPCs in current room
    if (room.npcs.size > 0) {
      writeToClient(client, colorize(`NPCs in current room:\r\n`, 'cyan'));
      Array.from(room.npcs.values()).forEach((npc, index) => {
        writeToClient(client, colorize(`${index + 1}. ${npc.name} (Template: ${npc.templateId}, Instance: ${npc.instanceId})\r\n`, 'white'));
      });
    } else {
      writeToClient(client, colorize(`No NPCs in current room.\r\n`, 'white'));
    }
    
    // Show available templates
    writeToClient(client, colorize(`\r\nAvailable NPC templates:\r\n`, 'cyan'));
    Array.from(npcTemplates.keys()).forEach((templateId, index) => {
      writeToClient(client, colorize(`${index + 1}. ${templateId}\r\n`, 'white'));
    });
  }

  private displayNPCTemplate(client: ConnectedClient, template: NPCData): void {
    writeToClient(client, colorize(`NPC Template: ${template.id}\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    writeToClient(client, colorize(`Name: ${template.name}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Description: ${template.description}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Health: ${template.health}/${template.maxHealth}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Damage: ${template.damage[0]}-${template.damage[1]}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Hostile: ${template.isHostile ? 'Yes' : 'No'}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Passive: ${template.isPassive ? 'Yes' : 'No'}\r\n`, 'cyan'));
    writeToClient(client, colorize(`XP Value: ${template.experienceValue}\r\n`, 'cyan'));
    
    writeToClient(client, colorize(`\r\nAttack Texts:\r\n`, 'yellow'));
    template.attackTexts.forEach((text, index) => {
      writeToClient(client, colorize(`  ${index + 1}. ${text}\r\n`, 'white'));
    });
    
    writeToClient(client, colorize(`\r\nDeath Messages:\r\n`, 'yellow'));
    template.deathMessages.forEach((msg, index) => {
      writeToClient(client, colorize(`  ${index + 1}. ${msg}\r\n`, 'white'));
    });
  }

  private displayNPCInstance(client: ConnectedClient, npc: NPC): void {
    writeToClient(client, colorize(`NPC Instance: ${npc.instanceId}\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    writeToClient(client, colorize(`Name: ${npc.name}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Template ID: ${npc.templateId}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Description: ${npc.description}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Health: ${npc.health}/${npc.maxHealth}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Damage: ${npc.damage[0]}-${npc.damage[1]}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Hostile: ${npc.isHostile ? 'Yes' : 'No'}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Passive: ${npc.isPassive ? 'Yes' : 'No'}\r\n`, 'cyan'));
    writeToClient(client, colorize(`XP Value: ${npc.experienceValue}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Alive: ${npc.isAlive() ? 'Yes' : 'No'}\r\n`, 'cyan'));
    
    // Display aggressor information 
    const aggressors = npc.getAllAggressors();
    if (aggressors.length > 0) {
      writeToClient(client, colorize(`\r\nAggressors (${aggressors.length}):\r\n`, 'yellow'));
      aggressors.forEach((aggressor, index) => {
        writeToClient(client, colorize(`  ${index + 1}. ${aggressor}\r\n`, 'white'));
      });
    } else {
      writeToClient(client, colorize(`\r\nAggressors: None\r\n`, 'yellow'));
    }

    writeToClient(client, colorize(`\r\nAttack Texts:\r\n`, 'yellow'));
    npc.attackTexts.forEach((text, index) => {
      writeToClient(client, colorize(`  ${index + 1}. ${text}\r\n`, 'white'));
    });
    
    writeToClient(client, colorize(`\r\nDeath Messages:\r\n`, 'yellow'));
    npc.deathMessages.forEach((msg, index) => {
      writeToClient(client, colorize(`  ${index + 1}. ${msg}\r\n`, 'white'));
    });
  }

  private debugRoom(client: ConnectedClient, roomId: string): void {
    // Default to current room if no ID provided
    if (!roomId && client.user?.currentRoomId) {
      roomId = client.user.currentRoomId;
    }
    
    if (!roomId) {
      writeToClient(client, colorize('Usage: debug room <id>\r\n', 'yellow'));
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      writeToClient(client, colorize(`Room with ID '${roomId}' not found.\r\n`, 'red'));
      
      // List available rooms
      const allRooms = this.roomManager.getAllRooms();
      writeToClient(client, colorize(`\r\nAvailable rooms:\r\n`, 'cyan'));
      allRooms.forEach((room, index) => {
        writeToClient(client, colorize(`${index + 1}. ${room.id} - ${room.name}\r\n`, 'white'));
      });
      return;
    }

    writeToClient(client, colorize(`Room: ${room.id}\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    writeToClient(client, colorize(`Name: ${room.name}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Description: ${room.description}\r\n`, 'cyan'));
    
    // Exits
    writeToClient(client, colorize(`\r\nExits:\r\n`, 'yellow'));
    if (room.exits.length > 0) {
      room.exits.forEach((exit, index) => {
        writeToClient(client, colorize(`  ${index + 1}. ${exit.direction} -> ${exit.roomId}\r\n`, 'white'));
      });
    } else {
      writeToClient(client, colorize(`  None\r\n`, 'white'));
    }
    
    // Players - Enhanced to check active users in this room
    const playersInRoom = this.getRealPlayersInRoom(room);
    writeToClient(client, colorize(`\r\nPlayers (${playersInRoom.length}):\r\n`, 'yellow'));
    if (playersInRoom.length > 0) {
      playersInRoom.forEach((player, index) => {
        writeToClient(client, colorize(`  ${index + 1}. ${player}\r\n`, 'white'));
      });
    } else {
      writeToClient(client, colorize(`  None\r\n`, 'white'));
    }
    
    // NPCs
    writeToClient(client, colorize(`\r\nNPCs (${room.npcs.size}):\r\n`, 'yellow'));
    if (room.npcs.size > 0) {
      let index = 1;
      for (const [instanceId, npc] of room.npcs.entries()) {
        writeToClient(client, colorize(`  ${index}. ${npc.name} (${npc.health}/${npc.maxHealth} HP)\r\n`, 'white'));
        writeToClient(client, colorize(`     Template: ${npc.templateId}, Instance: ${instanceId}\r\n`, 'dim'));
        index++;
      }
    } else {
      writeToClient(client, colorize(`  None\r\n`, 'white'));
    }
    
    // Items - Updated to match how the look command displays items
    writeToClient(client, colorize(`\r\nItems:\r\n`, 'yellow'));
    
    // Try multiple ways to access room items to match what look command is using
    let roomItems: any[] = [];
    
    // First check direct items array - this is the most reliable method
    if (room.items && Array.isArray(room.items) && room.items.length > 0) {
      roomItems = this.getRealItemsInRoom(room);
    }
    
    // If still no items found, try the item history approach
    if (roomItems.length === 0) {
      // Search for items that have this room as owner in their history
      const allItems = this.getAllItemInstances();
      roomItems = allItems.filter(item => {
        // Check if item history shows it was dropped in this room
        if (item.history) {
          const dropEvents = item.history.filter((entry: any) => 
            entry.event === 'drop' && 
            entry.details && 
            (entry.details.includes(`in room ${room.id}`) || 
             entry.details.toLowerCase().includes(`in ${room.name.toLowerCase()}`))
          );
          
          if (dropEvents.length === 0) return false;
          
          const lastDropEvent = dropEvents[dropEvents.length - 1];
          
          // Check if it hasn't been picked up since the last drop
          return !item.history.some((entry: any) => 
            entry.timestamp > lastDropEvent.timestamp && 
            entry.event === 'pickup'
          );
        }
        return false;
      });
    }
    
    if (roomItems.length > 0) {
      writeToClient(client, colorize(`  Count: ${roomItems.length}\r\n`, 'white'));
      roomItems.forEach((item, index) => {
        const id = this.getItemId(item);
        const displayName = this.getItemDisplayName(id);
        
        // Show the full instance ID instead of truncating it
        writeToClient(client, colorize(`  ${index + 1}. ${displayName} [${id}]\r\n`, 'white'));
      });
    } else {
      // Debug logging to help diagnose item issues
      writeToClient(client, colorize(`  None\r\n`, 'white'));
      
      // If debug is run by admin, show extra diagnostic info
      if (client.user && SudoCommand.isAuthorizedUser(client.user.username)) {
        writeToClient(client, colorize(`\r\n  Room item debug info:\r\n`, 'dim'));
        writeToClient(client, colorize(`  - room.items type: ${room.items ? (Array.isArray(room.items) ? 'array' : typeof room.items) : 'undefined'}\r\n`, 'dim'));
        writeToClient(client, colorize(`  - room.items length: ${room.items && Array.isArray(room.items) ? room.items.length : 'N/A'}\r\n`, 'dim'));
        if (room.items && Array.isArray(room.items)) {
          writeToClient(client, colorize(`  - room.items raw: ${JSON.stringify(room.items).substring(0, 100)}${JSON.stringify(room.items).length > 100 ? '...' : ''}\r\n`, 'dim'));
        }
      }
    }
    
    // Currency
    writeToClient(client, colorize(`\r\nCurrency:\r\n`, 'yellow'));
    writeToClient(client, colorize(`  Gold: ${room.currency.gold}\r\n`, 'white'));
    writeToClient(client, colorize(`  Silver: ${room.currency.silver}\r\n`, 'white'));
    writeToClient(client, colorize(`  Copper: ${room.currency.copper}\r\n`, 'white'));
  }

  // Helper method to get the real list of players in a room
  private getRealPlayersInRoom(room: any): string[] {
    // If room.players is already populated and accurate, use it
    if (room.players && room.players.length > 0) {
      return room.players;
    }
    
    // Otherwise check all users to see who's in this room
    const playersInRoom: string[] = [];
    const allUsers = this.userManager.getAllUsers();
    
    for (const user of allUsers) {
      if (user.currentRoomId === room.id && this.userManager.isUserActive(user.username)) {
        playersInRoom.push(user.username);
      }
    }
    
    return playersInRoom;
  }
  
  // Helper method to get all items in a room, handling different item formats
  private getRealItemsInRoom(room: any): any[] {
    const items: any[] = [];
    
    // First check the itemInstances Map (the preferred method going forward)
    if (room.getItemInstances && typeof room.getItemInstances === 'function') {
      const itemInstances = room.getItemInstances();
      for (const [instanceId, templateId] of itemInstances.entries()) {
        items.push(instanceId);
      }
    }
    
    // Also check legacy items for backward compatibility
    if (room.items) {
      // Make sure we handle both array and non-array room.items
      const itemArray = Array.isArray(room.items) ? room.items : [room.items];
      
      // Filter out undefined/null items and add them
      const legacyItems = itemArray.filter((item: any) => item !== undefined && item !== null);
      items.push(...legacyItems);
    }
    
    return items;
  }
  
  // Helper method to extract item ID from an item (which could be a string ID or an object)
  private getItemId(item: any): string {
    // If item is already a string (likely an instanceId), return it
    if (typeof item === 'string') {
      return item;
    } 
    
    // Try to extract ID from object properties
    if (item) {
      // Check common ID properties
      if (item.instanceId) return item.instanceId;
      if (item.id) return item.id;
      
      // If there's a name property, use that
      if (typeof item.name === 'string') {
        return item.name;
      }
    }
    
    // Last resort: convert to string
    return String(item || "unknown");
  }

  // Helper method to get a readable display name for an item
  private getItemDisplayName(instanceId: string): string {
    // Handle case where instanceId might not be a valid UUID
    if (!instanceId || instanceId.length < 8) {
      return instanceId || "Unknown Item";
    }
    
    const instance = this.itemManager.getItemInstance(instanceId);
    if (!instance) {
      // Try to see if this might be a template ID instead of an instance ID
      const template = this.itemManager.getItem(instanceId);
      if (template) {
        return template.name;
      }
      return `Unknown Item (${instanceId.substring(0, 8)}...)`;
    }
    
    // Use the itemManager's getItemDisplayName method if it exists
    if (typeof this.itemManager.getItemDisplayName === 'function') {
      return this.itemManager.getItemDisplayName(instanceId);
    }
    
    // Fallback implementation if the method doesn't exist
    const template = this.itemManager.getTemplateForInstance(instanceId);
    if (!template) return `Unknown Item (${instanceId.substring(0, 8)}...)`;
    
    const customName = instance.properties?.customName;
    if (customName) {
      return customName;
    }
    
    return template.name;
  }

  // Helper method to get all item instances in the game
  private getAllItemInstances(): any[] {
    const allItems = this.itemManager.getAllItems();
    const allInstances: any[] = [];
    
    for (const item of allItems) {
      const instances = this.itemManager.findInstancesByTemplate(item.id);
      allInstances.push(...instances);
    }
    
    return allInstances;
  }

  private debugPlayer(client: ConnectedClient, playerName: string): void {
    if (!playerName) {
      writeToClient(client, colorize('Usage: debug player <name>\r\n', 'yellow'));
      return;
    }

    const user = this.userManager.getUser(playerName);
    if (!user) {
      writeToClient(client, colorize(`Player '${playerName}' not found.\r\n`, 'red'));
      return;
    }

    writeToClient(client, colorize(`Player: ${user.username}\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    
    // Basic info
    writeToClient(client, colorize(`Level: ${user.level}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Experience: ${user.experience}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Health: ${user.health}/${user.maxHealth}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Current Room: ${user.currentRoomId}\r\n`, 'cyan'));
    writeToClient(client, colorize(`In Combat: ${user.inCombat ? 'Yes' : 'No'}\r\n`, 'cyan'));
    writeToClient(client, colorize(`Unconscious: ${user.isUnconscious ? 'Yes' : 'No'}\r\n`, 'cyan'));
    
    // Stats
    writeToClient(client, colorize(`\r\nStats:\r\n`, 'yellow'));
    writeToClient(client, colorize(`  Strength: ${user.strength}\r\n`, 'white'));
    writeToClient(client, colorize(`  Dexterity: ${user.dexterity}\r\n`, 'white'));
    writeToClient(client, colorize(`  Agility: ${user.agility}\r\n`, 'white'));
    writeToClient(client, colorize(`  Constitution: ${user.constitution}\r\n`, 'white'));
    writeToClient(client, colorize(`  Intelligence: ${user.intelligence}\r\n`, 'white'));
    writeToClient(client, colorize(`  Wisdom: ${user.wisdom}\r\n`, 'white'));
    writeToClient(client, colorize(`  Charisma: ${user.charisma}\r\n`, 'white'));
    
    // Combat stats
    writeToClient(client, colorize(`\r\nCombat Stats:\r\n`, 'yellow'));
    writeToClient(client, colorize(`  Attack: ${user.attack}\r\n`, 'white'));
    writeToClient(client, colorize(`  Defense: ${user.defense}\r\n`, 'white'));
    
    // Inventory - Updated to show proper item names
    if (user.inventory) {
      writeToClient(client, colorize(`\r\nInventory Items (${user.inventory.items?.length || 0}):\r\n`, 'yellow'));
      if (user.inventory.items && user.inventory.items.length > 0) {
        user.inventory.items.forEach((instanceId, index) => {
          const displayName = this.getItemDisplayName(instanceId);
          writeToClient(client, colorize(`  ${index + 1}. ${displayName} [${instanceId.substring(0, 8)}...]\r\n`, 'white'));
        });
      } else {
        writeToClient(client, colorize(`  None\r\n`, 'white'));
      }
      
      // Currency
      writeToClient(client, colorize(`\r\nCurrency:\r\n`, 'yellow'));
      writeToClient(client, colorize(`  Gold: ${user.inventory.currency?.gold || 0}\r\n`, 'white'));
      writeToClient(client, colorize(`  Silver: ${user.inventory.currency?.silver || 0}\r\n`, 'white'));
      writeToClient(client, colorize(`  Copper: ${user.inventory.currency?.copper || 0}\r\n`, 'white'));
    }
    
    // Equipment - Updated to show proper item names
    if (user.equipment) {
      writeToClient(client, colorize(`\r\nEquipment:\r\n`, 'yellow'));
      const equipment = user.equipment;
      const slots = Object.keys(equipment);
      
      if (slots.length > 0) {
        slots.forEach(slot => {
          const instanceId = equipment[slot];
          if (instanceId) {
            const displayName = this.getItemDisplayName(instanceId);
            writeToClient(client, colorize(`  ${slot}: ${displayName} [${instanceId.substring(0, 8)}...]\r\n`, 'white'));
          }
        });
      } else {
        writeToClient(client, colorize(`  None\r\n`, 'white'));
      }
    }
  }

  private debugCombat(client: ConnectedClient, roomId: string): void {
    // Default to current room if no ID provided
    if (!roomId && client.user?.currentRoomId) {
      roomId = client.user.currentRoomId;
    }

    if (!roomId) {
      writeToClient(client, colorize('Usage: debug combat <roomId>\r\n', 'yellow'));
      return;
    }

    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      writeToClient(client, colorize(`Room with ID '${roomId}' not found.\r\n`, 'red'));
      return;
    }

    // Get combat status for this room - safely handle missing methods
    const activeCombats = this.safeGetActiveCombats(roomId);
    
    writeToClient(client, colorize(`Combat Status for Room: ${room.id} (${room.name})\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    
    if (activeCombats.length === 0) {
      writeToClient(client, colorize(`No active combat in this room.\r\n`, 'yellow'));
      return;
    }
    
    writeToClient(client, colorize(`Active Combats: ${activeCombats.length}\r\n\r\n`, 'cyan'));
    
    activeCombats.forEach((combat: any, index: number) => {
      writeToClient(client, colorize(`Combat #${index + 1}${combat.id ? ` (ID: ${combat.id})` : ''}:\r\n`, 'yellow'));
      
      // Get the entities involved
      const entities = this.safeGetCombatEntities(combat);
      
      writeToClient(client, colorize(`  Players: ${entities.players.length}\r\n`, 'white'));
      entities.players.forEach((player: any) => {
        writeToClient(client, colorize(`    - ${player.username} (${player.health}/${player.maxHealth} HP)${player.id ? ` [ID: ${player.id}]` : ''}\r\n`, 'white'));
      });
      
      writeToClient(client, colorize(`  NPCs: ${entities.npcs.length}\r\n`, 'white'));
      entities.npcs.forEach((npc: any) => {
        writeToClient(client, colorize(`    - ${npc.name} (${npc.health}/${npc.maxHealth} HP)${npc.instanceId ? ` [ID: ${npc.instanceId}]` : ''}\r\n`, 'white'));
      });
      
      writeToClient(client, colorize(`  Round: ${this.safeGetCombatRound(combat)}\r\n`, 'white'));
      writeToClient(client, colorize(`  Target Mapping:\r\n`, 'white'));
      
      const targetMap = this.safeGetTargetMap(combat);
      Object.entries(targetMap).forEach(([attacker, target]) => {
        writeToClient(client, colorize(`    ${attacker} -> ${target}\r\n`, 'white'));
      });
      
      writeToClient(client, '\r\n');
    });
  }

  private debugSystem(client: ConnectedClient): void {
    const startTime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    writeToClient(client, colorize(`System Information\r\n`, 'green'));
    writeToClient(client, colorize(`-----------------------------------------\r\n`, 'green'));
    
    // Uptime
    const uptime = this.formatUptime(startTime);
    writeToClient(client, colorize(`Uptime: ${uptime}\r\n`, 'cyan'));
    
    // Memory usage
    writeToClient(client, colorize(`\r\nMemory Usage:\r\n`, 'yellow'));
    writeToClient(client, colorize(`  RSS: ${this.formatBytes(memoryUsage.rss)}\r\n`, 'white'));
    writeToClient(client, colorize(`  Heap Total: ${this.formatBytes(memoryUsage.heapTotal)}\r\n`, 'white'));
    writeToClient(client, colorize(`  Heap Used: ${this.formatBytes(memoryUsage.heapUsed)}\r\n`, 'white'));
    writeToClient(client, colorize(`  External: ${this.formatBytes(memoryUsage.external)}\r\n`, 'white'));
    
    // Game statistics
    writeToClient(client, colorize(`\r\nGame Statistics:\r\n`, 'yellow'));
    writeToClient(client, colorize(`  Rooms: ${this.roomManager.getAllRooms().length}\r\n`, 'white'));
    
    // Get connected clients safely
    const clients = this.userManager.getAllUsers().filter(user => 
      this.userManager.isUserActive(user.username)
    );
    writeToClient(client, colorize(`  Connected Players: ${clients.length}\r\n`, 'white'));
    writeToClient(client, colorize(`  Total Users: ${this.userManager.getAllUsers().length}\r\n`, 'white'));
    
    // NPC templates
    const npcTemplates = NPC.loadNPCData();
    writeToClient(client, colorize(`  NPC Templates: ${npcTemplates.size}\r\n`, 'white'));
    
    // Live NPCs
    let liveNPCCount = 0;
    this.roomManager.getAllRooms().forEach(room => {
      liveNPCCount += room.npcs.size;
    });
    writeToClient(client, colorize(`  Live NPCs: ${liveNPCCount}\r\n`, 'white'));
    
    // Active combats
    let totalCombats = 0;
    this.roomManager.getAllRooms().forEach(room => {
      totalCombats += this.safeGetActiveCombats(room.id).length;
    });
    writeToClient(client, colorize(`  Active Combats: ${totalCombats}\r\n`, 'white'));

    // Add instance ID info to system report
    writeToClient(client, colorize(`\r\nInstance Information:\r\n`, 'yellow'));
    const instanceId = process.env.INSTANCE_ID || 'default';
    writeToClient(client, colorize(`  Instance ID: ${instanceId}\r\n`, 'white'));
  }

  // Safe accessor methods to handle potential missing methods on CombatSystem
  private safeGetActiveCombats(roomId: string): any[] {
    try {
      const cs = this.combatSystem as any; // Cast to any
      // Check if the method exists on the combat system
      if (typeof cs['getActiveCombatsInRoom'] === 'function') {
        return cs['getActiveCombatsInRoom'](roomId);
      }
      // Fallback - assume there's a property or alternative method
      if (cs['activeCombats'] && typeof cs['activeCombats'] === 'object') {
        return Object.values(cs['activeCombats']).filter((combat: any) => 
          combat.roomId === roomId || combat.room?.id === roomId
        );
      }
      console.error('CombatSystem.getActiveCombatsInRoom method or activeCombats property not found');
      return [];
    } catch (error) {
      console.error('Error accessing combat data:', error);
      return [];
    }
  }

  private safeGetCombatEntities(combat: any): { players: any[], npcs: any[] } {
    try {
      const cs = this.combatSystem as any; // Cast to any
      if (typeof cs['getCombatEntities'] === 'function') {
        return cs['getCombatEntities'](combat);
      }
      // Fallback - try to extract entities from combat object
      const players = combat.players || combat.entities?.filter((e: any) => e.type === 'player') || [];
      const npcs = combat.npcs || combat.entities?.filter((e: any) => e.type === 'npc') || [];
      return { players, npcs };
    } catch (error) {
      console.error('Error accessing combat entities:', error);
      return { players: [], npcs: [] };
    }
  }

  private safeGetCombatRound(combat: any): number {
    try {
      const cs = this.combatSystem as any; // Cast to any
      if (typeof cs['getCombatRound'] === 'function') {
        return cs['getCombatRound'](combat);
      }
      // Fallback - try to get round directly from combat object
      return combat.round || combat.currentRound || 0;
    } catch (error) {
      console.error('Error accessing combat round:', error);
      return 0;
    }
  }

  private safeGetTargetMap(combat: any): Record<string, string> {
    try {
      const cs = this.combatSystem as any; // Cast to any
      if (typeof cs['getTargetMap'] === 'function') {
        return cs['getTargetMap'](combat);
      }
      // Fallback - try to get target map directly from combat object
      return combat.targetMap || combat.targets || {};
    } catch (error) {
      console.error('Error accessing target map:', error);
      return {};
    }
  }

  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}