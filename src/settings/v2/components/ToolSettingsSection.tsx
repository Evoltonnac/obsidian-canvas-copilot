import React, { useState } from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { AGENT_MAX_ITERATIONS_LIMIT } from "@/constants";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { ToolDefinition, ToolRegistry } from "@/tools/ToolRegistry";
import { TruncatedText } from "@/components/TruncatedText";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const ToolSettingsSection: React.FC = () => {
  const settings = useSettingsValue();
  const registry = ToolRegistry.getInstance();

  const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []);

  // Get configurable tools grouped by category
  const toolsByCategory = registry.getToolsByCategory();
  const configurableTools = registry.getConfigurableTools();

  // Track collapsed state for MCP server groups
  const [collapsedServers, setCollapsedServers] = useState<Set<string>>(new Set());

  const handleToolToggle = (toolId: string, enabled: boolean) => {
    const newEnabledIds = new Set(enabledToolIds);
    if (enabled) {
      newEnabledIds.add(toolId);
    } else {
      newEnabledIds.delete(toolId);
    }

    updateSetting("autonomousAgentEnabledToolIds", Array.from(newEnabledIds));
  };

  const toggleServerCollapse = (serverId: string) => {
    setCollapsedServers((prev) => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  };

  const handleServerGroupToggle = (toolIds: string[], enabled: boolean) => {
    const newEnabledIds = new Set(enabledToolIds);
    for (const id of toolIds) {
      if (enabled) {
        newEnabledIds.add(id);
      } else {
        newEnabledIds.delete(id);
      }
    }
    updateSetting("autonomousAgentEnabledToolIds", Array.from(newEnabledIds));
  };

  /** Render a single tool item with truncated description */
  const renderToolItem = (def: ToolDefinition) => {
    const { metadata } = def;
    return (
      <div
        key={metadata.id}
        className="tw-flex tw-items-center tw-justify-between tw-gap-4 tw-py-2"
      >
        <div className="tw-min-w-0 tw-flex-1 tw-space-y-0.5">
          <div className="tw-text-sm tw-font-medium tw-leading-none">{metadata.displayName}</div>
          {metadata.description && (
            <TruncatedText lineClamp={2} className="tw-text-xs tw-text-muted">
              {metadata.description}
            </TruncatedText>
          )}
        </div>
        <div className="tw-shrink-0">
          <SettingSwitch
            checked={enabledToolIds.has(metadata.id)}
            onCheckedChange={(checked) => handleToolToggle(metadata.id, checked)}
          />
        </div>
      </div>
    );
  };

  /** Render non-MCP tools by category */
  const renderNonMcpTools = () => {
    const categories = Array.from(toolsByCategory.entries()).filter(
      ([category, tools]) => category !== "mcp" && tools.some((t) => configurableTools.includes(t))
    );

    return categories.map(([category, tools]) => {
      const configurableInCategory = tools.filter((t) => configurableTools.includes(t));
      if (configurableInCategory.length === 0) return null;

      return (
        <React.Fragment key={category}>
          {configurableInCategory.map((def) => renderToolItem(def))}
        </React.Fragment>
      );
    });
  };

  /** Render MCP tools grouped by server */
  const renderMcpTools = () => {
    const mcpTools = (toolsByCategory.get("mcp") || []).filter((t) =>
      configurableTools.includes(t)
    );

    if (mcpTools.length === 0) return null;

    // Group by serverId
    const byServer = new Map<string, ToolDefinition[]>();
    for (const def of mcpTools) {
      const serverId = def.metadata.mcpServerId || "unknown";
      if (!byServer.has(serverId)) {
        byServer.set(serverId, []);
      }
      byServer.get(serverId)!.push(def);
    }

    return Array.from(byServer.entries()).map(([serverId, tools]) => {
      const isCollapsed = collapsedServers.has(serverId);
      const toolIds = tools.map((t) => t.metadata.id);
      const allEnabled = toolIds.every((id) => enabledToolIds.has(id));
      const someEnabled = toolIds.some((id) => enabledToolIds.has(id));
      const serverName = tools[0]?.metadata.mcpServerName || serverId;

      return (
        <div key={serverId} className="tw-overflow-hidden tw-rounded-md tw-border tw-border-border">
          {/* Server group header */}
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-bg-secondary tw-px-3 tw-py-2">
            <button
              onClick={() => toggleServerCollapse(serverId)}
              className="tw-flex tw-min-w-0 tw-flex-1 tw-cursor-pointer tw-items-center tw-gap-1.5 tw-border-none tw-bg-transparent tw-p-0 tw-text-left"
            >
              <ChevronRight
                className={cn(
                  "tw-size-4 tw-shrink-0 tw-text-muted tw-transition-transform tw-duration-200",
                  !isCollapsed && "tw-rotate-90"
                )}
              />
              <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted">
                MCP: {serverName}
              </span>
              <span className="tw-text-xs tw-text-muted">({tools.length})</span>
            </button>
            <div className="tw-shrink-0" title={allEnabled ? "Disable all" : "Enable all"}>
              <SettingSwitch
                checked={allEnabled}
                indeterminate={!allEnabled && someEnabled}
                onCheckedChange={(checked) => handleServerGroupToggle(toolIds, checked)}
              />
            </div>
          </div>

          {/* Tool list (collapsible) */}
          {!isCollapsed && (
            <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border tw-px-3">
              {tools.map((def) => renderToolItem(def))}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <>
      <SettingItem
        type="slider"
        title="Max Iterations"
        description="Maximum number of reasoning iterations the autonomous agent can perform. Higher values allow for more complex reasoning but may take longer."
        value={settings.autonomousAgentMaxIterations ?? 4}
        onChange={(value) => {
          updateSetting("autonomousAgentMaxIterations", value);
        }}
        min={4}
        max={AGENT_MAX_ITERATIONS_LIMIT}
        step={1}
      />

      <div className="tw-mt-4 tw-rounded-lg tw-bg-secondary tw-p-4">
        <div className="tw-mb-2 tw-text-sm tw-font-medium">Agent Accessible Tools</div>
        <div className="tw-mb-4 tw-text-xs tw-text-muted">
          Toggle which tools the autonomous agent can use
        </div>

        <div className="tw-flex tw-flex-col tw-gap-2">
          {renderNonMcpTools()}
          {renderMcpTools()}
        </div>
      </div>
    </>
  );
};
