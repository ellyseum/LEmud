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
        terminalOutput.appendChild(cursor);
        terminalOutput.addEventListener('click', () => {
            terminalOutput.focus();
        });
        terminalOutput.addEventListener('keydown', handleKeyDown);
    }
    
    // Append cursor to terminal output
    function appendCursor() {
        terminalOutput.appendChild(cursor);
    }
    
    // Connect to Socket.IO server
    function connect() {
        // Connect to Socket.IO server
        socket = io();
        
        socket.on('connect', () => {
            connected = true;
            statusElem.textContent = 'Connected';
            statusElem.className = 'connected';
            addOutput('Connected to server\n', 'system');
        });
        
        socket.on('disconnect', () => {
            connected = false;
            statusElem.textContent = 'Disconnected';
            statusElem.className = 'disconnected';
            addOutput('Disconnected from server\n', 'system');
        });
        
        socket.on('connect_error', (error) => {
            addOutput(`Connection Error: ${error.message}\n`, 'error');
        });
        
        // Handle server messages
        socket.on('output', handleOutput);
        socket.on('echo', handleEcho);
        socket.on('mask', handleMask);
    }
    
    // Handle server output messages
    function handleOutput(message) {
        addOutput(message.data);
    }
    
    // Handle server echo of characters
    function handleEcho(message) {
        const char = message.char;
        
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
    
    // Handle mask state changes
    function handleMask(message) {
        // This is handled by the server input handling
    }
    
    // Add output to the terminal
    function addOutput(text, className = '') {
        const span = document.createElement('span');
        span.className = className;
        span.innerHTML = text;
        terminalOutput.insertBefore(span, cursor);
        appendCursor();
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
    
    // Delete the last character from the terminal
    function deleteLastCharacter() {
        const lastChild = terminalOutput.lastChild;
        if (lastChild && lastChild !== cursor) {
            terminalOutput.removeChild(lastChild);
        }
    }
    
    // Handle keyboard events
    function handleKeyDown(e) {
        if (!connected) return;
        
        const key = e.key;
        
        if (key === 'Enter') {
            sendKeypress('\r');
        } else if (key === 'Backspace') {
            sendKeypress('\b');
        } else if (key === 'ArrowUp') {
            sendKeypress('up', 'special');
        } else if (key === 'ArrowDown') {
            sendKeypress('down', 'special');
        } else if (key.length === 1) {
            sendKeypress(key);
        }
    }
    
    // Send a keypress to the server
    function sendKeypress(key, type = 'keypress') {
        if (!connected) {
            addOutput('Not connected to server\n', 'error');
            return;
        }
        
        if (type === 'special') {
            socket.emit('special', { key: key });
        } else {
            socket.emit('keypress', key);
        }
    }
    
    // Initialize and connect
    window.addEventListener('load', () => {
        initTerminal();
        connect();
    });
})();
