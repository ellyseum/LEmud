import { INPCInteractionService } from '../interfaces';
import { Room } from '../room';
import { NPC } from '../../combat/npc';
import { systemLogger } from '../../utils/logger';

export class NPCInteractionService implements INPCInteractionService {
  private roomManager: {
    updateRoom: (room: Room) => void;
  };

  constructor(
    roomManager: {
      updateRoom: (room: Room) => void;
    }
  ) {
    this.roomManager = roomManager;
  }

  /**
   * Instantiate NPCs from templates and add them to the room
   * @param room The room to add NPCs to
   * @param npcTemplateIds Array of NPC template IDs
   * @param npcData Map of NPC template data
   */
  public instantiateNpcsFromTemplates(room: Room, npcTemplateIds: string[], npcData: Map<string, any>): void {
    if (!npcTemplateIds.length) return;
    
    systemLogger.info(`Instantiating ${npcTemplateIds.length} NPC(s) for room ${room.id}`);
    
    for (const templateId of npcTemplateIds) {
      // Check if the template exists in our NPC data
      if (npcData.has(templateId)) {
        // Create a new NPC instance from the template
        const npcTemplate = npcData.get(templateId);
        const npc = NPC.fromNPCData(npcTemplate);
        
        // Add the NPC to the room
        room.addNPC(npc);
        systemLogger.info(`Added NPC instance ${npc.instanceId} (template: ${templateId}) to room ${room.id}`);
      } else {
        // If template doesn't exist, log a warning and try to create a basic NPC
        systemLogger.warn(`NPC template '${templateId}' not found in data, creating basic NPC`);
        const defaultNpc = new NPC(
          templateId, // Use template ID as name
          10,        // health
          10,        // maxHealth
          [1, 2],    // damage range
          false,     // isHostile
          false,     // isPassive
          50         // experienceValue
        );
        room.addNPC(defaultNpc);
        systemLogger.info(`Added default NPC instance ${defaultNpc.instanceId} (template: ${templateId}) to room ${room.id}`);
      }
    }
  }

  /**
   * Initialize NPCs in a specific room
   */
  public initializeNPCsInRoom(room: Room): void {
    // Load NPC data from JSON
    const npcData = NPC.loadNPCData();
    
    // Clear existing NPCs first
    room.npcs.clear();
    
    // Add NPCs based on room type or ID
    if (room.id === 'start') {
      // Add 2 cats to the starting room
      for (let i = 0; i < 2; i++) {
        // Check if cat is defined in our NPC data
        if (npcData.has('cat')) {
          const npcTemplate = npcData.get('cat')!;
          const npc = NPC.fromNPCData(npcTemplate);
          room.addNPC(npc);
        } else {
          systemLogger.warn('Cat NPC not found in data, using default values');
          const catNPC = new NPC('cat', 10, 10, [1, 3], false, false, 75);
          room.addNPC(catNPC);
        }
      }
      
      // Add a dog to the room
      if (npcData.has('dog')) {
        const npcTemplate = npcData.get('dog')!;
        const npc = NPC.fromNPCData(npcTemplate);
        room.addNPC(npc);
      }
    }
    
    // Update the room to persist NPC changes
    this.roomManager.updateRoom(room);
  }
}