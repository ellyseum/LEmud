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

    // Refresh players button
    document.getElementById('refresh-players').addEventListener('click', () => {
        fetchPlayerData();
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

    // Set up polling for stats (every 5 seconds)
    setInterval(fetchServerStats, 5000);

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
                fetchPlayerData(); // Refresh player list
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

    // Fetch player data from API
    async function fetchPlayerData() {
        try {
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
            
            if (data.success) {
                const playerAccordion = document.getElementById('player-accordion');
                const noPlayersMessage = document.getElementById('no-players-message');
                
                // Clear existing player entries
                playerAccordion.innerHTML = '';
                
                if (data.players.length === 0) {
                    noPlayersMessage.style.display = 'block';
                    return;
                }
                
                noPlayersMessage.style.display = 'none';
                
                // Add player entries
                data.players.forEach((player, index) => {
                    const accordionItem = document.createElement('div');
                    accordionItem.className = 'accordion-item bg-dark border-secondary';
                    
                    const accordionHeader = document.createElement('h2');
                    accordionHeader.className = 'accordion-header';
                    accordionHeader.id = `heading-${player.id}`;
                    
                    const accordionButton = document.createElement('button');
                    accordionButton.className = 'accordion-button bg-dark text-light collapsed';
                    accordionButton.type = 'button';
                    accordionButton.setAttribute('data-bs-toggle', 'collapse');
                    accordionButton.setAttribute('data-bs-target', `#collapse-${player.id}`);
                    accordionButton.setAttribute('aria-expanded', 'false');
                    accordionButton.setAttribute('aria-controls', `collapse-${player.id}`);
                    accordionButton.innerHTML = `
                        <div class="d-flex justify-content-between align-items-center w-100">
                            <span>${player.username}</span>
                            <span class="badge bg-info ms-2">${player.health}</span>
                        </div>
                    `;
                    
                    accordionHeader.appendChild(accordionButton);
                    
                    const accordionCollapse = document.createElement('div');
                    accordionCollapse.id = `collapse-${player.id}`;
                    accordionCollapse.className = 'accordion-collapse collapse';
                    accordionCollapse.setAttribute('aria-labelledby', `heading-${player.id}`);
                    
                    const accordionBody = document.createElement('div');
                    accordionBody.className = 'accordion-body text-light';
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
                    
                    accordionCollapse.appendChild(accordionBody);
                    
                    accordionItem.appendChild(accordionHeader);
                    accordionItem.appendChild(accordionCollapse);
                    
                    playerAccordion.appendChild(accordionItem);
                });
                
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
                            alert('Error monitoring player');
                        }
                    });
                });
            }
        } catch (error) {
            console.error('Error fetching player data:', error);
        }
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
});
