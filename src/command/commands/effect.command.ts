// filepath: /Users/jelden/projects/game/src/command/commands/effect.command.ts
import { Command } from '../command.interface';
import { ConnectedClient } from '../../types';
import { writeFormattedMessageToClient } from '../../utils/socketWriter';
import { UserManager } from '../../user/userManager';
import { RoomManager } from '../../room/roomManager';
import { EffectManager } from '../../effects/effectManager';
import { EffectType } from '../../types/effects';
import { NPC } from '../../combat/npc';

export class EffectCommand implements Command {
  name = 'effect';
  description = 'Apply or remove temporary effects';
  usage = 'effect <apply|remove|list> [target] [type] [duration] [arguments...]';
  aliases = ['effects'];
  requiresAuthentication = true;
  requiresAdmin = true;  // Only admins can use for now

  private userManager: UserManager;
  private roomManager: RoomManager;
  private effectManager: EffectManager;

  constructor(userManager: UserManager, roomManager: RoomManager) {
    this.userManager = userManager;
    this.roomManager = roomManager;
    this.effectManager = EffectManager.getInstance(userManager, roomManager);
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) {
      writeFormattedMessageToClient(client, '\r\nYou must be logged in to use this command.\r\n');
      return;
    }

    const argsArray = args.trim().split(' ').filter(Boolean);
    
    if (argsArray.length === 0) {
      this.showHelp(client);
      return;
    }

    const subcommand = argsArray[0].toLowerCase();
    
    switch (subcommand) {
      case 'apply':
        this.applyEffect(client, argsArray.slice(1));
        break;
      case 'remove':
        this.removeEffect(client, argsArray.slice(1));
        break;
      case 'list':
        this.listEffects(client, argsArray.slice(1));
        break;
      default:
        this.showHelp(client);
    }
  }

  private applyEffect(client: ConnectedClient, args: string[]): void {
    // Validate args
    if (args.length < 3) {
      writeFormattedMessageToClient(
        client,
        '\r\n\x1b[31mUsage: effect apply <target> <type> <duration> [tick_interval] [damage/heal] [real_time_ms] [block_movement]\x1b[0m\r\n'
      );
      return;
    }

    // Ensure client.user is not null
    if (!client.user) {
      writeFormattedMessageToClient(client, '\r\nYou must be logged in to use this command.\r\n');
      return;
    }

    const targetName = args[0];
    const effectTypeStr = args[1].toUpperCase();
    const durationTicks = parseInt(args[2], 10);
    const tickInterval = args.length > 3 ? parseInt(args[3], 10) : 1;
    const amount = args.length > 4 ? parseInt(args[4], 10) : 0;
    const realTimeMs = args.length > 5 ? parseInt(args[5], 10) : 0;
    const blockMovement = args.length > 6 ? args[6].toLowerCase() === 'true' : false;

    // Validate effect type
    if (!Object.keys(EffectType).includes(effectTypeStr)) {
      writeFormattedMessageToClient(
        client,
        `\r\n\x1b[31mInvalid effect type. Valid types: ${Object.keys(EffectType).join(', ')}\x1b[0m\r\n`
      );
      return;
    }

    const effectType = EffectType[effectTypeStr as keyof typeof EffectType];

    // Find the target (player or NPC)
    const targetClient = this.userManager.getActiveUserSession(targetName);
    let isPlayer = true;
    let targetId = targetName;
    let targetDisplayName = targetName;
    
    if (!targetClient) {
      // Not a player, check if it's an NPC in the current room
      isPlayer = false;
      
      const roomId = client.user.currentRoomId;
      if (!roomId) {
        writeFormattedMessageToClient(
          client,
          `\r\n\x1b[31mError: You're not in a valid room.\x1b[0m\r\n`
        );
        return;
      }
      
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        writeFormattedMessageToClient(
          client,
          `\r\n\x1b[31mError: Could not find your current room.\x1b[0m\r\n`
        );
        return;
      }
      
      // Try to find an NPC with the given instance ID first
      let npc = room.getNPC(targetName);
      
      // If not found by instance ID, try to find by name (template ID)
      if (!npc) {
        const matchingNPCs = room.findNPCsByTemplateId(targetName);
        if (matchingNPCs.length > 0) {
          npc = matchingNPCs[0];
        } else {
          // Try to find by name
          const npcsMatchingName = Array.from(room.npcs.values()).filter(n => 
            n.name.toLowerCase() === targetName.toLowerCase());
          
          if (npcsMatchingName.length > 0) {
            npc = npcsMatchingName[0];
          }
        }
      }
      
      if (!npc) {
        writeFormattedMessageToClient(
          client,
          `\r\n\x1b[31mTarget NPC '${targetName}' not found in your room.\x1b[0m\r\n`
        );
        return;
      }
      
      targetId = npc.instanceId;
      targetDisplayName = npc.name;
    }

    // Create effect payload based on effect type
    const effectPayload: any = {};
    
    if (amount > 0) {
      if (effectType === EffectType.POISON || effectType === EffectType.DAMAGE_OVER_TIME) {
        effectPayload.damagePerTick = amount;
      } else if (effectType === EffectType.REGEN || effectType === EffectType.HEAL_OVER_TIME) {
        effectPayload.healPerTick = amount;
      } else {
        // Assume it's a stat modifier effect
        effectPayload.statModifiers = {};
        
        switch(effectType) {
          case EffectType.STRENGTH_BUFF:
            effectPayload.statModifiers.strength = amount;
            break;
          case EffectType.AGILITY_BUFF:
            effectPayload.statModifiers.agility = amount;
            break;
          case EffectType.ATTACK_BUFF:
            effectPayload.statModifiers.attack = amount;
            break;
          case EffectType.DEFENSE_BUFF:
            effectPayload.statModifiers.defense = amount;
            break;
          // Add more stat modifiers as needed
        }
      }
    }
    
    if (blockMovement) {
      effectPayload.blockMovement = true;
    }
    
    if (effectType === EffectType.MOVEMENT_BLOCK) {
      effectPayload.blockMovement = true;
    }
    
    if (effectType === EffectType.STUN) {
      effectPayload.blockMovement = true;
      effectPayload.blockCombat = true;
    }

    // Apply the effect
    this.effectManager.addEffect(targetId, isPlayer, {
      type: effectType,
      name: this.getEffectName(effectType),
      description: this.getEffectDescription(effectType, amount),
      durationTicks: durationTicks,
      isTimeBased: realTimeMs > 0,
      tickInterval: tickInterval,
      realTimeIntervalMs: realTimeMs > 0 ? realTimeMs : undefined,
      payload: effectPayload,
      targetId: targetId,
      isPlayerEffect: isPlayer,
      sourceId: client.user.username,
    });

    writeFormattedMessageToClient(
      client,
      `\r\n\x1b[32mApplied ${effectType} effect to ${targetDisplayName} (${targetId}) for ${durationTicks} ticks.\x1b[0m\r\n`
    );
  }

  private removeEffect(client: ConnectedClient, args: string[]): void {
    if (args.length < 1) {
      writeFormattedMessageToClient(
        client,
        '\r\n\x1b[31mUsage: effect remove <target> [effect_id]\x1b[0m\r\n'
      );
      return;
    }

    // Ensure client.user is not null
    if (!client.user) {
      writeFormattedMessageToClient(client, '\r\nYou must be logged in to use this command.\r\n');
      return;
    }

    const targetName = args[0];
    let targetId = targetName;
    let targetDisplayName = targetName;
    let isPlayer = true;
    
    // Find the target (player or NPC)
    const targetClient = this.userManager.getActiveUserSession(targetName);
    
    if (!targetClient) {
      // Not a player, check if it's an NPC
      isPlayer = false;
      
      const roomId = client.user.currentRoomId;
      if (!roomId) {
        writeFormattedMessageToClient(
          client,
          `\r\n\x1b[31mError: You're not in a valid room.\x1b[0m\r\n`
        );
        return;
      }
      
      const room = this.roomManager.getRoom(roomId);
      if (!room) {
        writeFormattedMessageToClient(
          client,
          `\r\n\x1b[31mError: Could not find your current room.\x1b[0m\r\n`
        );
        return;
      }
      
      // Try to find NPC by instance ID first
      let npc = room.getNPC(targetName);
      
      // If not found by instance ID, try to find by name or template ID
      if (!npc) {
        const matchingNPCs = room.findNPCsByTemplateId(targetName);
        if (matchingNPCs.length > 0) {
          npc = matchingNPCs[0];
        } else {
          // Try to find by name
          const npcsMatchingName = Array.from(room.npcs.values()).filter(n => 
            n.name.toLowerCase() === targetName.toLowerCase());
          
          if (npcsMatchingName.length > 0) {
            npc = npcsMatchingName[0];
          }
        }
      }
      
      if (!npc) {
        writeFormattedMessageToClient(
          client,
          `\r\n\x1b[31mTarget NPC '${targetName}' not found in your room.\x1b[0m\r\n`
        );
        return;
      }
      
      targetId = npc.instanceId;
      targetDisplayName = npc.name;
    }

    // Get effects for the target
    const effects = this.effectManager.getEffectsForTarget(targetId, isPlayer);
    
    if (effects.length === 0) {
      writeFormattedMessageToClient(
        client,
        `\r\n\x1b[33m${targetDisplayName} has no active effects.\x1b[0m\r\n`
      );
      return;
    }

    if (args.length >= 2) {
      // Remove specific effect by ID
      const effectId = args[1];
      const effect = effects.find(e => e.id === effectId);
      
      if (!effect) {
        writeFormattedMessageToClient(
          client,
          `\r\n\x1b[31mNo effect with ID ${effectId} found on ${targetDisplayName}.\x1b[0m\r\n`
        );
        return;
      }
      
      this.effectManager.removeEffect(effectId);
      writeFormattedMessageToClient(
        client,
        `\r\n\x1b[32mRemoved effect ${effect.name} from ${targetDisplayName}.\x1b[0m\r\n`
      );
    } else {
      // Remove all effects
      let count = 0;
      for (const effect of effects) {
        this.effectManager.removeEffect(effect.id);
        count++;
      }
      
      writeFormattedMessageToClient(
        client,
        `\r\n\x1b[32mRemoved ${count} effects from ${targetDisplayName}.\x1b[0m\r\n`
      );
    }
  }

  private listEffects(client: ConnectedClient, args: string[]): void {
    // Ensure client.user is not null
    if (!client.user) {
      writeFormattedMessageToClient(client, '\r\nYou must be logged in to use this command.\r\n');
      return;
    }
    
    let targetId = client.user.username;
    let targetDisplayName = client.user.username; 
    let isPlayer = true;
    
    if (args.length > 0) {
      const targetName = args[0];
      
      // First check if it's a player
      const targetClient = this.userManager.getActiveUserSession(targetName);
      
      if (targetClient) {
        targetId = targetName;
        targetDisplayName = targetName;
      } else {
        // Not a player, check if it's an NPC
        isPlayer = false;
        
        const roomId = client.user.currentRoomId;
        if (!roomId) {
          writeFormattedMessageToClient(
            client,
            `\r\n\x1b[31mError: You're not in a valid room.\x1b[0m\r\n`
          );
          return;
        }
        
        const room = this.roomManager.getRoom(roomId);
        if (!room) {
          writeFormattedMessageToClient(
            client,
            `\r\n\x1b[31mError: Could not find your current room.\x1b[0m\r\n`
          );
          return;
        }
        
        // Try to find NPC by instance ID first
        let npc = room.getNPC(targetName);
        
        // If not found by instance ID, try to find by name or template ID
        if (!npc) {
          const matchingNPCs = room.findNPCsByTemplateId(targetName);
          if (matchingNPCs.length > 0) {
            npc = matchingNPCs[0];
          } else {
            // Try to find by name
            const npcsMatchingName = Array.from(room.npcs.values()).filter(n => 
              n.name.toLowerCase() === targetName.toLowerCase());
            
            if (npcsMatchingName.length > 0) {
              npc = npcsMatchingName[0];
            }
          }
        }
        
        if (!npc) {
          writeFormattedMessageToClient(
            client,
            `\r\n\x1b[31mTarget '${targetName}' not found in your room.\x1b[0m\r\n`
          );
          return;
        }
        
        targetId = npc.instanceId;
        targetDisplayName = npc.name;
      }
    }

    // Get effects for the target
    const effects = this.effectManager.getEffectsForTarget(targetId, isPlayer);
    
    if (effects.length === 0) {
      writeFormattedMessageToClient(
        client,
        `\r\n\x1b[33m${targetDisplayName} has no active effects.\x1b[0m\r\n`
      );
      return;
    }

    writeFormattedMessageToClient(
      client,
      `\r\n\x1b[36mActive effects on ${targetDisplayName} (${targetId}):\x1b[0m\r\n`
    );
    
    for (const effect of effects) {
      let effectInfo = `ID: ${effect.id}\r\n`;
      effectInfo += `Type: ${effect.type}\r\n`;
      effectInfo += `Name: ${effect.name}\r\n`;
      effectInfo += `Description: ${effect.description}\r\n`;
      effectInfo += `Duration: ${effect.remainingTicks}/${effect.durationTicks} ticks\r\n`;
      
      if (effect.isTimeBased) {
        effectInfo += `Time-based: Yes (${effect.realTimeIntervalMs}ms)\r\n`;
      } else if (effect.tickInterval > 0) {
        effectInfo += `Tick interval: Every ${effect.tickInterval} game ticks\r\n`;
      }
      
      // Show payload details
      if (effect.payload.damagePerTick) {
        effectInfo += `Damage per tick: ${effect.payload.damagePerTick}\r\n`;
      }
      if (effect.payload.healPerTick) {
        effectInfo += `Heal per tick: ${effect.payload.healPerTick}\r\n`;
      }
      if (effect.payload.statModifiers) {
        effectInfo += 'Stat modifiers:\r\n';
        for (const [stat, value] of Object.entries(effect.payload.statModifiers)) {
          effectInfo += `  ${stat}: ${value > 0 ? '+' : ''}${value}\r\n`;
        }
      }
      if (effect.payload.blockMovement) {
        effectInfo += 'Blocks movement: Yes\r\n';
      }
      if (effect.payload.blockCombat) {
        effectInfo += 'Blocks combat: Yes\r\n';
      }
      
      // Add a separator between effects
      effectInfo += '----------------------\r\n';
      
      writeFormattedMessageToClient(client, effectInfo);
    }
  }

  private showHelp(client: ConnectedClient): void {
    let helpText = '\r\n\x1b[36mEffect Command Usage:\x1b[0m\r\n';
    helpText += 'effect apply <target> <type> <duration> [tick_interval] [amount] [real_time_ms] [block_movement]\r\n';
    helpText += 'effect remove <target> [effect_id]\r\n';
    helpText += 'effect list [target]\r\n\r\n';
    
    helpText += 'Available effect types:\r\n';
    for (const type of Object.keys(EffectType)) {
      helpText += `  ${type}\r\n`;
    }
    
    helpText += '\r\nExamples:\r\n';
    helpText += '  effect apply player1 POISON 10 1 5 0 false - Apply poison that deals 5 damage every game tick for 10 ticks\r\n';
    helpText += '  effect apply player1 HEAL_OVER_TIME 10 0 5 1000 false - Apply heal that gives 5 health every second for 10 game ticks\r\n';
    helpText += '  effect apply player1 STRENGTH_BUFF 20 0 5 0 false - Apply strength buff of +5 for 20 game ticks\r\n';
    helpText += '  effect apply player1 MOVEMENT_BLOCK 5 0 0 0 true - Prevent movement for 5 game ticks\r\n';
    
    writeFormattedMessageToClient(client, helpText);
  }

  private getEffectName(type: EffectType): string {
    switch (type) {
      case EffectType.POISON:
        return "Poison";
      case EffectType.REGEN:
        return "Regeneration";
      case EffectType.STUN:
        return "Stun";
      case EffectType.STRENGTH_BUFF:
        return "Strength Buff";
      case EffectType.AGILITY_BUFF:
        return "Agility Buff";
      case EffectType.DEFENSE_BUFF:
        return "Defense Buff";
      case EffectType.ATTACK_BUFF:
        return "Attack Buff";
      case EffectType.DAMAGE_OVER_TIME:
        return "Damage Over Time";
      case EffectType.HEAL_OVER_TIME:
        return "Heal Over Time";
      case EffectType.MOVEMENT_BLOCK:
        return "Movement Block";
      default:
        return type;
    }
  }

  private getEffectDescription(type: EffectType, amount: number): string {
    switch (type) {
      case EffectType.POISON:
        return `A poison causing ${amount} damage per tick`;
      case EffectType.REGEN:
        return `Regenerates ${amount} health per tick`;
      case EffectType.STUN:
        return "Prevents movement and combat actions";
      case EffectType.STRENGTH_BUFF:
        return `Increases strength by ${amount}`;
      case EffectType.AGILITY_BUFF:
        return `Increases agility by ${amount}`;
      case EffectType.DEFENSE_BUFF:
        return `Increases defense by ${amount}`;
      case EffectType.ATTACK_BUFF:
        return `Increases attack by ${amount}`;
      case EffectType.DAMAGE_OVER_TIME:
        return `Deals ${amount} damage per tick`;
      case EffectType.HEAL_OVER_TIME:
        return `Heals ${amount} health per tick`;
      case EffectType.MOVEMENT_BLOCK:
        return "Prevents movement";
      default:
        return "A mysterious effect";
    }
  }
}