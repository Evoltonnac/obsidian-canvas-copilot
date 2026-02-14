/**
 * MCP Server Manager - Manages multiple MCP server connections.
 *
 * Handles server lifecycle (add/remove/connect/disconnect),
 * tool registration/unregistration with the ToolRegistry,
 * and server status monitoring.
 */

import { logError, logInfo, logWarn } from "@/logger";
import { ToolDefinition, ToolRegistry } from "@/tools/ToolRegistry";
import { McpHttpClient, McpServerConfig, McpToolInfo } from "./McpHttpClient";
import { createMcpLangChainTool } from "./McpToolWrapper";

/** Status of an MCP server connection */
export type McpServerStatus = "disconnected" | "connecting" | "connected" | "error";

/** Server connection state */
export interface McpServerState {
  config: McpServerConfig;
  status: McpServerStatus;
  client: McpHttpClient | null;
  tools: McpToolInfo[];
  error?: string;
  lastConnected?: number;
}

/** Event callback for server state changes */
type McpServerEventCallback = (serverId: string, state: McpServerState) => void;

export class McpServerManager {
  private static instance: McpServerManager;
  private servers: Map<string, McpServerState> = new Map();
  private listeners: Set<McpServerEventCallback> = new Set();

  private constructor() {}

  static getInstance(): McpServerManager {
    if (!McpServerManager.instance) {
      McpServerManager.instance = new McpServerManager();
    }
    return McpServerManager.instance;
  }

  /**
   * Subscribe to server state changes.
   * @returns Unsubscribe function
   */
  onStateChange(callback: McpServerEventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(serverId: string, state: McpServerState): void {
    for (const listener of this.listeners) {
      try {
        listener(serverId, state);
      } catch (error) {
        logError("[McpServerManager] Error in state change listener:", error);
      }
    }
  }

  /**
   * Add a server configuration and optionally connect.
   */
  async addServer(config: McpServerConfig, autoConnect = true): Promise<void> {
    const state: McpServerState = {
      config,
      status: "disconnected",
      client: null,
      tools: [],
    };
    this.servers.set(config.id, state);
    this.notifyListeners(config.id, state);

    if (autoConnect && config.enabled) {
      await this.connectServer(config.id);
    }
  }

  /**
   * Remove a server and unregister its tools.
   */
  removeServer(serverId: string): void {
    this.disconnectServer(serverId);
    this.servers.delete(serverId);
  }

  /**
   * Update the server configuration.
   */
  async updateServer(config: McpServerConfig): Promise<void> {
    const existing = this.servers.get(config.id);
    if (existing) {
      // Disconnect the old connection first
      this.disconnectServer(config.id);
    }

    // Re-add with new config
    await this.addServer(config, config.enabled);
  }

  /**
   * Connect to an MCP server and register its tools.
   */
  async connectServer(serverId: string): Promise<void> {
    const state = this.servers.get(serverId);
    if (!state) {
      logWarn(`[McpServerManager] Server not found: ${serverId}`);
      return;
    }

    try {
      state.status = "connecting";
      state.error = undefined;
      this.notifyListeners(serverId, state);

      // Create client from config (with header decryption)
      const client = await McpHttpClient.fromConfig(state.config);

      // Initialize the session
      await client.initialize();

      // Discover tools
      const tools = await client.listTools();

      // Update state
      state.client = client;
      state.tools = tools;
      state.status = "connected";
      state.lastConnected = Date.now();
      this.notifyListeners(serverId, state);

      // Register tools with ToolRegistry
      this.registerMcpTools(serverId, tools, client);

      logInfo(
        `[McpServerManager] Connected to ${state.config.name}, discovered ${tools.length} tools`
      );
    } catch (error) {
      state.status = "error";
      state.error = error instanceof Error ? error.message : String(error);
      state.client = null;
      state.tools = [];
      this.notifyListeners(serverId, state);

      logError(`[McpServerManager] Failed to connect to ${state.config.name}:`, error);
    }
  }

  /**
   * Disconnect from an MCP server and unregister its tools.
   */
  disconnectServer(serverId: string): void {
    const state = this.servers.get(serverId);
    if (!state) return;

    // Unregister tools
    this.unregisterMcpTools(serverId);

    // Update state
    state.client = null;
    state.status = "disconnected";
    state.tools = [];
    this.notifyListeners(serverId, state);

    logInfo(`[McpServerManager] Disconnected from ${state.config.name}`);
  }

  /**
   * Get the current state for a server.
   */
  getServerState(serverId: string): McpServerState | undefined {
    return this.servers.get(serverId);
  }

  /**
   * Get all server states.
   */
  getAllServerStates(): Map<string, McpServerState> {
    return new Map(this.servers);
  }

  /**
   * Get all connected servers.
   */
  getConnectedServers(): McpServerState[] {
    return Array.from(this.servers.values()).filter((s) => s.status === "connected");
  }

  /**
   * Initialize from saved configurations.
   */
  async initializeFromConfigs(configs: McpServerConfig[]): Promise<void> {
    // Clear existing servers
    for (const serverId of this.servers.keys()) {
      this.disconnectServer(serverId);
    }
    this.servers.clear();

    // Add and connect enabled servers
    for (const config of configs) {
      await this.addServer(config, config.enabled);
    }
  }

  /**
   * Test connection to a server without persisting.
   * @returns The list of tools or throws an error.
   */
  async testConnection(config: McpServerConfig): Promise<McpToolInfo[]> {
    const client = await McpHttpClient.fromConfig(config);
    await client.initialize();
    return await client.listTools();
  }

  /**
   * Register MCP tools with the global ToolRegistry.
   */
  private registerMcpTools(serverId: string, tools: McpToolInfo[], client: McpHttpClient): void {
    const registry = ToolRegistry.getInstance();

    for (const mcpTool of tools) {
      // Use shortened ID for consistency
      const toolId = `mcp_${mcpTool.name}`;
      const langchainTool = createMcpLangChainTool(serverId, mcpTool, client);

      const definition: ToolDefinition = {
        tool: langchainTool,
        metadata: {
          id: toolId,
          displayName: mcpTool.name,
          description: mcpTool.description || `MCP tool from ${serverId}`,
          category: "mcp",
          isAlwaysEnabled: false,
          mcpServerId: serverId,
          mcpServerName: this.servers.get(serverId)?.config.name || serverId,
          customPromptInstructions: mcpTool.description
            ? `For ${mcpTool.name}: ${mcpTool.description}`
            : undefined,
        },
      };

      registry.register(definition);
      logInfo(`[McpServerManager] Registered MCP tool: ${toolId}`);
    }
  }

  /**
   * Unregister all MCP tools from a specific server.
   */
  private unregisterMcpTools(serverId: string): void {
    const registry = ToolRegistry.getInstance();
    const allTools = registry.getAllTools();
    const prefix = `mcp_`;

    // Filter out tools from this server
    const remainingTools = allTools.filter((t) => !t.metadata.id.startsWith(prefix));

    // Clear and re-register remaining tools
    registry.clear();
    registry.registerAll(remainingTools);

    logInfo(`[McpServerManager] Unregistered tools for server: ${serverId}`);
  }

  /**
   * Cleanup all connections.
   */
  cleanup(): void {
    for (const serverId of this.servers.keys()) {
      this.disconnectServer(serverId);
    }
    this.servers.clear();
    this.listeners.clear();
  }
}
