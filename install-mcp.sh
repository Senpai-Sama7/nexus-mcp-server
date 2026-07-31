#!/usr/bin/env bash
# NEXUS MCP Server — universal installer for Cline CLI, Cline VSCode, Claude Desktop,
# Claude Code, Cursor, Windsurf, Gemini CLI, and OpenCode.
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

# Build mcpServers JSON (Cline / Claude / Gemini / Cursor / Windsurf schema)
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

# Build OpenCode mcp JSON (distinct schema: mcp -> {name->{type,command[],environment,enabled,timeout}})
OPENCODE_JSON="{"
FIRST=1
for i in "${!WORKSPACES[@]}"; do
  ws="${WORKSPACES[$i]}"
  name=$([ $i -eq 0 ] && echo "nexus" || echo "nexus-$i")
  if [ $FIRST -eq 0 ]; then OPENCODE_JSON+=","; fi
  FIRST=0
  OPENCODE_JSON+="\"$name\":{\"type\":\"local\",\"command\":[\"node\",\"$NEXUS_SERVER\"],\"environment\":{\"NEXUS_WORKSPACE\":\"$ws\",\"NEXUS_LOG_LEVEL\":\"info\"},\"enabled\":true,\"timeout\":15000}"
done
OPENCODE_JSON+="}"

write_config() {
  local file="$1"
  local desc="$2"
  local schema_json="$3"
  mkdir -p "$(dirname "$file")"
  if [ -f "$file" ]; then
    python3 -c "
import json
try:
    with open('$file') as f: cfg = json.load(f)
except Exception: cfg = {}
if 'mcpServers' not in cfg: cfg['mcpServers'] = {}
cfg['mcpServers'].update(json.loads('''$schema_json'''))
with open('$file', 'w') as f: json.dump(cfg, f, indent=2)
" 2>/dev/null || echo "{\"mcpServers\":$schema_json}" > "$file"
  else
    echo "{\"mcpServers\":$schema_json}" > "$file"
  fi
  echo "  ✓ $desc → $file"
}

write_opencode_config() {
  local file="$HOME/.config/opencode/opencode.jsonc"
  [ -n "$XDG_CONFIG_HOME" ] && file="$XDG_CONFIG_HOME/opencode/opencode.jsonc"
  mkdir -p "$(dirname "$file")"
  OC_FILE="$file" OC_NEW="$OPENCODE_JSON" node -e '
const fs = require("fs");
const file = process.env.OC_FILE;
let cfg = {};
try {
  let src = fs.readFileSync(file, "utf8");
  // Best-effort JSONC -> JSON (strip // line and /* */ block comments).
  src = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  cfg = src.trim() ? JSON.parse(src) : {};
} catch (e) { cfg = {}; }
if (!cfg.mcp) cfg.mcp = {};
Object.assign(cfg.mcp, JSON.parse(process.env.OC_NEW));
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
' 2>/dev/null || printf '%s\n' "{\"mcp\":$OPENCODE_JSON}" > "$file"
  echo "  ✓ OpenCode → $file"
}

# Cline CLI / Cline VSCode extension
write_config "$HOME/.cline/cline_mcp_settings.json" "Cline CLI" "$MCP_JSON"
write_config "$HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json" "Cline VSCode" "$MCP_JSON"

# Claude Desktop
write_config "$HOME/.config/Claude/claude_desktop_config.json" "Claude Desktop" "$MCP_JSON"
write_config "$HOME/Library/Application Support/Claude/claude_desktop_config.json" "Claude Desktop (macOS)" "$MCP_JSON"

# Claude Code
write_config "$HOME/.claude.json" "Claude Code" "$MCP_JSON"

# Cursor
write_config "$HOME/.cursor/mcp.json" "Cursor" "$MCP_JSON"

# Windsurf
write_config "$HOME/.codeium/windsurf/mcp_config.json" "Windsurf" "$MCP_JSON"

# Gemini
write_config "$HOME/.gemini/settings.json" "Gemini" "$MCP_JSON"

# OpenCode (distinct JSONC schema, merged via node)
write_opencode_config

echo ""
echo "Done. NEXUS MCP server is configured. Restart your MCP client to load it."
echo "Test with: cd $NEXUS_SERVER/.. && npm run build && npm test"
