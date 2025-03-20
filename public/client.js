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
    let lineBuffer = '';

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
        socket.on('mask', handleMask);
    }
    
    // Handle server output messages
    function handleOutput(message) {
        if (message.data === '\b \b') { deleteLastCharacter(); return; }
        const convertedText = convertAnsiToHtml(message.data);
        addOutput(convertedText);
    }
    
    // Convert ANSI escape sequences to HTML
    function convertAnsiToHtml(text) {
        // Handle color codes and other ANSI sequences
        return text
            .replace(/\r\n/g, '<br>')
            .replace(/\n/g, '<br>')
            .replace(/\r/g, '<br>')
            .replace(/\x1b\[0m/g, '</span>')
            .replace(/\x1b\[1m/g, '<span class="bright">')
            .replace(/\x1b\[2m/g, '<span class="dim">')
            .replace(/\x1b\[4m/g, '<span class="underline">')
            .replace(/\x1b\[5m/g, '<span class="blink">')
            .replace(/\x1b\[31m/g, '<span class="red">')
            .replace(/\x1b\[32m/g, '<span class="green">')
            .replace(/\x1b\[33m/g, '<span class="yellow">')
            .replace(/\x1b\[34m/g, '<span class="blue">')
            .replace(/\x1b\[35m/g, '<span class="magenta">')
            .replace(/\x1b\[36m/g, '<span class="cyan">')
            .replace(/\x1b\[37m/g, '<span class="white">')
            .replace(/\x1b\[90m/g, '<span class="bright black">')
            .replace(/\x1b\[91m/g, '<span class="bright red">')
            .replace(/\x1b\[92m/g, '<span class="bright green">')
            .replace(/\x1b\[93m/g, '<span class="bright yellow">')
            .replace(/\x1b\[94m/g, '<span class="bright blue">')
            .replace(/\x1b\[95m/g, '<span class="bright magenta">')
            .replace(/\x1b\[96m/g, '<span class="bright cyan">')
            .replace(/\x1b\[97m/g, '<span class="bright white">')
            .replace(/\x1b\[2J\x1b\[0;0H/g, '<!-- clear -->');
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
        
        // Prevent default behavior for these keys to avoid browser actions
        if (key === 'Enter' || key === 'Backspace' || key === 'ArrowUp' || key === 'ArrowDown') {
            e.preventDefault();
        }
        
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
        
        // No local echo - we'll rely on server echo
        // Characters are only displayed when they come back from the server
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
