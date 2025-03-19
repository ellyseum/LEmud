#!/usr/bin/env node
"use strict";   // Enable strict mode for JavaScript

// AUTOLOGIN CLIENT
// This script connects to a MUD server and logs in automatically
// using the provided username and password. It then sends all
// keystrokes to the server and displays the output.

const net = require("net");

// Configuration from environment variables with defaults
const HOST = process.env.MUD_HOST || "localhost";
const PORT = parseInt(process.env.MUD_PORT || "8023", 10);
const USERNAME = process.env.MUD_USERNAME || "test";
const PASSWORD = process.env.MUD_PASSWORD || "a";

// Create a socket connection
const socket = new net.Socket();
const RECONNECT_DELAY = 1000; // 1 second delay before reconnection

// Set up raw mode to capture keystrokes
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

// Connect to server function
function connectToServer(crDelay = 500) {
  console.log(`Connecting to ${HOST}:${PORT}...`);
  
  socket.connect(PORT, HOST, () => {
    console.log("Connected! Sending login credentials...");
    // Connected, waiting for login prompt
    // send username then CR
    socket.write(USERNAME);
    setTimeout(() => {
      socket.write("\r");
      // repeat for password
      socket.write(PASSWORD);
      setTimeout(() => {
        socket.write("\r");
      }, crDelay);
    }, crDelay);
  });
}

// Initial connection
connectToServer();

// Handle data from the server
socket.on("data", (data) => {
  // Output the data from the server (with ANSI colors intact)
  process.stdout.write(data);
});

// Handle socket close
socket.on("close", () => {
  console.log("\nConnection lost. Attempting to reconnect in 1 second...");
  
  // Wait 1 second before trying to reconnect
  setTimeout(() => {
    connectToServer();
  }, RECONNECT_DELAY);
});

// Handle socket errors
socket.on("error", (err) => {
  console.error(`Connection error: ${err.message}`);
  // Don't exit on error - the close event will be triggered and we'll try to reconnect
});

// Handle user input and send it to the server
process.stdin.on("data", (key) => {
  // Ctrl+C to exit
  if (key === "\u0003") {
    console.log("\nDisconnecting and exiting...");
    socket.end();
    process.exit(0);
  }
  
  // Only send key if we're connected
  if (socket.writable) {
    // Send the keypress to the server
    socket.write(key);
  }
});
