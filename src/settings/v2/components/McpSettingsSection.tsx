/**
 * MCP Settings Section - Settings UI for MCP server configuration.
 *
 * Provides a full management interface for adding, editing, deleting,
 * and testing MCP server connections.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { McpServerConfig } from "@/mcp/McpHttpClient";
import { McpServerManager, McpServerStatus } from "@/mcp/McpServerManager";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Check, Eye, EyeOff, Loader2, Pencil, Plus, PlugZap, Trash2, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";

/** Status badge colors */
const STATUS_COLORS: Record<McpServerStatus, string> = {
  disconnected: "tw-bg-muted",
  connecting: "tw-bg-accent",
  connected: "tw-bg-interactive-accent",
  error: "tw-bg-error",
};

const STATUS_LABELS: Record<McpServerStatus, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting...",
  connected: "Connected",
  error: "Error",
};

/** Header entry for edit form */
interface HeaderEntry {
  key: string;
  value: string;
  showValue: boolean;
}

const McpServerEditForm: React.FC<{
  server?: McpServerConfig;
  onSave: (config: McpServerConfig) => void;
  onCancel: () => void;
}> = ({ server, onSave, onCancel }) => {
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [headers, setHeaders] = useState<HeaderEntry[]>(() => {
    if (server?.headers) {
      return Object.entries(server.headers).map(([key, value]) => ({
        key,
        value,
        showValue: false,
      }));
    }
    return [];
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleAddHeader = () => {
    setHeaders([...headers, { key: "", value: "", showValue: false }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const handleHeaderChange = (index: number, field: "key" | "value", val: string) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: val };
    setHeaders(newHeaders);
  };

  const handleSave = () => {
    if (!name.trim() || !url.trim()) return;

    const headerObj: Record<string, string> = {};
    for (const h of headers) {
      if (h.key.trim()) {
        headerObj[h.key.trim()] = h.value;
      }
    }

    onSave({
      id: server?.id ?? uuidv4(),
      name: name.trim(),
      url: url.trim(),
      headers: Object.keys(headerObj).length > 0 ? headerObj : undefined,
      enabled: server?.enabled ?? true,
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const config: McpServerConfig = {
        id: "test",
        name: name.trim(),
        url: url.trim(),
        headers: headers.reduce(
          (acc, h) => {
            if (h.key.trim()) acc[h.key.trim()] = h.value;
            return acc;
          },
          {} as Record<string, string>
        ),
        enabled: true,
      };

      const manager = McpServerManager.getInstance();
      const tools = await manager.testConnection(config);
      setTestResult({
        success: true,
        message: `Connected! Found ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`,
      });
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="tw-space-y-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-4">
      <div className="tw-text-sm tw-font-medium">{server ? "Edit Server" : "Add Server"}</div>

      <div className="tw-space-y-2">
        <div className="tw-text-xs tw-text-muted">Name</div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My MCP Server"
          className="tw-w-full"
        />
      </div>

      <div className="tw-space-y-2">
        <div className="tw-text-xs tw-text-muted">URL</div>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:3000/mcp"
          className="tw-w-full"
        />
      </div>

      <div className="tw-space-y-2">
        <div className="tw-flex tw-items-center tw-justify-between">
          <div className="tw-text-xs tw-text-muted">Headers</div>
          <Button variant="ghost" size="sm" onClick={handleAddHeader} className="tw-h-6 tw-px-2">
            <Plus className="tw-mr-1 tw-size-3" />
            Add
          </Button>
        </div>
        {headers.map((header, index) => (
          <div key={index} className="tw-flex tw-items-center tw-gap-2">
            <Input
              value={header.key}
              onChange={(e) => handleHeaderChange(index, "key", e.target.value)}
              placeholder="Header name"
              className="tw-flex-1"
            />
            <div className="tw-relative tw-flex tw-flex-1 tw-items-center">
              <Input
                value={header.value}
                onChange={(e) => handleHeaderChange(index, "value", e.target.value)}
                placeholder="Value"
                className="tw-w-full tw-pr-10"
                type={header.showValue ? "text" : "password"}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  const newHeaders = [...headers];
                  newHeaders[index] = {
                    ...newHeaders[index],
                    showValue: !newHeaders[index].showValue,
                  };
                  setHeaders(newHeaders);
                }}
                className="tw-absolute tw-right-1 tw-size-7"
                title={header.showValue ? "隐藏" : "显示"}
              >
                {header.showValue ? (
                  <EyeOff className="tw-size-4" />
                ) : (
                  <Eye className="tw-size-4" />
                )}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleRemoveHeader(index)}
              className="tw-size-8 tw-shrink-0"
            >
              <X className="tw-size-4" />
            </Button>
          </div>
        ))}
      </div>

      {testResult && (
        <div
          className={`tw-rounded tw-p-2 tw-text-xs ${
            testResult.success ? "tw-text-success" : "tw-text-error"
          }`}
        >
          {testResult.message}
        </div>
      )}

      <div className="tw-flex tw-items-center tw-gap-2 tw-pt-2">
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={!name.trim() || !url.trim()}
        >
          <Check className="tw-mr-1 tw-size-4" />
          Save
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleTest}
          disabled={testing || !url.trim()}
        >
          {testing ? (
            <Loader2 className="tw-mr-1 tw-size-4 tw-animate-spin" />
          ) : (
            <PlugZap className="tw-mr-1 tw-size-4" />
          )}
          Test
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
};

export const McpSettingsSection: React.FC = () => {
  const settings = useSettingsValue();
  const mcpServers = settings.mcpServers ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [serverStatuses, setServerStatuses] = useState<Record<string, McpServerStatus>>({});

  // Subscribe to server state changes
  useEffect(() => {
    const manager = McpServerManager.getInstance();
    const unsubscribe = manager.onStateChange((serverId, state) => {
      setServerStatuses((prev) => ({ ...prev, [serverId]: state.status }));
    });

    // Initialize status from current state
    const states = manager.getAllServerStates();
    const initial: Record<string, McpServerStatus> = {};
    for (const [id, state] of states) {
      initial[id] = state.status;
    }
    setServerStatuses(initial);

    return unsubscribe;
  }, []);

  const saveServers = useCallback((newServers: McpServerConfig[]) => {
    updateSetting("mcpServers", newServers);
  }, []);

  const handleAddServer = (config: McpServerConfig) => {
    const newServers = [...mcpServers, config];
    saveServers(newServers);
    setIsAdding(false);

    // Connect the new server
    const manager = McpServerManager.getInstance();
    manager.addServer(config, config.enabled);
  };

  const handleEditServer = (config: McpServerConfig) => {
    const newServers = mcpServers.map((s) => (s.id === config.id ? config : s));
    saveServers(newServers);
    setEditingId(null);

    // Reconnect with updated config
    const manager = McpServerManager.getInstance();
    manager.updateServer(config);
  };

  const handleDeleteServer = (serverId: string) => {
    const newServers = mcpServers.filter((s) => s.id !== serverId);
    saveServers(newServers);

    // Remove the server connection
    const manager = McpServerManager.getInstance();
    manager.removeServer(serverId);
  };

  const handleToggleServer = async (serverId: string, enabled: boolean) => {
    const newServers = mcpServers.map((s) => (s.id === serverId ? { ...s, enabled } : s));
    saveServers(newServers);

    const manager = McpServerManager.getInstance();
    if (enabled) {
      await manager.connectServer(serverId);
    } else {
      manager.disconnectServer(serverId);
    }
  };

  const handleReconnect = async (serverId: string) => {
    const manager = McpServerManager.getInstance();
    await manager.connectServer(serverId);
  };

  return (
    <div className="tw-space-y-4">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div>
          <div className="tw-text-sm tw-font-medium">MCP Servers</div>
          <div className="tw-text-xs tw-text-muted">
            Connect external tools via Model Context Protocol (HTTP)
          </div>
        </div>
        {!isAdding && (
          <Button variant="default" size="sm" onClick={() => setIsAdding(true)}>
            <Plus className="tw-mr-1 tw-size-4" />
            Add Server
          </Button>
        )}
      </div>

      {isAdding && (
        <McpServerEditForm onSave={handleAddServer} onCancel={() => setIsAdding(false)} />
      )}

      {mcpServers.length === 0 && !isAdding && (
        <div className="tw-rounded-lg tw-border tw-border-dashed tw-border-border tw-p-6 tw-text-center tw-text-xs tw-text-muted">
          No MCP servers configured. Click &quot;Add Server&quot; to connect external tools.
        </div>
      )}

      {mcpServers.map((server) => {
        const status = serverStatuses[server.id] ?? "disconnected";

        if (editingId === server.id) {
          return (
            <McpServerEditForm
              key={server.id}
              server={server}
              onSave={handleEditServer}
              onCancel={() => setEditingId(null)}
            />
          );
        }

        return (
          <div
            key={server.id}
            className="tw-flex tw-items-center tw-justify-between tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3"
          >
            <div className="tw-flex tw-items-center tw-gap-3">
              <div
                className={`tw-size-2 tw-rounded-full ${STATUS_COLORS[status]}`}
                title={STATUS_LABELS[status]}
              />
              <div>
                <div className="tw-text-sm tw-font-medium">{server.name}</div>
                <div className="tw-text-xs tw-text-muted">{server.url}</div>
                {status === "error" && (
                  <div className="tw-text-xs tw-text-error">
                    {McpServerManager.getInstance().getServerState(server.id)?.error}
                  </div>
                )}
              </div>
            </div>

            <div className="tw-flex tw-items-center tw-gap-2">
              {status === "error" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReconnect(server.id)}
                  title="Reconnect"
                >
                  <PlugZap className="tw-size-4" />
                </Button>
              )}
              <SettingSwitch
                checked={server.enabled}
                onCheckedChange={(checked) => handleToggleServer(server.id, checked)}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEditingId(server.id)}
                className="tw-size-8"
                title="Edit"
              >
                <Pencil className="tw-size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleDeleteServer(server.id)}
                className="tw-size-8 hover:tw-text-error"
                title="Delete"
              >
                <Trash2 className="tw-size-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
