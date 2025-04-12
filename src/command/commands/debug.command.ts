import { ConnectedClient } from '../../types';
import { colorize } from '../../utils/colors';
import { writeToClient } from '../../utils/socketWriter';
import { Command } from '../command.interface';
import { RoomManager } from '../../room/roomManager';
import { NPC, NPCData } from '../../combat/npc';
import { UserManager } from '../../user/userManager';
import { SudoCommand } from './sudo.command';
import { CombatSystem } from '../../combat/combatSystem';

export class DebugCommand implements Command {
  name = 'debug';
  description = 'Inspect game elements and data (admin only)';

  constructor(
    private roomManager: RoomManager,
    private userManager: UserManager,
    private combatSystem: CombatSystem
  ) {}

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
    writeToClient(client, colorize('  system          - Show system information\r\n', 'white'));
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
    
    // Players
    writeToClient(client, colorize(`\r\nPlayers (${room.players.length}):\r\n`, 'yellow'));
    if (room.players.length > 0) {
      room.players.forEach((player, index) => {
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
    
    // Items
    writeToClient(client, colorize(`\r\nItems (${room.items.length}):\r\n`, 'yellow'));
    if (room.items.length > 0) {
      room.items.forEach((item, index) => {
        const itemName = typeof item === 'string' ? item : item.name;
        writeToClient(client, colorize(`  ${index + 1}. ${itemName}\r\n`, 'white'));
      });
    } else {
      writeToClient(client, colorize(`  None\r\n`, 'white'));
    }
    
    // Currency
    writeToClient(client, colorize(`\r\nCurrency:\r\n`, 'yellow'));
    writeToClient(client, colorize(`  Gold: ${room.currency.gold}\r\n`, 'white'));
    writeToClient(client, colorize(`  Silver: ${room.currency.silver}\r\n`, 'white'));
    writeToClient(client, colorize(`  Copper: ${room.currency.copper}\r\n`, 'white'));
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
    
    // Inventory
    if (user.inventory) {
      writeToClient(client, colorize(`\r\nInventory Items (${user.inventory.items?.length || 0}):\r\n`, 'yellow'));
      if (user.inventory.items && user.inventory.items.length > 0) {
        user.inventory.items.forEach((item, index) => {
          writeToClient(client, colorize(`  ${index + 1}. ${item}\r\n`, 'white'));
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
    
    // Equipment
    if (user.equipment) {
      writeToClient(client, colorize(`\r\nEquipment:\r\n`, 'yellow'));
      const equipment = user.equipment;
      const slots = Object.keys(equipment);
      
      if (slots.length > 0) {
        slots.forEach(slot => {
          const item = equipment[slot];
          if (item) {
            writeToClient(client, colorize(`  ${slot}: ${item}\r\n`, 'white'));
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