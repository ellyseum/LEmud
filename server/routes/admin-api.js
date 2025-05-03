const express = require('express');
const router = express.Router();
const { authenticateAdmin } = require('../middleware/auth');
const { loadMUDConfig, saveMUDConfig } = require('../../src/admin/adminApi');

/**
 * GET /api/admin/mud-config
 * Get the MUD configuration
 */
router.get('/mud-config', authenticateAdmin, async (req, res) => {
    try {
        const config = await loadMUDConfig();
        res.json({
            success: true,
            config
        });
    } catch (error) {
        console.error('Error getting MUD configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve configuration'
        });
    }
});

/**
 * POST /api/admin/mud-config
 * Update the MUD configuration
 */
router.post('/mud-config', authenticateAdmin, async (req, res) => {
    try {
        const newConfig = req.body;
        
        // Validate required fields
        if (!newConfig.dataFiles || !newConfig.game || !newConfig.advanced) {
            return res.status(400).json({
                success: false,
                message: 'Missing required configuration sections'
            });
        }
        
        if (await saveMUDConfig(newConfig)) {
            res.json({
                success: true,
                message: 'Configuration updated successfully'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to save configuration'
            });
        }
    } catch (error) {
        console.error('Error updating MUD configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update configuration'
        });
    }
});

/**
 * PUT /api/admin/players/:username
 * Update a player's data
 */
router.put('/players/:username', authenticateAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        const updateData = req.body;
        
        // Get the user manager instance
        const userManager = req.app.get('userManager');
        
        // Handle password change separately if provided
        if (updateData.newPassword) {
            const success = userManager.changeUserPassword(username, updateData.newPassword);
            if (!success) {
                return res.status(404).json({
                    success: false,
                    message: `User ${username} not found`
                });
            }
            // Remove from update data after processing
            delete updateData.newPassword;
        }
        
        // Update the rest of the user data
        // ...existing code...
        
        res.json({
            success: true,
            message: 'Player updated successfully'
        });
    } catch (error) {
        console.error('Error updating player:', error);
        res.status(500).json({
            success: false,
            message: `Error updating player: ${error.message}`
        });
    }
});

module.exports = router;
