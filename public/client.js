(function() {
    // DOM Elements
    const outputElem = document.getElementById('terminal-output');
    const inputElem = document.getElementById('terminal-input');
    const statusElem = document.getElementById('connection-status');
    
    // WebSocket
    let socket = null;
    let connected = false;
    
    // Command history
    const commandHistory = [];
    let historyIndex = -1;
    let currentInput = '';
    
    // Connect to WebSocket server
    function connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname || 'localhost';
        const port = 8080; // WebSocket port
        
        socket = new WebSocket(`${protocol}//${host}:${port}`);
        
        socket.onopen = () => {
            connected = true;
            statusElem.textContent = 'Connected';
            statusElem.className = 'connected';
            addOutput('Connected to server', 'system');
        };
        
        socket.onclose = () => {
            connected = false;
            statusElem.textContent = 'Disconnected';
            statusElem.className = 'disconnected';
            addOutput('Disconnected from server', 'system');
            
            // Attempt to reconnect after a delay
            setTimeout(() => {
                if (!connected) {
                    addOutput('Attempting to reconnect...', 'system');
                    connect();
                }
            }, 3000);
        };
        
        socket.onerror = (error) => {
            addOutput(`WebSocket Error: ${error.message}`, 'error');
        };
        
        socket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                
                if (message.type === 'output') {
                    addOutput(message.data);
                    
                    if (message.mask) {
                        inputElem.type = 'password';
                    } else {
                        inputElem.type = 'text';
                    }
                } else if (message.type === 'mask') {
                    inputElem.type = message.mask ? 'password' : 'text';
                }
            } catch (e) {
                // If not JSON, just display as text
                addOutput(event.data);
            }
        };
    }
    
    // Add output to the terminal
    function addOutput(text, className = '') {
        const outputLine = document.createElement('div');
        outputLine.className = className;
        
        // Just set the HTML directly - the WebSocketConnection will have converted
        // ANSI codes to HTML span elements
        outputLine.innerHTML = text;
        
        outputElem.appendChild(outputLine);
        
        // Scroll to bottom
        outputElem.scrollTop = outputElem.scrollHeight;
    }
    
    // Send input to server
    function sendInput(text) {
        if (!connected) {
            addOutput('Not connected to server', 'error');
            return;
        }
        
        // Add to history if not empty
        if (text.trim() && (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== text)) {
            commandHistory.push(text);
        }
        
        // Reset history index
        historyIndex = -1;
        
        // Send as JSON
        socket.send(JSON.stringify({
            type: 'input',
            text: text
        }));
        
        // Clear input field
        inputElem.value = '';
    }
    
    // Handle input events
    inputElem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const text = inputElem.value;
            sendInput(text);
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            // Navigate history up
            if (historyIndex === -1) {
                currentInput = inputElem.value;
            }
            
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                inputElem.value = commandHistory[commandHistory.length - 1 - historyIndex];
            }
            
            // Move cursor to end
            setTimeout(() => {
                inputElem.selectionStart = inputElem.selectionEnd = inputElem.value.length;
            }, 0);
            
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            // Navigate history down
            if (historyIndex > 0) {
                historyIndex--;
                inputElem.value = commandHistory[commandHistory.length - 1 - historyIndex];
            } else if (historyIndex === 0) {
                historyIndex = -1;
                inputElem.value = currentInput;
            }
            
            // Move cursor to end
            setTimeout(() => {
                inputElem.selectionStart = inputElem.selectionEnd = inputElem.value.length;
            }, 0);
            
            e.preventDefault();
        }
    });
    
    // Focus input when clicking anywhere in the terminal
    document.querySelector('.terminal-container').addEventListener('click', () => {
        inputElem.focus();
    });
    
    // Connect on load
    window.addEventListener('load', () => {
        connect();
    });
})();
