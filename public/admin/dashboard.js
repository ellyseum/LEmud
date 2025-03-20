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

    // Setup tab behavior
    const tabLinks = document.querySelectorAll('.nav-link');
    tabLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            tabLinks.forEach(l => l.classList.remove('active'));
            e.target.classList.add('active');
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
                                <div class="d-grid">
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
            }
        } catch (error) {
            console.error('Error fetching player data:', error);
        }
    }
});
