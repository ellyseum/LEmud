import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { ConnectedClient } from "../../types";
import { colorize } from "../../utils/colors";
import { writeToClient } from "../../utils/socketWriter";
import { Command } from "../command.interface";
import { UserManager } from "../../user/userManager";
import { SudoCommand } from "./sudo.command";
import { createContextLogger } from "../../utils/logger";

// Create a context-specific logger for BugReport command
const bugReportLogger = createContextLogger("BugReport");

// Define bug report interface
export interface BugReport {
  id: string;
  user: string;
  datetime: string;
  report: string;
  logs: {
    raw: string | null;
    user: string | null;
  };
  solved: boolean;
  solvedOn: string | null;
  solvedBy: string | null;
  solvedReason: string | null;
}

// Pending bug report interface for reports awaiting confirmation
interface PendingBugReport {
  message: string;
  timestamp: number; // Used to expire old reports
}

// Track the confirmation state for the clear command
enum ClearConfirmationState {
  INITIAL = "initial",
  CONFIRMED_ONCE = "confirmed_once",
}

// Interface for tracking clear operations
interface PendingClearOperation {
  state: ClearConfirmationState;
  timestamp: number; // Used to expire old operations
}

export class BugReportCommand implements Command {
  name = "bugreport";
  description =
    'Report a bug or issue to the admins. Use "bugreport <your message>" to submit a report.';
  private userManager: UserManager;
  private sudoCommand: SudoCommand | undefined;
  private bugReportsFilePath: string;
  private bugReports: BugReport[] = [];

  // Map to store pending reports by username
  private pendingReports: Map<string, PendingBugReport> = new Map();
  // Map to store pending clear operations by username
  private pendingClearOperations: Map<string, PendingClearOperation> =
    new Map();
  // Timeout for pending reports in milliseconds (10 minutes)
  private readonly PENDING_REPORT_TIMEOUT = 10 * 60 * 1000;
  // Timeout for pending clear operations in milliseconds (2 minutes)
  private readonly PENDING_CLEAR_TIMEOUT = 2 * 60 * 1000;

  constructor(userManager: UserManager) {
    this.userManager = userManager;
    this.bugReportsFilePath = path.join(
      __dirname,
      "../../../data/bug-reports.json"
    );
    this.loadBugReports();
  }

  /**
   * Load bug reports from the JSON file
   */
  private loadBugReports(): void {
    try {
      if (fs.existsSync(this.bugReportsFilePath)) {
        const data = fs.readFileSync(this.bugReportsFilePath, "utf8");
        const bugReportData = JSON.parse(data);
        this.bugReports = bugReportData.reports || [];
      } else {
        // Create default empty bug reports file if it doesn't exist
        this.bugReports = [];
        this.saveBugReports();
      }
      bugReportLogger.info(`Loaded ${this.bugReports.length} bug reports`);
    } catch (error) {
      bugReportLogger.error("Error loading bug reports:", error);
      // Default to empty array if file can't be loaded
      this.bugReports = [];
    }
  }

  /**
   * Save bug reports to the JSON file
   */
  private saveBugReports(): void {
    try {
      const bugReportData = { reports: this.bugReports };
      fs.writeFileSync(
        this.bugReportsFilePath,
        JSON.stringify(bugReportData, null, 2),
        "utf8"
      );
      bugReportLogger.info("Saved bug reports");
    } catch (error) {
      bugReportLogger.error("Error saving bug reports:", error);
    }
  }

  /**
   * Set the SudoCommand instance for admin privilege checking
   */
  public setSudoCommand(sudoCommand: SudoCommand): void {
    this.sudoCommand = sudoCommand;
  }

  /**
   * Check if user is an admin
   */
  private isAdmin(username: string): boolean {
    if (!this.sudoCommand) return false;
    return this.sudoCommand.isAuthorized(username);
  }

  /**
   * Clean up expired pending reports and clear operations
   */
  private cleanupPendingOperations(): void {
    const now = Date.now();

    // Clean up expired pending reports
    for (const [username, pendingReport] of this.pendingReports.entries()) {
      if (now - pendingReport.timestamp > this.PENDING_REPORT_TIMEOUT) {
        this.pendingReports.delete(username);
      }
    }

    // Clean up expired clear operations
    for (const [
      username,
      clearOperation,
    ] of this.pendingClearOperations.entries()) {
      if (now - clearOperation.timestamp > this.PENDING_CLEAR_TIMEOUT) {
        this.pendingClearOperations.delete(username);
      }
    }
  }

  execute(client: ConnectedClient, args: string): void {
    if (!client.user) return;

    // Make sure we have sudo command reference for admin privilege checking
    if (!this.sudoCommand) {
      if (client.stateData?.commands?.get("sudo")) {
        this.sudoCommand = client.stateData.commands.get("sudo") as SudoCommand;
      }
    }

    // Clean up old pending reports and clear operations periodically
    this.cleanupPendingOperations();

    const parts = args.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();
    const subAction = parts[1]?.toLowerCase();

    // Handle admin commands
    if (this.isAdmin(client.user.username)) {
      // Handle clear command with confirmations
      if (action === "clear") {
        // Check for the first confirmation step
        if (subAction === "confirm") {
          this.handleClearConfirm(client);
          return;
        }

        // Check for the final confirmation step
        if (subAction === "confirmreally") {
          this.handleClearConfirmReally(client);
          return;
        }

        // Initial clear command
        this.initiateClearing(client);
        return;
      }

      if (action && ["list", "solve", "reopen", "help"].includes(action)) {
        // Handle other admin actions
        switch (action) {
          case "list":
            const filter = parts[1]?.toLowerCase() || "all";
            this.listBugReports(client, filter);
            break;

          case "solve":
            const solveId = parts[1];
            if (!solveId) {
              writeToClient(
                client,
                colorize("Error: Missing bug report ID to solve.\r\n", "red")
              );
              writeToClient(
                client,
                colorize("Usage: bugreport solve <id> [reason]\r\n", "yellow")
              );
              return;
            }
            // Get the solve reason, which is everything after the ID
            const solveReasonParts = parts.slice(2);
            const solveReason =
              solveReasonParts.length > 0 ? solveReasonParts.join(" ") : null;
            this.solveBugReport(client, solveId, solveReason);
            break;

          case "reopen":
            const reopenId = parts[1];
            if (!reopenId) {
              writeToClient(
                client,
                colorize("Error: Missing bug report ID to reopen.\r\n", "red")
              );
              writeToClient(
                client,
                colorize("Usage: bugreport reopen <id>\r\n", "yellow")
              );
              return;
            }
            this.reopenBugReport(client, reopenId);
            break;

          case "help":
          default:
            this.showAdminHelp(client);
            break;
        }
        return;
      }
    }

    // Check if a non-admin is trying to use admin commands
    if (
      !this.isAdmin(client.user.username) &&
      action &&
      ["list", "solve", "reopen", "clear"].includes(action)
    ) {
      writeToClient(
        client,
        colorize(
          `Error: The 'bugreport ${action}' command is only available to admins.\r\n`,
          "red"
        )
      );
      writeToClient(
        client,
        colorize(
          `To report a bug, use 'bugreport <your message>'\r\n`,
          "yellow"
        )
      );
      return;
    }

    // Handle confirm/cancel commands for pending reports
    if (action === "confirm") {
      if (this.pendingReports.has(client.user.username)) {
        const pendingReport = this.pendingReports.get(client.user.username)!;
        this.createBugReport(client, pendingReport.message);
        this.pendingReports.delete(client.user.username);
      } else {
        writeToClient(
          client,
          colorize(
            "You don't have any pending bug reports to confirm.\r\n",
            "yellow"
          )
        );
      }
      return;
    }

    if (action === "cancel") {
      // Check if there's a pending report to cancel
      if (this.pendingReports.has(client.user.username)) {
        this.pendingReports.delete(client.user.username);
        writeToClient(client, colorize("Bug report cancelled.\r\n", "yellow"));
        return;
      }

      // Check if there's a pending clear operation to cancel
      if (this.pendingClearOperations.has(client.user.username)) {
        this.pendingClearOperations.delete(client.user.username);
        writeToClient(
          client,
          colorize("Clear operation cancelled.\r\n", "yellow")
        );
        return;
      }

      writeToClient(
        client,
        colorize(
          "You don't have any pending operations to cancel.\r\n",
          "yellow"
        )
      );
      return;
    }

    // If no args provided, show help
    if (!args.trim()) {
      if (this.isAdmin(client.user.username)) {
        this.showAdminHelp(client);
      } else {
        this.showHelp(client);
      }
      return;
    }

    // Create pending report
    this.createPendingReport(client, args);
  }

  private createPendingReport(client: ConnectedClient, message: string): void {
    if (!client.user) return;

    // Store the pending report
    this.pendingReports.set(client.user.username, {
      message,
      timestamp: Date.now(),
    });

    // Show confirmation message
    writeToClient(
      client,
      colorize("\r\n=== Bug Report Confirmation ===\r\n", "magenta")
    );
    writeToClient(
      client,
      colorize(
        `You are about to submit the following bug report:\r\n`,
        "yellow"
      )
    );
    writeToClient(client, colorize(`"${message}"\r\n\r\n`, "white"));
    writeToClient(
      client,
      colorize(`To confirm and send this report, type: `, "yellow")
    );
    writeToClient(client, colorize(`bugreport confirm\r\n`, "green"));
    writeToClient(client, colorize(`To cancel this report, type: `, "yellow"));
    writeToClient(client, colorize(`bugreport cancel\r\n`, "red"));
    writeToClient(
      client,
      colorize(
        `Note: This pending report will expire in 10 minutes if not confirmed.\r\n`,
        "cyan"
      )
    );
    writeToClient(
      client,
      colorize("===============================\r\n", "magenta")
    );
  }

  private createBugReport(client: ConnectedClient, message: string): void {
    if (!client.user) return;

    // Get log paths
    const date = new Date();
    const formattedDate = date.toISOString().split("T")[0]; // YYYY-MM-DD
    const rawLogPath = this.findLatestRawLog(client);
    const userLogPath = `/logs/players/${client.user.username}-${formattedDate}.log`;

    // Create new bug report
    const newReport: BugReport = {
      id: uuidv4(),
      user: client.user.username,
      datetime: new Date().toISOString(),
      report: message,
      logs: {
        raw: rawLogPath,
        user: userLogPath,
      },
      solved: false,
      solvedOn: null,
      solvedBy: null,
      solvedReason: null,
    };

    // Add the report
    this.bugReports.push(newReport);
    this.saveBugReports();

    bugReportLogger.info(
      `New bug report from ${client.user.username}: ${message.substring(
        0,
        50
      )}${message.length > 50 ? "..." : ""}`
    );

    // Confirm to the user
    writeToClient(
      client,
      colorize("\r\n=== Bug Report Submitted ===\r\n", "green")
    );
    writeToClient(
      client,
      colorize(
        `Thank you for your report. It has been logged with ID: ${newReport.id}\r\n`,
        "green"
      )
    );
    writeToClient(
      client,
      colorize(
        `An admin will review your report as soon as possible.\r\n`,
        "green"
      )
    );
    writeToClient(
      client,
      colorize("================================\r\n", "green")
    );

    // Notify online admins if any
    this.notifyAdmins(client.user.username, newReport.id, message);
  }

  private findLatestRawLog(client: ConnectedClient): string | null {
    try {
      // Check if client has connection property with an id
      if (!client.connection) {
        bugReportLogger.warn("Client connection ID not found");
        return null;
      }

      const id = client.connection.getId();
      if (!id) {
        bugReportLogger.warn("Client connection ID is empty");
        return null;
      }

      // Get the current date in YYYY-MM-DD format
      const date = new Date();
      const formattedDate = date.toISOString().split("T")[0]; // YYYY-MM-DD

      // Build the expected filename
      const filename = `${id}-${formattedDate}.log`;
      const filePath = path.join(
        __dirname,
        "../../../logs/raw-sessions",
        filename
      );

      // Check if file exists
      if (fs.existsSync(filePath)) {
        bugReportLogger.info(`Found raw log file: ${filename}`);
        return `/logs/raw-sessions/${filename}`;
      }

      bugReportLogger.warn(`Raw log file not found: ${filename}`);
      return null;
    } catch (error) {
      bugReportLogger.error(`Error finding raw log: ${error}`);
      return null;
    }
  }

  private notifyAdmins(
    username: string,
    reportId: string,
    message: string
  ): void {
    if (!this.sudoCommand) return;

    const users = this.userManager.getAllUsers();
    const truncatedMessage =
      message.length > 30 ? `${message.substring(0, 30)}...` : message;

    for (const user of users) {
      if (this.sudoCommand.isAuthorized(user.username)) {
        const adminClient = this.userManager.getActiveUserSession(
          user.username
        );
        if (adminClient) {
          writeToClient(
            adminClient,
            colorize(
              `\r\n[ADMIN] New bug report from ${username} (ID: ${reportId}): "${truncatedMessage}"\r\n`,
              "yellow"
            )
          );
          writeToClient(
            adminClient,
            colorize(`Use 'bugreport list' to see all reports.\r\n`, "yellow")
          );
        }
      }
    }
  }

  private listBugReports(client: ConnectedClient, filter: string): void {
    if (!client.user) return;

    let filteredReports: BugReport[];

    switch (filter) {
      case "open":
        filteredReports = this.bugReports.filter((report) => !report.solved);
        break;
      case "closed":
        filteredReports = this.bugReports.filter((report) => report.solved);
        break;
      case "all":
      default:
        filteredReports = [...this.bugReports];
        break;
    }

    if (filteredReports.length === 0) {
      writeToClient(
        client,
        colorize(`No ${filter} bug reports found.\r\n`, "yellow")
      );
      return;
    }

    // Sort by date (newest first)
    filteredReports.sort(
      (a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
    );

    writeToClient(
      client,
      colorize(`=== ${filter.toUpperCase()} Bug Reports ===\r\n`, "magenta")
    );

    filteredReports.forEach((report) => {
      const reportDate = new Date(report.datetime).toLocaleString();
      const statusColor = report.solved ? "green" : "red";
      const statusText = report.solved ? "SOLVED" : "OPEN";

      writeToClient(client, colorize(`ID: ${report.id}\r\n`, "cyan"));
      writeToClient(
        client,
        colorize(`Status: `, "white") +
          colorize(`${statusText}\r\n`, statusColor)
      );
      writeToClient(
        client,
        colorize(`From: ${report.user} on ${reportDate}\r\n`, "white")
      );
      writeToClient(client, colorize(`Report: ${report.report}\r\n`, "white"));

      if (report.solved && report.solvedBy && report.solvedOn) {
        const solvedDate = new Date(report.solvedOn).toLocaleString();
        writeToClient(
          client,
          colorize(
            `Solved by: ${report.solvedBy} on ${solvedDate}\r\n`,
            "green"
          )
        );
        if (report.solvedReason) {
          writeToClient(
            client,
            colorize(`Reason: ${report.solvedReason}\r\n`, "green")
          );
        }
      }

      writeToClient(
        client,
        colorize(
          `Logs: ${report.logs.raw || "N/A"}, ${report.logs.user || "N/A"}\r\n`,
          "yellow"
        )
      );
      writeToClient(
        client,
        colorize("------------------------\r\n", "magenta")
      );
    });

    // Show commands for managing reports
    writeToClient(
      client,
      colorize(
        "Commands: bugreport solve <id>, bugreport reopen <id>\r\n",
        "yellow"
      )
    );
    writeToClient(client, colorize("=======================\r\n", "magenta"));
  }

  private solveBugReport(
    client: ConnectedClient,
    reportId: string,
    reason: string | null = null
  ): void {
    if (!client.user) return;

    const reportIndex = this.bugReports.findIndex(
      (report) => report.id === reportId
    );

    if (reportIndex === -1) {
      writeToClient(
        client,
        colorize(
          `Error: Bug report with ID "${reportId}" not found.\r\n`,
          "red"
        )
      );
      return;
    }

    const report = this.bugReports[reportIndex];

    if (report.solved) {
      writeToClient(
        client,
        colorize(`Bug report "${reportId}" is already solved.\r\n`, "yellow")
      );
      return;
    }

    // Mark as solved
    this.bugReports[reportIndex].solved = true;
    this.bugReports[reportIndex].solvedOn = new Date().toISOString();
    this.bugReports[reportIndex].solvedBy = client.user.username;
    this.bugReports[reportIndex].solvedReason = reason;

    this.saveBugReports();

    bugReportLogger.info(
      `Admin ${client.user.username} marked bug report ${reportId} as solved${
        reason ? ` with reason: ${reason}` : ""
      }`
    );
    writeToClient(
      client,
      colorize(
        `Bug report "${reportId}" has been marked as solved.\r\n`,
        "green"
      )
    );
    if (reason) {
      writeToClient(client, colorize(`Solve reason: "${reason}"\r\n`, "green"));
    }

    // Notify the user who submitted the report if they're online
    const reporterClient = this.userManager.getActiveUserSession(report.user);
    if (reporterClient) {
      writeToClient(
        reporterClient,
        colorize(
          `\r\nAdmin ${
            client.user.username
          } has resolved your bug report: "${report.report.substring(0, 50)}${
            report.report.length > 50 ? "..." : ""
          }"\r\n`,
          "green"
        )
      );

      if (reason) {
        writeToClient(
          reporterClient,
          colorize(`Resolution: ${reason}\r\n`, "green")
        );
      }
    }
  }

  private reopenBugReport(client: ConnectedClient, reportId: string): void {
    if (!client.user) return;

    const reportIndex = this.bugReports.findIndex(
      (report) => report.id === reportId
    );

    if (reportIndex === -1) {
      writeToClient(
        client,
        colorize(
          `Error: Bug report with ID "${reportId}" not found.\r\n`,
          "red"
        )
      );
      return;
    }

    const report = this.bugReports[reportIndex];

    if (!report.solved) {
      writeToClient(
        client,
        colorize(`Bug report "${reportId}" is already open.\r\n`, "yellow")
      );
      return;
    }

    // Reopen the report
    this.bugReports[reportIndex].solved = false;
    this.bugReports[reportIndex].solvedOn = null;
    // Keep the solvedBy and solvedReason fields for history purposes

    this.saveBugReports();

    bugReportLogger.info(
      `Admin ${client.user.username} reopened bug report ${reportId}`
    );
    writeToClient(
      client,
      colorize(`Bug report "${reportId}" has been reopened.\r\n`, "green")
    );

    // Notify the user who submitted the report if they're online
    const reporterClient = this.userManager.getActiveUserSession(report.user);
    if (reporterClient) {
      writeToClient(
        reporterClient,
        colorize(
          `\r\nAdmin ${
            client.user.username
          } has reopened your bug report: "${report.report.substring(0, 50)}${
            report.report.length > 50 ? "..." : ""
          }"\r\n`,
          "yellow"
        )
      );
    }
  }

  private showHelp(client: ConnectedClient): void {
    writeToClient(client, colorize("=== Bug Report System ===\r\n", "magenta"));
    writeToClient(client, colorize("Usage:\r\n", "yellow"));
    writeToClient(
      client,
      colorize(
        "  bugreport <message> - Create a bug report (requires confirmation)\r\n",
        "cyan"
      )
    );
    writeToClient(
      client,
      colorize(
        "  bugreport confirm - Confirm and submit your pending bug report\r\n",
        "cyan"
      )
    );
    writeToClient(
      client,
      colorize(
        "  bugreport cancel - Cancel your pending bug report\r\n",
        "cyan"
      )
    );
    writeToClient(client, colorize("\r\nExample:\r\n", "yellow"));
    writeToClient(
      client,
      colorize(
        "  bugreport My sword disappeared after I quit and logged back in\r\n",
        "white"
      )
    );
    writeToClient(client, colorize("  bugreport confirm\r\n", "white"));
    writeToClient(
      client,
      colorize(
        "\r\nPlease provide as much detail as possible, including what you were doing when\r\n",
        "white"
      )
    );
    writeToClient(
      client,
      colorize(
        "the issue occurred and steps to reproduce if possible.\r\n",
        "white"
      )
    );
    writeToClient(client, colorize("=======================\r\n", "magenta"));
  }

  private showAdminHelp(client: ConnectedClient): void {
    writeToClient(
      client,
      colorize("=== Bug Report Admin Commands ===\r\n", "magenta")
    );
    writeToClient(client, colorize("Usage:\r\n", "yellow"));
    writeToClient(
      client,
      colorize(
        "  bugreport list [filter] - List bug reports (filter: open, closed, all)\r\n",
        "cyan"
      )
    );
    writeToClient(
      client,
      colorize(
        "  bugreport solve <id> [reason] - Mark a bug report as solved with optional reason\r\n",
        "cyan"
      )
    );
    writeToClient(
      client,
      colorize(
        "  bugreport reopen <id> - Reopen a solved bug report\r\n",
        "cyan"
      )
    );
    writeToClient(
      client,
      colorize(
        "  bugreport clear - Clear all bug reports (requires confirmation)\r\n",
        "cyan"
      )
    );
    writeToClient(
      client,
      colorize("  bugreport help - Show this help message\r\n", "cyan")
    );
    writeToClient(client, colorize("\r\nExamples:\r\n", "yellow"));
    writeToClient(
      client,
      colorize(
        "  bugreport solve dd5b7291-8976-4017-bd25-422a655d274e Fixed in latest update\r\n",
        "white"
      )
    );
    writeToClient(
      client,
      colorize(
        "  bugreport reopen dd5b7291-8976-4017-bd25-422a655d274e\r\n",
        "white"
      )
    );
    writeToClient(
      client,
      colorize("===============================\r\n", "magenta")
    );
  }

  private initiateClearing(client: ConnectedClient): void {
    if (!client.user) return;

    this.pendingClearOperations.set(client.user.username, {
      state: ClearConfirmationState.INITIAL,
      timestamp: Date.now(),
    });

    writeToClient(
      client,
      colorize("\r\n=== Clear Bug Reports Confirmation ===\r\n", "magenta")
    );
    writeToClient(
      client,
      colorize("You are about to clear all bug reports.\r\n", "yellow")
    );
    writeToClient(client, colorize("This action cannot be undone.\r\n", "red"));
    writeToClient(
      client,
      colorize("To confirm, type: bugreport clear confirm\r\n", "green")
    );
    writeToClient(
      client,
      colorize("To cancel, type: bugreport cancel\r\n", "red")
    );
    writeToClient(
      client,
      colorize("===============================\r\n", "magenta")
    );
  }

  private handleClearConfirm(client: ConnectedClient): void {
    if (!client.user) return;

    const pendingOperation = this.pendingClearOperations.get(
      client.user.username
    );
    if (
      !pendingOperation ||
      pendingOperation.state !== ClearConfirmationState.INITIAL
    ) {
      writeToClient(
        client,
        colorize("Error: No pending clear operation found.\r\n", "red")
      );
      return;
    }

    pendingOperation.state = ClearConfirmationState.CONFIRMED_ONCE;
    pendingOperation.timestamp = Date.now();

    writeToClient(
      client,
      colorize(
        "\r\n=== Final Clear Bug Reports Confirmation ===\r\n",
        "magenta"
      )
    );
    writeToClient(
      client,
      colorize("You have confirmed the clear operation.\r\n", "yellow")
    );
    writeToClient(
      client,
      colorize("!! THIS CANNOT BE UNDONE !!\r\n", "brightRed")
    );
    writeToClient(
      client,
      colorize(
        "To proceed and clear all bug reports, type: bugreport clear confirmreally\r\n",
        "green"
      )
    );
    writeToClient(
      client,
      colorize("To cancel, type: bugreport cancel\r\n", "red")
    );
    writeToClient(
      client,
      colorize("===============================\r\n", "magenta")
    );
  }

  private handleClearConfirmReally(client: ConnectedClient): void {
    if (!client.user) return;

    const pendingOperation = this.pendingClearOperations.get(
      client.user.username
    );
    if (
      !pendingOperation ||
      pendingOperation.state !== ClearConfirmationState.CONFIRMED_ONCE
    ) {
      writeToClient(
        client,
        colorize("Error: No pending clear operation found.\r\n", "red")
      );
      return;
    }

    this.bugReports = [];
    this.saveBugReports();
    this.pendingClearOperations.delete(client.user.username);

    bugReportLogger.info(
      `Admin ${client.user.username} cleared all bug reports.`
    );
    writeToClient(
      client,
      colorize("All bug reports have been cleared.\r\n", "green")
    );
  }
}
