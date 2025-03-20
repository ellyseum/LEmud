// Add these routes to your existing admin API routes

/**
 * GET /api/admin/mud-config
 * Get the MUD configuration
 */
router.get('/mud-config', authenticateAdmin, async (req, res) => {
    try {
        // Replace this with actual configuration loading from your system
        const config = {
            dataFiles: {
                players: './data/players.json',
                rooms: './data/rooms.json',
                items: './data/items.json',
                npcs: './data/npcs.json'
            },
            game: {
                startingRoom: 'town-square',
                maxPlayers: 100,
                idleTimeout: 30,
                maxPasswordAttempts: 5
            },
            advanced: {
                debugMode: false,
                allowRegistration: true,
                backupInterval: 6,
                logLevel: 'info'
            }
        };
        
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
        
        // Implement actual configuration saving here
        // This would typically write to a config file or database
        
        console.log('New MUD configuration:', newConfig);
        
        // Return success
        res.json({
            success: true,
            message: 'Configuration updated successfully'
        });
    } catch (error) {
        console.error('Error updating MUD configuration:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update configuration'
        });
    }
});
