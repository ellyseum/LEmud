(function() {
    // DOM Elements
    const terminalOutput = document.getElementById('terminal-output');
    const statusElem = document.getElementById('connection-status');
    
    // Create cursor element
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    cursor.innerHTML = '&nbsp;';
    
    // State variables
    let socket = null;
    let connected = false;
    let isFocused = false;
    let lineBuffer = '';
    let commandHistory = [];
    let historyIndex = -1;
    let currentInput = '';
    
    // Initialize terminal
    function initTerminal() {
        // Make terminal focusable
        terminalOutput.tabIndex = 0;
        terminalOutput.focus();
        
        // Add cursor to initial output
        appendCursor();
        
        // Event listeners
        terminalOutput.addEventListener('keydown', handleKeyDown);
        terminalOutput.addEventListener('focus', () => { isFocused = true; cursor.style.display = 'inline-block'; });
        terminalOutput.addEventListener('blur', () => { isFocused = false; cursor.style.display = 'none'; });
        
        // Click on terminal focuses it
        document.querySelector('.terminal-container').addEventListener('click', () => {
            terminalOutput.focus();
        });
    }
    
    // Append cursor to terminal output
    function appendCursor() {
        terminalOutput.appendChild(cursor);
    }
    
    // Connect to WebSocket server
    function connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname || 'localhost';
        const port = 8080;
        
        socket = new WebSocket(`${protocol}//${host}:${port}`);
        
        socket.onopen = () => {
            connected = true;
            statusElem.textContent = 'Connected';
            statusElem.className = 'connected';
            addOutput('Connected to server\n', 'system');
        };
        
        socket.onclose = () => {
            connected = false;
            statusElem.textContent = 'Disconnected';
            statusElem.className = 'disconnected';
            addOutput('Disconnected from server\n', 'system');
            
            setTimeout(() => {
                if (!connected) {
                    addOutput('Attempting to reconnect...\n', 'system');
                    connect();
                }
            }, 3000);
        };
        
        socket.onerror = (error) => {
            addOutput(`WebSocket Error\n`, 'error');
        };
        
        socket.onmessage = handleServerMessage;
    }
    
    // Handle incoming server messages
    function handleServerMessage(event) {
        try {
            const message = JSON.parse(event.data);
            
            if (message.type === 'output') {
                // Handle server output
                addOutput(message.data);
            } else if (message.type === 'echo') {
                // Handle server echo - actual character updates
                handleEcho(message.char);
            } else if (message.type === 'mask') {
                // Password masking state - we handle this directly now
            }
        } catch (e) {
            // Plain text fallback
            addOutput(event.data);
        }
    }
    
    // Handle server echo of characters
    function handleEcho(char) {
        if (char === '\b \b') {
            // Remove last character from display (backspace sequence)
            deleteLastCharacter();
        } else if (char === '\r\n' || char === '\n') {
            // Handle newline
            addOutput('\n');
            lineBuffer = '';
        } else {
            // Regular character - add to output
            addOutput(char);
            lineBuffer += char;
        }
    }
    
    // Add output to the terminal
    function addOutput(text, className = '') {
        // Remove the cursor first
        if (cursor.parentNode === terminalOutput) {
            terminalOutput.removeChild(cursor);
        }
        
        // Check for clear command
        if (text.includes('<!-- clear -->')) {
            terminalOutput.innerHTML = '';
            text = text.replace('<!-- clear -->', '');
        }
        
        // Process text as HTML or create text node
        if (text.includes('<span') || text.includes('<br')) {
            // Text contains HTML (from ANSI conversion)
            const temp = document.createElement('div');
            temp.innerHTML = text;
            
            // Add all child nodes to output
            while (temp.firstChild) {
                terminalOutput.appendChild(temp.firstChild);
            }
        } else {
            // Simple text node
            const textNode = document.createTextNode(text);
            terminalOutput.appendChild(textNode);
        }
        
        // Re-add cursor
        appendCursor();
        
        // Scroll to bottom
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
    
    // Delete the last character from the terminal
    function deleteLastCharacter() {
        // Get the last text node before the cursor
        let lastNode = cursor.previousSibling;
        
        if (lastNode && lastNode.nodeType === Node.TEXT_NODE) {
            // Text node - remove last character
            if (lastNode.textContent.length > 0) {
                lastNode.textContent = lastNode.textContent.slice(0, -1);
            }
            
            // If empty, remove the node
            if (lastNode.textContent === '') {
                terminalOutput.removeChild(lastNode);
            }
        } else if (lastNode && lastNode.nodeType === Node.ELEMENT_NODE) {
            // Element node (like a span) - more complex
            if (lastNode.textContent.length > 0) {
                // For simplicity, just remove the last character from text content
                lastNode.textContent = lastNode.textContent.slice(0, -1);
                
                // If empty, remove the node
                if (lastNode.textContent === '') {
                    terminalOutput.removeChild(lastNode);
                }
            } else {
                // Empty element, remove it
                terminalOutput.removeChild(lastNode);
            }
        }
    }
    
    // Send a keypress to the server
    function sendKeypress(key, type = 'keypress') {
        if (!connected) {
            addOutput('Not connected to server\n', 'error');
            return;
        }
        
        socket.send(JSON.stringify({
            type: type,
            key: key
        }));
    }
    
    // Handle keyboard events
    function handleKeyDown(e) {
        if (!isFocused) return;
        
        // Always prevent default to avoid browser actions
        e.preventDefault();
        
        // Handle special keys
        switch (e.key) {
            case 'Enter':
                // Send enter key
                sendKeypress('\r\n', 'special');
                
                // Add to history if line is not empty
                if (lineBuffer.trim() && (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== lineBuffer)) {
                    commandHistory.push(lineBuffer);
                }
                
                // Reset history index
                historyIndex = -1;
                break;
                
            case 'Backspace':
                if (lineBuffer.length > 0) {
                    // Send backspace to server
                    sendKeypress('\b', 'special');
                    // Update local buffer (server will echo back the result)
                    lineBuffer = lineBuffer.substring(0, lineBuffer.length - 1);
                }
                break;
                
            case 'ArrowUp':
                if (historyIndex === -1) {
                    currentInput = lineBuffer;
                }
                
                if (historyIndex < commandHistory.length - 1) {
                    // Clear current line
                    while (lineBuffer.length > 0) {
                        sendKeypress('\b', 'special');
                    }
                    
                    // Increment history index and get command
                    historyIndex++;
                    const command = commandHistory[commandHistory.length - 1 - historyIndex];
                    
                    // Send each character to server
                    for (let i = 0; i < command.length; i++) {
                        sendKeypress(command[i]);
                    }
                    
                    // Update local buffer (characters will be echoed back)
                    lineBuffer = command;
                }
                break;
                
            case 'ArrowDown':
                if (historyIndex >= 0) {
                    // Clear current line
                    while (lineBuffer.length > 0) {
                        sendKeypress('\b', 'special');
                    }
                    
                    // Get the appropriate command
                    let command = '';
                    if (historyIndex === 0) {
                        historyIndex = -1;
                        command = currentInput;
                    } else {
                        historyIndex--;
                        command = commandHistory[commandHistory.length - 1 - historyIndex];
                    }
                    
                    // Send each character to server
                    for (let i = 0; i < command.length; i++) {
                        sendKeypress(command[i]);
                    }
                    
                    // Update local buffer
                    lineBuffer = command;
                }
                break;
                
            case 'Tab':
                sendKeypress('\t', 'special');
                break;
                
            case 'Escape':
                sendKeypress('ESC', 'special');
                break;
                
            default:
                // Handle control keys
                if (e.ctrlKey || e.altKey) {
                    const ctrlKey = e.key.toLowerCase();
                    if (ctrlKey.length === 1) {
                        sendKeypress(`CTRL+${ctrlKey}`, 'special');
                    }
                } 
                // Handle printable characters
                else if (e.key.length === 1) {
                    sendKeypress(e.key);
                    lineBuffer += e.key;
                }
                break;
        }
    }
    
    // Initialize and connect
    window.addEventListener('load', () => {
        initTerminal();
        connect();
    });
})();
