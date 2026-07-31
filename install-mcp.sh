#!/usr/bin/env bash
# NEXUS MCP Server — installer for Cline CLI, Claude Desktop, and other MCP clients.
# Usage: ./install-mcp.sh [nexus-workspace-path] [second-workspace-path] ...

set -e

NEXUS_SERVER="$(cd "$(dirname "$0")" && pwd)/dist/server.js"

if [ ! -f "$NEXUS_SERVER" ]; then
  echo "ERROR: NEXUS server not found at $NEXUS_SERVER. Run 'npm run build' first."
  exit 1
fi

# Default workspaces if none provided
WORKSPACES=("$@")
if [ ${#WORKSPACES[@]} -eq 0 ]; then
  WORKSPACES=("$PWD")
fi

echo "Installing NEXUS MCP server for ${#WORKSPACES[@]} workspace(s):"
for ws in "${WORKSPACES[@]}"; do echo "  - $ws"; done

# Build mcpServers JSON
MCP_JSON="{"
FIRST=1
for i in "${!WORKSPACES[@]}"; do
  ws="${WORKSPACES[$i]}"
  name=$([ $i -eq 0 ] && echo "nexus" || echo "nexus-$i")
  if [ $FIRST -eq 0 ]; then MCP_JSON+=","; fi
  FIRST=0
  MCP_JSON+="\"$name\":{\"command\":\"node\",\"args\":[\"$NEXUS_SERVER\"],\"env\":{\"NEXUS_WORKSPACE\":\"$ws\",\"NEXUS_LOG_LEVEL\":\"info\"},\"disabled\":false,\"autoApprove\":[]}"
done
MCP_JSON+="}"

write_config() {
  local file="$1"
  local desc="$2"
  mkdir -p "$(dirname "$file")"
  if [ -f "$file" ]; then
    # Merge with existing config to preserve other MCP servers
    local existing
    existing=$(cat "$file" 2>/dev/null || echo '{}')
    python3 -c "
import json, sys
try:
    with open('$file') as f: cfg = json.load(f)
except: cfg = {}
if 'mcpServers' not in cfg: cfg['mcpServers'] = {}
new_servers = json.loads('''$MCP_JSON''')
cfg['mcpServers'].update(new_servers)
with open('$file', 'w') as f: json.dump(cfg, f, indent=2)
" 2>/dev/null || echo "$MCP_JSON" > "$file"
  else
    echo "{\"mcpServers\":$MCP_JSON}" > "$file"
  fi
  echo "  ✓ $desc → $file"
}

# Cline CLI / Cline VSCode extension
write_config "$HOME/.cline/cline_mcp_settings.json" "Cline CLI"
write_config "$HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" "Cline VSCode"

# Claude Desktop
write_config "$HOME/.config/Claude/claude_desktop_config.json" "Claude Desktop"
write_config "$HOME/Library/Application Support/Claude/claude_desktop_config.json" "Claude Desktop (macOS)"

# Claude Code
write_config "$HOME/.claude.json" "Claude Code"

# Cursor
write_config "$HOME/.cursor/mcp.json" "Cursor"

# Windsurf
write_config "$HOME/.codeium/windsurf/mcp_config.json" "Windsurf"

# Gemini
write_config "$HOME/.gemini/settings.json" "Gemini"

echo ""
echo "Done. NEXUS MCP server is configured. Restart your MCP client to load it."
echo "Test with: cd $NEXUS_SERVER/.. && npm run test:client"
