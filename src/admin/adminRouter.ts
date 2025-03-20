// ...existing code...
import { 
  getServerStats, 
  getPlayerDetails, 
  kickPlayer,
  monitorPlayer
} from './adminApi';

// ...existing code...

// Player management routes
router.get('/players', authenticateJWT, getPlayerDetails(clients, userManager));
router.post('/players/:clientId/kick', authenticateJWT, kickPlayer(clients));
router.post('/players/:clientId/monitor', authenticateJWT, monitorPlayer(clients));

// ...existing code...
