(function() {
    // DOM Elements
    const statusElem = document.getElementById('connection-status');
    
    // Initialize terminal with xterm.js
    const term = new Terminal({
        cursorBlink: true,
        convertEol: true,      // Convert \n to \r\n
        fontFamily: 'monospace',
        fontSize: 14,
        lineHeight: 1.2,
        theme: {
            background: '#000',
            foreground: '#f0f0f0',
            cursor: '#f0f0f0'
        }
    });
    
    // Load addons
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon.WebLinksAddon());
    
    // State variables
    let socket = null;
    let connected = false;
    
    // Initialize terminal
    function initTerminal() {
        // Open the terminal in the container element
        term.open(document.getElementById('terminal'));
        
        // Make the terminal fit its container
        fitAddon.fit();
        
        // Handle terminal resize
        window.addEventListener('resize', () => {
            fitAddon.fit();
        });
        
        // Handle user input in the terminal
        term.onData(data => {
            if (connected) {
                // Send user input to the server
                if (data === '\r') {  // Enter key
                    socket.emit('keypress', '\r');
                } else if (data === '\u007F') {  // Backspace
                    socket.emit('keypress', '\b');
                } else if (data === '\u001b[A') {  // Up arrow
                    socket.emit('special', { key: 'up' });
                } else if (data === '\u001b[B') {  // Down arrow
                    socket.emit('special', { key: 'down' });
                } else if (data === '\u001b[C') {  // Right arrow
                    socket.emit('special', { key: 'right' });
                } else if (data === '\u001b[D') {  // Left arrow
                    socket.emit('special', { key: 'left' });
                } else {
                    // Regular character input
                    socket.emit('keypress', data);
                }
            }
        });
        
        // Welcome message
        term.write('Connecting to server...\r\n');
    }
    
    // Connect to Socket.IO server
    function connect() {
        // Connect to Socket.IO server
        socket = io();
        
        socket.on('connect', () => {
            connected = true;
            statusElem.textContent = 'Connected';
            statusElem.className = 'connected';
            term.write('\r\nConnected to server\r\n');
        });
        
        socket.on('disconnect', () => {
            connected = false;
            statusElem.textContent = 'Disconnected';
            statusElem.className = 'disconnected';
            term.write('\r\nDisconnected from server\r\n');
        });
        
        socket.on('connect_error', (error) => {
            term.write(`\r\nConnection Error: ${error.message}\r\n`);
        });

        // Handle server messages
        socket.on('output', handleOutput);
        socket.on('mask', handleMask);
    }
    
    // Handle server output messages
    function handleOutput(message) {
        if (message.data) {
            // No need to convert ANSI escape sequences - xterm.js handles them natively
            term.write(message.data);
        }
    }
    
    // Handle mask state changes
    function handleMask(message) {
        // This is handled by the server input handling
        // No need to process on client side when using xterm.js
    }
    
    // Initialize and connect
    window.addEventListener('load', () => {
        initTerminal();
        connect();
    });
})();
