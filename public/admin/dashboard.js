document.addEventListener('DOMContentLoaded', () => {
    // Check if user is logged in
    const token = localStorage.getItem('mudAdminToken');
    if (!token) {
        window.location.href = '/admin/login.html';
        return;
    }

    // Logout handler
    document.getElementById('logout-button').addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('mudAdminToken');
        window.location.href = '/admin/login.html';
    });

    // Refresh players button - use the new function that preserves state
    document.getElementById('refresh-players').addEventListener('click', () => {
        refreshPlayersPreservingState();
    });

    // Custom tab handling - completely replace Bootstrap's tab system
    function activateTab(tabId) {
        // Update tab nav links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-tab-target="${tabId}"]`).classList.add('active');
        
        // Update tab panes
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('show', 'active');
        });
        document.querySelector(tabId).classList.add('show', 'active');
    }
    
    // Set up tab click handlers
    document.querySelectorAll('[data-tab-target]').forEach(tabLink => {
        tabLink.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.currentTarget.getAttribute('data-tab-target');
            activateTab(target);
        });
    });

    // Fetch initial data
    fetchServerStats();
    fetchPlayerData();
    fetchGameTimerConfig();

    // Set up polling for stats and player data
    setInterval(fetchServerStats, 5000);
    setInterval(() => {
        // Auto-refresh players every 10 seconds
        refreshPlayersPreservingState();
    }, 10000);

    let kickClientId = null;
    const kickPlayerModal = new bootstrap.Modal(document.getElementById('kickPlayerModal'));
    
    document.getElementById('confirm-kick').addEventListener('click', async () => {
        if (!kickClientId) return;
        
        try {
            const response = await fetch(`/api/admin/players/${kickClientId}/kick`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                kickPlayerModal.hide();
                
                // Instead of refreshing the entire player list, just remove the kicked player
                const kickedPlayerElement = document.querySelector(`#collapse-${kickClientId}`).closest('.accordion-item');
                if (kickedPlayerElement) {
                    // Fade out animation before removal
                    kickedPlayerElement.style.transition = 'opacity 0.5s';
                    kickedPlayerElement.style.opacity = '0';
                    
                    // Remove element after animation
                    setTimeout(() => {
                        kickedPlayerElement.remove();
                        
                        // Check if there are any players left
                        // Fix: Use the correct selector (#player-accordion instead of .player-accordion)
                        const remainingPlayers = document.querySelectorAll('#player-accordion .accordion-item');
                        if (remainingPlayers.length === 0) {
                            const playerAccordion = document.getElementById('player-accordion');
                            if (playerAccordion) {
                                const noPlayersMessage = document.createElement('div');
                                noPlayersMessage.id = 'no-players-message';
                                noPlayersMessage.className = 'text-center text-muted';
                                noPlayersMessage.textContent = "No active players connected";
                                playerAccordion.appendChild(noPlayersMessage);
                            }
                        }
                    }, 500);
                }
            } else {
                alert('Failed to kick player: ' + (data.message || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error kicking player:', error);
            alert('Error kicking player');
        }
    });

    // Format bytes to human-readable format
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // Format seconds to human-readable time
    function formatTime(seconds) {
        const days = Math.floor(seconds / 86400);
        seconds %= 86400;
        const hours = Math.floor(seconds / 3600);
        seconds %= 3600;
        const minutes = Math.floor(seconds / 60);
        seconds %= 60;
        
        let result = '';
        if (days > 0) result += `${days}d `;
        if (hours > 0 || days > 0) result += `${hours}h `;
        if (minutes > 0 || hours > 0 || days > 0) result += `${minutes}m `;
        result += `${seconds}s`;
        
        return result;
    }

    // Fetch server stats from API
    async function fetchServerStats() {
        try {
            const response = await fetch('/api/admin/stats', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.status === 401) {
                // Token expired or invalid
                localStorage.removeItem('mudAdminToken');
                window.location.href = '/admin/login.html';
                return;
            }
            
            const data = await response.json();
            
            if (data.success) {
                const stats = data.stats;
                
                // Update the UI with stats
                document.getElementById('server-uptime').textContent = formatTime(stats.uptime);
                document.getElementById('connected-clients').textContent = stats.connectedClients;
                document.getElementById('authenticated-users').textContent = stats.authenticatedUsers;
                document.getElementById('total-connections').textContent = stats.totalConnections;
                document.getElementById('total-commands').textContent = stats.totalCommands;
                
                // Memory usage
                document.getElementById('memory-rss').textContent = formatBytes(stats.memoryUsage.rss);
                document.getElementById('memory-heap-total').textContent = formatBytes(stats.memoryUsage.heapTotal);
                document.getElementById('memory-heap-used').textContent = formatBytes(stats.memoryUsage.heapUsed);
                document.getElementById('memory-external').textContent = formatBytes(stats.memoryUsage.external);
            }
        } catch (error) {
            console.error('Error fetching server stats:', error);
            document.getElementById('server-status').textContent = 'Error';
            document.getElementById('server-status').className = 'badge bg-danger';
        }
    }

    // Fetch game timer configuration
    async function fetchGameTimerConfig() {
        try {
            const response = await fetch('/api/admin/gametimer-config', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.status === 401) {
                // Token expired or invalid
                localStorage.removeItem('mudAdminToken');
                window.location.href = '/admin/login.html';
                return;
            }
            
            const data = await response.json();
            
            if (data.success) {
                const config = data.config;
                
                // Update the form fields
                document.getElementById('tick-interval').value = config.tickInterval;
                document.getElementById('save-interval').value = config.saveInterval;
            }
        } catch (error) {
            console.error('Error fetching game timer configuration:', error);
            alert('Failed to load game timer configuration');
        }
    }

    // Save game timer configuration
    async function saveGameTimerConfig() {
        try {
            const tickInterval = parseInt(document.getElementById('tick-interval').value);
            const saveInterval = parseInt(document.getElementById('save-interval').value);
            
            // Basic validation
            if (isNaN(tickInterval) || tickInterval < 1000) {
                alert('Tick interval must be at least 1000ms (1 second)');
                return;
            }
            
            if (isNaN(saveInterval) || saveInterval < 1) {
                alert('Save interval must be at least 1 tick');
                return;
            }
            
            const response = await fetch('/api/admin/gametimer-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    tickInterval,
                    saveInterval
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert('Game timer configuration updated successfully');
                fetchGameTimerConfig(); // Refresh to show server values
            } else {
                alert('Failed to update configuration: ' + (data.message || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving game timer configuration:', error);
            alert('Error saving configuration: ' + error.message);
        }
    }

    // Force an immediate save
    async function forceSaveData() {
        try {
            const response = await fetch('/api/admin/force-save', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert('Game data saved successfully');
            } else {
                alert('Failed to save data: ' + (data.message || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error forcing save:', error);
            alert('Error saving data: ' + error.message);
        }
    }

    // Function to refresh players while preserving accordion open states
    function refreshPlayersPreservingState() {
        // Store which accordions are currently open
        const openAccordions = [];
        document.querySelectorAll('.accordion-collapse.show').forEach(el => {
            const playerId = el.id.replace('collapse-', '');
            if (playerId) {
                openAccordions.push(playerId);
            }
        });
        
        // Fetch new player data
        fetchPlayerData(openAccordions);
    }

    // Fetch player data from API
    async function fetchPlayerData(openAccordions = []) {
        try {
            // Get DOM elements with null checks
            const playerAccordion = document.getElementById('player-accordion');
            if (!playerAccordion) {
                console.error('Error: player-accordion element not found in DOM');
                return;
            }
            
            // Only show loading indicator if we're not preserving state (initial load)
            const noPlayersMessage = document.getElementById('no-players-message');
            if (openAccordions.length === 0 && noPlayersMessage) {
                noPlayersMessage.textContent = "Loading players...";
                noPlayersMessage.style.display = 'block';
            }
            
            const response = await fetch('/api/admin/players', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.status === 401) {
                // Token expired or invalid
                localStorage.removeItem('mudAdminToken');
                window.location.href = '/admin/login.html';
                return;
            }
            
            const data = await response.json();
            
            // Clear existing player entries only after successful data fetch
            if (openAccordions.length === 0) {
                playerAccordion.innerHTML = '';
            } else {
                // If preserving state, keep the existing message element if present
                const existingMessage = document.getElementById('no-players-message');
                playerAccordion.innerHTML = '';
                if (existingMessage) {
                    playerAccordion.appendChild(existingMessage);
                }
            }
            
            if (!data.success) {
                console.error('API returned error:', data);
                // Re-create no players message element (since we cleared the container)
                const newMessage = document.createElement('div');
                newMessage.id = 'no-players-message';
                newMessage.className = 'text-center text-muted';
                newMessage.textContent = "Error loading players: " + (data.message || "Unknown error");
                playerAccordion.appendChild(newMessage);
                return;
            }
            
            console.log('Player data received:', data.players);
            
            if (!data.players || data.players.length === 0) {
                // Re-create no players message element
                const newMessage = document.createElement('div');
                newMessage.id = 'no-players-message';
                newMessage.className = 'text-center text-muted';
                newMessage.textContent = "No active players connected";
                playerAccordion.appendChild(newMessage);
                return;
            }
            
            // Add player entries - sort authenticated users first, then non-authenticated
            const sortedPlayers = [...data.players].sort((a, b) => {
                // Sort authenticated users first
                if (a.authenticated && !b.authenticated) return -1;
                if (!a.authenticated && b.authenticated) return 1;
                // Then sort by username
                return a.username.localeCompare(b.username);
            });
            
            sortedPlayers.forEach((player, index) => {
                const accordionItem = document.createElement('div');
                accordionItem.className = 'accordion-item bg-dark border-secondary';
                
                const accordionHeader = document.createElement('h2');
                accordionHeader.className = 'accordion-header';
                accordionHeader.id = `heading-${player.id}`;
                
                const accordionButton = document.createElement('button');
                
                // Set the correct collapsed/expanded state based on previously open accordions
                const isOpen = openAccordions.includes(player.id);
                accordionButton.className = isOpen 
                    ? 'accordion-button bg-dark text-light' 
                    : 'accordion-button bg-dark text-light collapsed';
                
                accordionButton.type = 'button';
                accordionButton.setAttribute('data-bs-toggle', 'collapse');
                accordionButton.setAttribute('data-bs-target', `#collapse-${player.id}`);
                accordionButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                accordionButton.setAttribute('aria-controls', `collapse-${player.id}`);
                
                // Show authentication status with different styling
                const badgeClass = player.authenticated ? 'bg-info' : 'bg-warning text-dark';
                const healthText = player.authenticated ? player.health : 'Login';
                
                accordionButton.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center w-100">
                        <span>${player.username}${player.authenticated ? '' : ' <i>(not authenticated)</i>'}</span>
                        <span class="badge ${badgeClass} ms-2">${healthText}</span>
                    </div>
                `;
                
                accordionHeader.appendChild(accordionButton);
                
                const accordionCollapse = document.createElement('div');
                accordionCollapse.id = `collapse-${player.id}`;
                
                // Set the show class if this accordion was previously open
                accordionCollapse.className = isOpen 
                    ? 'accordion-collapse collapse show' 
                    : 'accordion-collapse collapse';
                
                accordionCollapse.setAttribute('aria-labelledby', `heading-${player.id}`);
                
                const accordionBody = document.createElement('div');
                accordionBody.className = 'accordion-body text-light';
                
                // Customize the display based on authentication status
                if (player.authenticated) {
                    accordionBody.innerHTML = `
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <p><strong>Username:</strong> ${player.username}</p>
                                <p><strong>Connected:</strong> ${new Date(player.connected).toLocaleString()}</p>
                                <p><strong>IP Address:</strong> ${player.ip}</p>
                                <p><strong>Connection Type:</strong> ${player.connectionType}</p>
                            </div>
                            <div class="col-md-6">
                                <p><strong>Current Room:</strong> ${player.currentRoom}</p>
                                <p><strong>Health:</strong> ${player.health}</p>
                                <p><strong>Level:</strong> ${player.level}</p>
                                <p><strong>Experience:</strong> ${player.experience}</p>
                            </div>
                        </div>
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <p><strong>Last Activity:</strong> ${new Date(player.lastActivity).toLocaleString()}</p>
                                <p><strong>Idle Time:</strong> ${formatTime(player.idleTime)}</p>
                            </div>
                            <div class="col-md-6">
                                <div class="d-grid gap-2">
                                    <button class="btn btn-primary monitor-player mb-2" data-id="${player.id}" data-name="${player.username}">
                                        <i class="bi bi-display"></i> Monitor Player
                                    </button>
                                    <button class="btn btn-danger kick-player" data-id="${player.id}" data-name="${player.username}">
                                        <i class="bi bi-x-circle"></i> Kick Player
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                } else {
                    // Simpler display for non-authenticated users
                    accordionBody.innerHTML = `
                        <div class="row mb-3">
                            <div class="col-md-6">
                                <p><strong>Connection Status:</strong> <span class="badge bg-warning text-dark">Not Authenticated</span></p>
                                <p><strong>Connected:</strong> ${new Date(player.connected).toLocaleString()}</p>
                                <p><strong>IP Address:</strong> ${player.ip}</p>
                                <p><strong>Connection Type:</strong> ${player.connectionType}</p>
                            </div>
                            <div class="col-md-6">
                                <p><strong>Current State:</strong> ${player.state}</p>
                                <p><strong>Last Activity:</strong> ${new Date(player.lastActivity).toLocaleString()}</p>
                                <p><strong>Idle Time:</strong> ${formatTime(player.idleTime)}</p>
                                <div class="d-grid gap-2 mt-3">
                                    <button class="btn btn-primary monitor-player mb-2" data-id="${player.id}" data-name="${player.username}">
                                        <i class="bi bi-display"></i> Monitor Connection
                                    </button>
                                    <button class="btn btn-danger kick-player" data-id="${player.id}" data-name="${player.username}">
                                        <i class="bi bi-x-circle"></i> Disconnect User
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }
                
                accordionCollapse.appendChild(accordionBody);
                accordionItem.appendChild(accordionHeader);
                accordionItem.appendChild(accordionCollapse);
                playerAccordion.appendChild(accordionItem);
            });
            
            // Add event handlers for the newly created buttons
            attachPlayerButtonHandlers();
            
        } catch (error) {
            console.error('Error fetching player data:', error);
            
            // Get player accordion with null check
            const playerAccordion = document.getElementById('player-accordion');
            if (!playerAccordion) {
                console.error('Error: player-accordion element not found in DOM');
                return;
            }
            
            // Always recreate the message element to avoid null reference
            playerAccordion.innerHTML = '';
            const errorMessage = document.createElement('div');
            errorMessage.id = 'no-players-message';
            errorMessage.className = 'text-center text-muted';
            errorMessage.textContent = "Error loading players: " + error.message;
            playerAccordion.appendChild(errorMessage);
        }
    }

    // Function to attach event handlers to player buttons
    function attachPlayerButtonHandlers() {
        // Add kick player button handlers
        document.querySelectorAll('.kick-player').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                
                const clientId = e.currentTarget.getAttribute('data-id');
                const playerName = e.currentTarget.getAttribute('data-name');
                
                document.getElementById('kick-player-name').textContent = playerName;
                kickClientId = clientId;
                
                kickPlayerModal.show();
            });
        });

        // Add monitor player button handlers
        document.querySelectorAll('.monitor-player').forEach(button => {
            button.addEventListener('click', async (e) => {
                e.preventDefault();
                
                const clientId = e.currentTarget.getAttribute('data-id');
                const playerName = e.currentTarget.getAttribute('data-name');
                
                try {
                    const response = await fetch(`/api/admin/players/${clientId}/monitor`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        // Switch to client tab using our custom function
                        activateTab('#client-tab');
                        
                        // Start monitoring
                        startMonitoring(clientId, playerName);
                    } else {
                        alert('Failed to monitor player: ' + (data.message || 'Unknown error'));
                    }
                } catch (error) {
                    console.error('Error monitoring player:', error);
                    alert('Error monitoring player: ' + error.message);
                }
            });
        });
    }

    // Monitor player functionality
    let monitorSocket = null;
    let currentlyMonitoringId = null;

    function startMonitoring(clientId, playerName) {
        // If already monitoring someone, disconnect first
        if (monitorSocket) {
            monitorSocket.disconnect();
        }
        
        // Update the monitoring interface
        const monitorInfo = document.getElementById('monitor-info');
        monitorInfo.innerHTML = `Monitoring: <span class="text-warning">${playerName}</span>`;
        monitorInfo.classList.remove('d-none');
        
        document.getElementById('stop-monitoring').classList.remove('d-none');
        document.getElementById('admin-command-form').classList.remove('d-none');
        
        // Clear previous terminal content
        const terminal = document.getElementById('monitor-terminal');
        terminal.innerHTML = '';
        
        // Store currently monitoring client id
        currentlyMonitoringId = clientId;
        
        // Connect to Socket.IO for monitoring
        monitorSocket = io();
        
        monitorSocket.on('connect', () => {
            // Send monitoring request with authentication
            monitorSocket.emit('monitor-user', {
                clientId: clientId,
                token: token
            });
        });
        
        monitorSocket.on('monitor-connected', (data) => {
            addToMonitorTerminal(`Connected to ${data.username}'s session.\n`, 'system');
        });
        
        monitorSocket.on('monitor-output', (message) => {
            addToMonitorTerminal(convertAnsiToHtml(message.data));
        });
        
        monitorSocket.on('monitor-error', (error) => {
            addToMonitorTerminal(`Error: ${error.message}\n`, 'error');
        });
        
        monitorSocket.on('disconnect', () => {
            addToMonitorTerminal('Disconnected from monitoring session.\n', 'system');
        });
    }

    // Add output to the monitoring terminal
    function addToMonitorTerminal(text, className = '') {
        const terminal = document.getElementById('monitor-terminal');
        const span = document.createElement('span');
        span.className = className;
        span.innerHTML = text;
        terminal.appendChild(span);
        terminal.scrollTop = terminal.scrollHeight;
    }

    // Convert ANSI escape sequences to HTML
    function convertAnsiToHtml(text) {
        // Replace common ANSI escape codes with HTML
        // First handle line breaks and special characters
        let html = text
            .replace(/\n/g, '<br>')
            .replace(/\r/g, '')
            .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
        
        // Handle basic ANSI color codes
        // This is a simplified implementation - a full implementation would handle more codes
        
        // Reset color
        html = html.replace(/\x1B\[0m/g, '</span>');
        
        // Text colors
        html = html.replace(/\x1B\[30m/g, '<span style="color:#000000">'); // Black
        html = html.replace(/\x1B\[31m/g, '<span style="color:#ff0000">'); // Red
        html = html.replace(/\x1B\[32m/g, '<span style="color:#00ff00">'); // Green
        html = html.replace(/\x1B\[33m/g, '<span style="color:#ffff00">'); // Yellow
        html = html.replace(/\x1B\[34m/g, '<span style="color:#0000ff">'); // Blue
        html = html.replace(/\x1B\[35m/g, '<span style="color:#ff00ff">'); // Magenta
        html = html.replace(/\x1B\[36m/g, '<span style="color:#00ffff">'); // Cyan
        html = html.replace(/\x1B\[37m/g, '<span style="color:#ffffff">'); // White
        
        // Bright colors
        html = html.replace(/\x1B\[1;30m/g, '<span style="color:#808080">'); // Bright Black
        html = html.replace(/\x1B\[1;31m/g, '<span style="color:#ff5555">'); // Bright Red
        html = html.replace(/\x1B\[1;32m/g, '<span style="color:#55ff55">'); // Bright Green
        html = html.replace(/\x1B\[1;33m/g, '<span style="color:#ffff55">'); // Bright Yellow
        html = html.replace(/\x1B\[1;34m/g, '<span style="color:#5555ff">'); // Bright Blue
        html = html.replace(/\x1B\[1;35m/g, '<span style="color:#ff55ff">'); // Bright Magenta
        html = html.replace(/\x1B\[1;36m/g, '<span style="color:#55ffff">'); // Bright Cyan
        html = html.replace(/\x1B\[1;37m/g, '<span style="color:#ffffff">'); // Bright White
        
        // Clean up any remaining ANSI sequences
        html = html.replace(/\x1B\[\d+(;\d+)*m/g, '');
        
        return html;
    }

    // Handle stop monitoring button
    document.getElementById('stop-monitoring').addEventListener('click', () => {
        if (monitorSocket) {
            monitorSocket.disconnect();
            monitorSocket = null;
        }
        
        document.getElementById('monitor-info').classList.add('d-none');
        document.getElementById('stop-monitoring').classList.add('d-none');
        document.getElementById('admin-command-form').classList.add('d-none');
        currentlyMonitoringId = null;
    });

    // Handle admin commands
    document.getElementById('admin-command-form').addEventListener('submit', (e) => {
        e.preventDefault();
        
        const commandInput = document.getElementById('admin-command-input');
        const command = commandInput.value;
        
        if (command && monitorSocket && currentlyMonitoringId) {
            // Send the command
            monitorSocket.emit('admin-command', {
                clientId: currentlyMonitoringId,
                command: command
            });
            
            // Clear the input
            commandInput.value = '';
        }
    });

    // Add event listeners for the game timer config
    document.getElementById('refresh-timer-config').addEventListener('click', () => {
        fetchGameTimerConfig();
    });
    
    document.getElementById('save-timer-config').addEventListener('click', () => {
        saveGameTimerConfig();
    });
    
    document.getElementById('force-save').addEventListener('click', () => {
        forceSaveData();
    });
});
