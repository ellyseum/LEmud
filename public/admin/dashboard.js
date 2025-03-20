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
    function activateTab(tabId, updateHash = true) {
        // Remove the '#' if it exists in the tabId
        const cleanTabId = tabId.replace(/^#/, '');
        const fullTabId = '#' + cleanTabId;
        
        // Update tab nav links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-tab-target="${fullTabId}"]`)?.classList.add('active');
        
        // Update tab panes
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('show', 'active');
        });
        document.querySelector(fullTabId)?.classList.add('show', 'active');
        
        // Update URL hash if requested (avoid during page initialization from hash)
        if (updateHash) {
            window.history.pushState(null, '', `#${cleanTabId}`);
        }
        
        // Load content for players tab when it's activated
        if (fullTabId === '#players-tab') {
            loadPlayersTabContent();
        }
    }
    
    // Set up tab click handlers
    document.querySelectorAll('[data-tab-target]').forEach(tabLink => {
        tabLink.addEventListener('click', (e) => {
            e.preventDefault();
            const target = e.currentTarget.getAttribute('data-tab-target');
            activateTab(target);
        });
    });

    // Check URL hash on page load and activate the corresponding tab
    function handleHashChange() {
        const hash = window.location.hash;
        if (hash) {
            // Only activate these specific tabs (security/validation)
            const validTabs = ['dashboard-tab', 'client-tab', 'players-tab', 'config-tab'];
            const tabName = hash.substring(1); // Remove the # character
            
            if (validTabs.includes(tabName)) {
                activateTab(hash, false); // Don't update hash again during initial load
            } else {
                // Invalid hash, default to dashboard
                activateTab('#dashboard-tab', false);
            }
        } else {
            // No hash, default to dashboard
            activateTab('#dashboard-tab', false);
        }
    }
    
    // Handle hash changes (browser back/forward)
    window.addEventListener('hashchange', handleHashChange);
    
    // Initial hash check
    handleHashChange();

    // Fetch initial data
    fetchServerStats();
    fetchPlayerData();
    fetchGameTimerConfig();
    
    // Add configuration loading
    fetchMUDConfiguration();

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
        if (monitorSocket && currentlyMonitoringId) {
            // Explicitly tell the server to stop monitoring
            monitorSocket.emit('stop-monitoring', {
                clientId: currentlyMonitoringId
            });
            
            console.log(`Stopped monitoring client: ${currentlyMonitoringId}`);
            
            // Clean up socket
            monitorSocket.disconnect();
            monitorSocket = null;
        }
        
        document.getElementById('monitor-info').classList.add('d-none');
        document.getElementById('stop-monitoring').classList.add('d-none');
        document.getElementById('admin-command-form').classList.add('d-none');
        currentlyMonitoringId = null;
    });

    // When page is unloaded, make sure to stop monitoring
    window.addEventListener('beforeunload', (event) => {
        if (monitorSocket && currentlyMonitoringId) {
            try {
                // Use sendBeacon for more reliable delivery during page unload
                const data = JSON.stringify({clientId: currentlyMonitoringId});
                navigator.sendBeacon('/socket.io/?EIO=4&transport=polling&t=' + Date.now(), data);
                
                // Also try the normal emit as a fallback
                monitorSocket.emit('stop-monitoring', {
                    clientId: currentlyMonitoringId
                });
            } catch (error) {
                console.error('Error during cleanup:', error);
            }
        }
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
    
    // Add event listeners for MUD Configuration
    document.getElementById('refresh-config').addEventListener('click', () => {
        fetchMUDConfiguration();
    });
    
    document.getElementById('save-config').addEventListener('click', () => {
        saveMUDConfiguration();
    });
    
    // Fetch MUD configuration from API
    async function fetchMUDConfiguration() {
        try {
            // Show loading indicator, hide form and error
            document.getElementById('config-loading').classList.remove('d-none');
            document.getElementById('mud-config-form').classList.add('d-none');
            document.getElementById('config-error').classList.add('d-none');
            
            let response;
            let usedMockAPI = false;
            
            try {
                // Try the real API endpoint first
                response = await fetch('/api/admin/mud-config', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                // If we get a non-OK response, try the mock API
                if (!response.ok) {
                    console.warn(`Real API returned status ${response.status}, trying mock API as fallback`);
                    response = await fetch('/admin/mock-api/mud-config.json');
                    usedMockAPI = true;
                    
                    if (!response.ok) {
                        throw new Error(`Mock API also failed with status: ${response.status}`);
                    }
                }
            } catch (initialError) {
                console.warn('Error with primary API, trying mock API:', initialError);
                // If the main API fails completely, try the mock API
                response = await fetch('/admin/mock-api/mud-config.json');
                usedMockAPI = true;
            }
            
            // Hide loading regardless of outcome
            document.getElementById('config-loading').classList.add('d-none');
            
            // Check if the response is expired or invalid
            if (response.status === 401) {
                localStorage.removeItem('mudAdminToken');
                window.location.href = '/admin/login.html';
                return;
            }
            
            // Check if response is JSON by looking at content-type header
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                throw new Error(`Expected JSON but got ${contentType || 'unknown content type'}: ${text.substring(0, 100)}...`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                // If we're using mock data, add a banner notification
                if (usedMockAPI) {
                    const errorElement = document.getElementById('config-error');
                    errorElement.className = 'alert alert-warning';
                    errorElement.textContent = 'Using mock configuration data for display purposes. Changes will not be saved.';
                    errorElement.classList.remove('d-none');
                }
                
                // Populate the form with configuration data
                const config = data.config;
                
                // File paths
                document.getElementById('players-path').value = config.dataFiles.players || '';
                document.getElementById('rooms-path').value = config.dataFiles.rooms || '';
                document.getElementById('items-path').value = config.dataFiles.items || '';
                document.getElementById('npcs-path').value = config.dataFiles.npcs || '';
                
                // Game settings
                document.getElementById('starting-room').value = config.game.startingRoom || '';
                document.getElementById('max-players').value = config.game.maxPlayers || '';
                document.getElementById('idle-timeout').value = config.game.idleTimeout || '';
                document.getElementById('password-attempts').value = config.game.maxPasswordAttempts || '';
                
                // Advanced settings
                document.getElementById('debug-mode').checked = config.advanced.debugMode || false;
                document.getElementById('allow-registration').checked = config.advanced.allowRegistration || false;
                document.getElementById('backup-interval').value = config.advanced.backupInterval || '';
                document.getElementById('log-level').value = config.advanced.logLevel || 'info';
                
                // Show the form
                document.getElementById('mud-config-form').classList.remove('d-none');
            } else {
                // Show error message
                const errorElement = document.getElementById('config-error');
                errorElement.textContent = data.message || 'Failed to load configuration data';
                errorElement.classList.remove('d-none');
            }
        } catch (error) {
            console.error('Error fetching MUD configuration:', error);
            
            // Hide loading, show error
            document.getElementById('config-loading').classList.add('d-none');
            const errorElement = document.getElementById('config-error');
            errorElement.textContent = `Error loading configuration: ${error.message}`;
            errorElement.classList.remove('d-none');
        }
    }

    // Save MUD configuration to API
    async function saveMUDConfiguration() {
        try {
            // Collect all values from the form
            const configData = {
                dataFiles: {
                    players: document.getElementById('players-path').value,
                    rooms: document.getElementById('rooms-path').value,
                    items: document.getElementById('items-path').value,
                    npcs: document.getElementById('npcs-path').value
                },
                game: {
                    startingRoom: document.getElementById('starting-room').value,
                    maxPlayers: parseInt(document.getElementById('max-players').value),
                    idleTimeout: parseInt(document.getElementById('idle-timeout').value),
                    maxPasswordAttempts: parseInt(document.getElementById('password-attempts').value)
                },
                advanced: {
                    debugMode: document.getElementById('debug-mode').checked,
                    allowRegistration: document.getElementById('allow-registration').checked,
                    backupInterval: parseInt(document.getElementById('backup-interval').value),
                    logLevel: document.getElementById('log-level').value
                }
            };
            
            // Basic validation
            if (!configData.dataFiles.players || !configData.dataFiles.rooms) {
                alert('Players and Rooms data paths are required');
                return;
            }
            
            // Show loading indicator
            document.getElementById('config-loading').classList.remove('d-none');
            document.getElementById('mud-config-form').classList.add('d-none');
            
            const response = await fetch('/api/admin/mud-config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(configData)
            });
            
            const data = await response.json();
            
            // Hide loading indicator
            document.getElementById('config-loading').classList.add('d-none');
            document.getElementById('mud-config-form').classList.remove('d-none');
            
            if (data.success) {
                alert('Configuration updated successfully');
                // Refresh with new server values
                fetchMUDConfiguration();
            } else {
                alert('Failed to update configuration: ' + (data.message || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving MUD configuration:', error);
            alert('Error saving configuration: ' + error.message);
            
            // Hide loading, show form again
            document.getElementById('config-loading').classList.add('d-none');
            document.getElementById('mud-config-form').classList.remove('d-none');
        }
    }

    // Add handler for players tab refresh button
    document.getElementById('refresh-player-list')?.addEventListener('click', () => {
        loadPlayersTabContent();
    });
    
    // Function to load players tab content
    function loadPlayersTabContent() {
        const loadingElement = document.getElementById('players-loading');
        const contentElement = document.getElementById('players-content');
        
        if (loadingElement && contentElement) {
            loadingElement.classList.remove('d-none');
            contentElement.classList.add('d-none');
            
            // Make API request to get all players
            fetchAllPlayers().then(players => {
                // Populate the table with player data
                populatePlayersTable(players);
                
                // Show content and hide loading
                loadingElement.classList.add('d-none');
                contentElement.classList.remove('d-none');
            }).catch(error => {
                console.error('Error loading players:', error);
                
                // Show error message
                loadingElement.innerHTML = `
                    <div class="alert alert-danger">
                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                        Error loading players: ${error.message}
                    </div>
                `;
            });
        }
    }
    
    // Fetch all players from the database (including offline ones)
    async function fetchAllPlayers() {
        try {
            const response = await fetch('/api/admin/players/all', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.status === 401) {
                localStorage.removeItem('mudAdminToken');
                window.location.href = '/admin/login.html';
                return [];
            }
            
            const data = await response.json();
            
            if (data.success) {
                return data.players || [];
            } else {
                throw new Error(data.message || 'Failed to fetch players');
            }
        } catch (error) {
            console.error('Error fetching all players:', error);
            throw error;
        }
    }
    
    // Populate the players table with data
    function populatePlayersTable(players) {
        const tableBody = document.getElementById('players-table-body');
        if (!tableBody) return;
        
        // Clear existing rows
        tableBody.innerHTML = '';
        
        if (players.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="6" class="text-center text-muted">No players found</td>
            `;
            tableBody.appendChild(emptyRow);
            return;
        }
        
        // Get list of currently connected players for status
        const connectedPlayers = Array.from(document.querySelectorAll('#player-accordion .accordion-item'))
            .map(item => {
                const header = item.querySelector('.accordion-header');
                if (header) {
                    const id = header.id.replace('heading-', '');
                    const usernameEl = item.querySelector('.accordion-button span');
                    if (usernameEl) {
                        // Extract just the username text without the (not authenticated) part
                        const fullText = usernameEl.textContent || '';
                        const username = fullText.split(' ')[0];
                        return { id, username };
                    }
                }
                return null;
            })
            .filter(p => p !== null);
        
        // Sort players: online first, then by level (high to low), then by name
        players.sort((a, b) => {
            // Check if player is online
            const aOnline = connectedPlayers.some(p => p.username.toLowerCase() === a.username.toLowerCase());
            const bOnline = connectedPlayers.some(p => p.username.toLowerCase() === b.username.toLowerCase());
            
            // Online players come first
            if (aOnline && !bOnline) return -1;
            if (!aOnline && bOnline) return 1;
            
            // Then sort by level (high to low)
            if (a.level !== b.level) return b.level - a.level;
            
            // Then by name
            return a.username.localeCompare(b.username);
        });
        
        // Add each player to the table
        players.forEach(player => {
            // Check if player is currently online
            const isOnline = connectedPlayers.some(p => p.username.toLowerCase() === player.username.toLowerCase());
            const connectedPlayer = connectedPlayers.find(p => p.username.toLowerCase() === player.username.toLowerCase());
            
            // Create data row
            const dataRow = document.createElement('tr');
            dataRow.className = isOnline ? 'table-active' : '';
            dataRow.setAttribute('data-username', player.username);
            
            // Format last login date
            const lastLogin = new Date(player.lastLogin).toLocaleString();
            
            // Create status badge
            let statusBadge = '';
            if (isOnline) {
                statusBadge = '<span class="badge bg-success">Online</span>';
            } else {
                const lastLoginDate = new Date(player.lastLogin);
                const now = new Date();
                const daysSinceLogin = Math.floor((now - lastLoginDate) / (1000 * 60 * 60 * 24));
                
                if (daysSinceLogin < 7) {
                    statusBadge = '<span class="badge bg-info">Active</span>';
                } else if (daysSinceLogin < 30) {
                    statusBadge = '<span class="badge bg-warning text-dark">Inactive</span>';
                } else {
                    statusBadge = '<span class="badge bg-danger">Dormant</span>';
                }
            }
            
            dataRow.innerHTML = `
                <td>${player.username}</td>
                <td>${player.level}</td>
                <td>${player.health}/${player.maxHealth}</td>
                <td>${lastLogin}</td>
                <td>${statusBadge}</td>
                <td>
                    <div class="btn-group btn-group-sm" role="group">
                        <button type="button" class="btn btn-primary toggle-player-detail" data-username="${player.username}">
                            <i class="bi bi-pencil"></i>
                        </button>
                        ${isOnline ? `
                            <button type="button" class="btn btn-info monitor-player-managed" data-id="${connectedPlayer?.id}" data-name="${player.username}">
                                <i class="bi bi-display"></i>
                            </button>
                            <button type="button" class="btn btn-warning kick-player-managed" data-id="${connectedPlayer?.id}" data-name="${player.username}">
                                <i class="bi bi-box-arrow-right"></i>
                            </button>
                        ` : ''}
                    </div>
                </td>
            `;
            
            tableBody.appendChild(dataRow);
            
            // Create detail row (initially hidden)
            const detailRow = document.createElement('tr');
            detailRow.className = 'player-detail-row d-none';
            detailRow.setAttribute('data-detail-for', player.username);
            
            const detailCell = document.createElement('td');
            detailCell.colSpan = 6;
            detailCell.className = 'p-0';
            
            // Use the template to create the detail form
            const template = document.getElementById('player-detail-template');
            if (template) {
                const detailContent = template.content.cloneNode(true);
                detailCell.appendChild(detailContent);
            }
            
            detailRow.appendChild(detailCell);
            tableBody.appendChild(detailRow);
        });
        
        // Attach event handlers to the newly created buttons
        attachPlayerManagementHandlers();
    }
    
    // Attach event handlers to player management buttons
    function attachPlayerManagementHandlers() {
        // Toggle player detail button handlers
        document.querySelectorAll('.toggle-player-detail').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const username = e.currentTarget.getAttribute('data-username');
                togglePlayerDetail(username);
            });
        });
        
        // Monitor player buttons (in the players table)
        document.querySelectorAll('.monitor-player-managed').forEach(button => {
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
        
        // Kick player buttons (in the players table)
        document.querySelectorAll('.kick-player-managed').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const clientId = e.currentTarget.getAttribute('data-id');
                const playerName = e.currentTarget.getAttribute('data-name');
                
                document.getElementById('kick-player-name').textContent = playerName;
                kickClientId = clientId;
                
                kickPlayerModal.show();
            });
        });
        
        // Player detail form buttons
        document.querySelectorAll('.player-detail-cancel').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const detailRow = e.currentTarget.closest('.player-detail-row');
                if (detailRow) {
                    const username = detailRow.getAttribute('data-detail-for');
                    hidePlayerDetail(username);
                }
            });
        });
        
        document.querySelectorAll('.player-detail-save').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const detailRow = e.currentTarget.closest('.player-detail-row');
                if (detailRow) {
                    savePlayerDetail(detailRow);
                }
            });
        });
        
        document.querySelectorAll('.player-detail-reset-pwd').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const detailRow = e.currentTarget.closest('.player-detail-row');
                if (detailRow) {
                    const usernameInput = detailRow.querySelector('.player-detail-username');
                    const passwordInput = detailRow.querySelector('.player-detail-password');
                    if (usernameInput && passwordInput) {
                        passwordInput.value = generateRandomPassword();
                    }
                }
            });
        });
        
        document.querySelectorAll('.player-detail-delete').forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                const detailRow = e.currentTarget.closest('.player-detail-row');
                if (detailRow) {
                    const username = detailRow.getAttribute('data-detail-for');
                    openDeletePlayerModal(username);
                }
            });
        });
    }
    
    // Toggle player detail section
    function togglePlayerDetail(username) {
        const detailRow = document.querySelector(`.player-detail-row[data-detail-for="${username}"]`);
        if (!detailRow) return;
        
        const isVisible = !detailRow.classList.contains('d-none');
        
        if (isVisible) {
            // Hide the detail row
            hidePlayerDetail(username);
        } else {
            // Hide any other open detail rows
            document.querySelectorAll('.player-detail-row:not(.d-none)').forEach(row => {
                const rowUsername = row.getAttribute('data-detail-for');
                if (rowUsername !== username) {
                    hidePlayerDetail(rowUsername);
                }
            });
            
            // Show this detail row and load the data
            loadPlayerDetailData(username);
        }
    }
    
    // Hide player detail section
    function hidePlayerDetail(username) {
        const detailRow = document.querySelector(`.player-detail-row[data-detail-for="${username}"]`);
        if (detailRow) {
            detailRow.classList.add('d-none');
        }
    }
    
    // Load player detail data
    async function loadPlayerDetailData(username) {
        try {
            const detailRow = document.querySelector(`.player-detail-row[data-detail-for="${username}"]`);
            if (!detailRow) return;
            
            // Show loading state
            detailRow.classList.remove('d-none');
            const detailForm = detailRow.querySelector('.player-detail-form');
            if (detailForm) {
                detailForm.innerHTML = `
                    <div class="text-center p-3">
                        <div class="spinner-border text-light" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <p class="mt-2">Loading player data...</p>
                    </div>
                `;
            }
            
            // Fetch player details
            const response = await fetch(`/api/admin/players/details/${username}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const data = await response.json();
            
            if (data.success && data.player) {
                const player = data.player;
                
                // Reset the form content from the template
                const template = document.getElementById('player-detail-template');
                if (template && detailForm) {
                    detailForm.innerHTML = '';
                    const detailContent = template.content.cloneNode(true);
                    detailForm.appendChild(detailContent);
                    
                    // Set up the form with player data
                    detailForm.querySelector('.player-detail-name').textContent = player.username;
                    detailForm.querySelector('.player-detail-username').value = player.username;
                    detailForm.querySelector('.player-detail-health').value = player.health;
                    detailForm.querySelector('.player-detail-max-health').value = player.maxHealth;
                    detailForm.querySelector('.player-detail-level').value = player.level;
                    detailForm.querySelector('.player-detail-experience').value = player.experience;
                    detailForm.querySelector('.player-detail-room').value = player.currentRoomId;
                    detailForm.querySelector('.player-detail-inventory').value = JSON.stringify(player.inventory, null, 2);
                    
                    // Re-attach event handlers for this form's buttons
                    attachPlayerDetailFormHandlers(detailForm);
                }
            } else {
                // Show error in the form
                if (detailForm) {
                    detailForm.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="bi bi-exclamation-triangle-fill me-2"></i>
                            Failed to load player details: ${data.message || 'Unknown error'}
                        </div>
                    `;
                }
            }
        } catch (error) {
            console.error('Error loading player details:', error);
            
            // Show error in the form
            const detailRow = document.querySelector(`.player-detail-row[data-detail-for="${username}"]`);
            if (detailRow) {
                const detailForm = detailRow.querySelector('.player-detail-form');
                if (detailForm) {
                    detailForm.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="bi bi-exclamation-triangle-fill me-2"></i>
                            Error loading player details: ${error.message}
                        </div>
                    `;
                }
            }
        }
    }
    
    // Attach event handlers to a specific player detail form
    function attachPlayerDetailFormHandlers(formElement) {
        const cancelBtn = formElement.querySelector('.player-detail-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const detailRow = e.currentTarget.closest('.player-detail-row');
                if (detailRow) {
                    const username = detailRow.getAttribute('data-detail-for');
                    hidePlayerDetail(username);
                }
            });
        }
        
        const saveBtn = formElement.querySelector('.player-detail-save');
        if (saveBtn) {
            saveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const detailRow = e.currentTarget.closest('.player-detail-row');
                if (detailRow) {
                    savePlayerDetail(detailRow);
                }
            });
        }
        
        const resetPwdBtn = formElement.querySelector('.player-detail-reset-pwd');
        if (resetPwdBtn) {
            resetPwdBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const passwordInput = formElement.querySelector('.player-detail-password');
                if (passwordInput) {
                    passwordInput.value = generateRandomPassword();
                }
            });
        }
        
        const deleteBtn = formElement.querySelector('.player-detail-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const detailRow = e.currentTarget.closest('.player-detail-row');
                if (detailRow) {
                    const username = detailRow.getAttribute('data-detail-for');
                    openDeletePlayerModal(username);
                }
            });
        }
    }
    
    // Save player detail changes
    async function savePlayerDetail(detailRow) {
        try {
            const username = detailRow.getAttribute('data-detail-for');
            const form = detailRow.querySelector('.player-detail-form');
            if (!form) return;
            
            // Get form values
            const health = parseInt(form.querySelector('.player-detail-health').value);
            const maxHealth = parseInt(form.querySelector('.player-detail-max-health').value);
            const level = parseInt(form.querySelector('.player-detail-level').value);
            const experience = parseInt(form.querySelector('.player-detail-experience').value);
            const currentRoomId = form.querySelector('.player-detail-room').value;
            const newPassword = form.querySelector('.player-detail-password').value;
            
            // Parse inventory JSON
            let inventory;
            try {
                inventory = JSON.parse(form.querySelector('.player-detail-inventory').value);
            } catch (e) {
                alert('Invalid inventory JSON format');
                return;
            }
            
            // Validate inputs
            if (isNaN(health) || health < 1) {
                alert('Health must be a positive number');
                return;
            }
            
            if (isNaN(maxHealth) || maxHealth < health) {
                alert('Max health must be greater than or equal to current health');
                return;
            }
            
            if (isNaN(level) || level < 1) {
                alert('Level must be a positive number');
                return;
            }
            
            if (isNaN(experience) || experience < 0) {
                alert('Experience cannot be negative');
                return;
            }
            
            if (!currentRoomId) {
                alert('Current room ID is required');
                return;
            }
            
            // Show loading state
            const originalContent = form.innerHTML;
            form.innerHTML = `
                <div class="text-center p-3">
                    <div class="spinner-border text-light" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <p class="mt-2">Saving changes...</p>
                </div>
            `;
            
            // Build the update payload
            const updateData = {
                health,
                maxHealth,
                level,
                experience,
                currentRoomId,
                inventory
            };
            
            // Only include password if it was provided
            if (newPassword) {
                updateData.newPassword = newPassword;
            }
            
            // Send the update to the API
            const response = await fetch(`/api/admin/players/${username}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(updateData)
            });
            
            const data = await response.json();
            
            if (data.success) {
                alert('Player updated successfully');
                
                // Hide the detail row
                hidePlayerDetail(username);
                
                // Refresh the players list
                loadPlayersTabContent();
            } else {
                // Restore the form and show error
                form.innerHTML = originalContent;
                attachPlayerDetailFormHandlers(form);
                alert('Failed to update player: ' + (data.message || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving player data:', error);
            alert(`Error saving player data: ${error.message}`);
            
            // Restore the form
            loadPlayerDetailData(detailRow.getAttribute('data-detail-for'));
        }
    }

    // Helper function to generate a random password (keep this existing function)
    function generateRandomPassword() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let password = '';
        for (let i = 0; i < 10; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }
});
