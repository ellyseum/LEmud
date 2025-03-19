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
const RECONNECT_DELAY = 3000; // Increased to 3 seconds delay before reconnection
const MAX_RECONNECT_ATTEMPTS = 3; // Maximum number of reconnection attempts
let reconnectAttempts = 0; // Track the number of reconnection attempts

// Set up raw mode to capture keystrokes
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

// Connect to server function
function connectToServer(crDelay = 500) {
  console.log(`Connecting to ${HOST}:${PORT}...`);
  
  socket.connect(PORT, HOST, () => {
    console.log("Connected! Sending login credentials...");
    // Reset reconnect attempts on successful connection
    reconnectAttempts = 0;
    
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
  console.log("\nConnection lost. Attempting to reconnect in 3 seconds...");
  
  // Wait 3 seconds before trying to reconnect
  setTimeout(() => {
    // Only attempt to reconnect if we haven't reached the maximum number of attempts
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      connectToServer();
    } else {
      console.log(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Exiting.`);
      process.exit(1);
    }
  }, RECONNECT_DELAY);
});

// Handle socket errors
socket.on("error", (err) => {
  console.error(`Connection error: ${err.message}`);
  // Increment reconnect attempts on connection errors
  reconnectAttempts++;
  
  // Don't exit on error - the close event will be triggered and we'll try to reconnect
  // unless we've reached the maximum number of attempts
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Exiting.`);
    process.exit(1);
  }
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
