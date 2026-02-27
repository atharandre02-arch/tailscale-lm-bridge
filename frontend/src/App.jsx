import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { marked } from "marked";
import "./index.css";

marked.use({ breaks: true, gfm: true });

// ── Model presets — auto-applied when model is selected ──────────────────────
// ── Model presets — auto-applied when model is selected ──────────────────────
const MODEL_PRESETS = {
  "qwen3-8b": {
    badge: "🧠",
    label: "Qwen3 8B",
    note: "Thinking model — reasons internally, ~2 tok/s",
    temperature: 0.6,
    reasoning: "off",
    maxTokens: 16384,
    contextLength: 32768,
  },
  "qwen2.5-coder-7b-instruct@q4_k_m": {
    badge: "⚡",
    label: "Qwen2.5 Coder 7B",
    note: "Tool model — Optimized for MCP",
    temperature: 0.2, // LM Studio 'unity-parser' standard for tools
    reasoning: "off",
    maxTokens: 8192,
    contextLength: 32768,
  },
  "qwen/qwen3-4b-thinking-2507": {
    badge: "💭",
    label: "Qwen3 4B Thinking",
    note: "Compact thinking + tool model",
    temperature: 0.2,
    reasoning: "low",
    maxTokens: 8192,
    contextLength: 32768,
  },
  "meta-llama-3-8b-instruct": {
    badge: "🦙",
    label: "Llama 3 8B",
    note: "General purpose",
    temperature: 0.2,
    reasoning: "off",
    maxTokens: 4096,
    contextLength: 16384,
  },
};

// ── System prompts — optimized for context efficiency ───────────────────────
const SYSTEM_PROMPT_TOOL = `Unity6 d:\\GithubRepos\\unity-mcp-beta.
1. Read 'mcpforunity://editor/state' first.
2. Edit -> refresh_unity(scope="scripts", compile="request") -> read_console(types=["error"]).
3. Use 'batch_execute' for 2+ ops.
4. Architect: VContainer, ScriptableObjects.
Concise results only.`;

const QWEN_TOOL_TEMPLATE = `{%- if tools %}
    {{- '<|im_start|>system\\n' }}
    {%- if messages[0]['role'] == 'system' %}
        {{- messages[0]['content'] }}
    {%- else %}
        {{- 'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.' }}
    {%- endif %}
    {{- "\\n\\n# Tools\\n\\nYou may call one or more functions to assist with the user query.\\n\\nYou are provided with function signatures within <tools></tools> XML tags:\\n<tools>" }}
    {%- for tool in tools %}
        {{- "\\n" }}
        {{- tool | tojson }}
    {%- endfor %}
    {{- "\\n</tools>\\n\\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\\n<tool_call>\\n{\\"name\\": <function-name>, \\"arguments\\": <args-json-object>}\\n</tool_call><|im_end|>\\n" }}
{%- else %}
    {%- if messages[0]['role'] == 'system' %}
        {{- '<|im_start|>system\\n' + messages[0]['content'] + '<|im_end|>' }}
    {%- endif %}
{%- endif %}`;

const SYSTEM_PROMPT_THINKING = `Unity 6 Architect using 'unity-mcp-orchestrator'.
PROJECT: d:\\GithubRepos\\unity-mcp-beta

PLANNING WORKFLOW:
1. Inspect Editor State readiness.
2. Formulate 'batch_execute' multi-step plans.
3. Architecture: Prefer VContainer/ScriptableObjects. Optimize for Unity 6 (low allocations).
Verify all results with console logs and screenshots.`;

const getSystemPrompt = (modelId) => {
  const preset = MODEL_PRESETS[modelId];
  if (!preset) return SYSTEM_PROMPT_TOOL;
  return preset.reasoning !== "off" || modelId.includes("thinking")
    ? SYSTEM_PROMPT_THINKING
    : SYSTEM_PROMPT_TOOL;
};

const getPreset = (modelId) => {
  return (
    MODEL_PRESETS[modelId] || {
      badge: "🤖",
      label: modelId,
      note: "Standard model",
      temperature: 0.3,
      reasoning: "off",
      maxTokens: 4096,
      contextLength: 16384,
    }
  );
};

// ── Quick actions ─────────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  {
    label: "📋 Scene",
    prompt: "Get editor status and list all GameObjects in the current scene.",
  },
  {
    label: "🎯 Selection",
    prompt: "What is currently selected in the Unity editor?",
  },
  {
    label: "➕ Empty GO",
    prompt:
      'Create a new empty GameObject named "NewObject" in the current scene.',
  },
  {
    label: "📷 Camera",
    prompt: "Find the main camera and show its transform.",
  },
  { label: "🏷️ Tags", prompt: "List all tags and layers in the project." },
];

const UNITY_MCP_LABEL = "unity";

function MarkdownMessage({ content }) {
  const html = useMemo(() => marked.parse(content || ""), [content]);
  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function App() {
  const [messages, setMessages] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("lm_messages") || "[]");
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [responseId, setResponseId] = useState(
    () => localStorage.getItem("lm_response_id") || null,
  );
  const [models, setModels] = useState([]);

  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem("lm_model") || "qwen3-8b",
  );
  const [temperature, setTemperature] = useState(() => {
    const m = localStorage.getItem("lm_model") || "qwen3-8b";
    return getPreset(m).temperature;
  });
  const [reasoning, setReasoning] = useState(() => {
    const m = localStorage.getItem("lm_model") || "qwen3-8b";
    return getPreset(m).reasoning;
  });

  const [streamText, setStreamText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [mcpServers, setMcpServers] = useState("");
  const [unityMcpEnabled, setUnityMcpEnabled] = useState(
    () => localStorage.getItem("unity_mcp_enabled") === "true",
  );
  const [connected, setConnected] = useState(null);
  const [tokenStats, setTokenStats] = useState(null);
  const [promptProgress, setPromptProgress] = useState(null);

  // Advanced Inference Stats
  const [topP, setTopP] = useState(0.7);
  const [topK, setTopK] = useState(40);
  const [minP, setMinP] = useState(0.05);
  const [repeatPenalty, setRepeatPenalty] = useState(1.1);
  const [maxOutputTokens, setMaxOutputTokens] = useState(4096);
  const [ctxLength, setCtxLength] = useState(32768);
  const [configPreset, setConfigPreset] = useState("@local:unity-parser");
  const [useCustomTemplate, setUseCustomTemplate] = useState(true);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const currentPreset = useMemo(() => getPreset(selectedModel), [selectedModel]);

  // ── Persistence ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (responseId) localStorage.setItem("lm_response_id", responseId);
    else localStorage.removeItem("lm_response_id");
  }, [responseId]);
  useEffect(() => {
    localStorage.setItem("lm_messages", JSON.stringify(messages));
  }, [messages]);
  useEffect(() => {
    localStorage.setItem("lm_model", selectedModel);
  }, [selectedModel]);
  useEffect(() => {
    localStorage.setItem("unity_mcp_enabled", String(unityMcpEnabled));
  }, [unityMcpEnabled]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // ── Fetch models from LM Studio ─────────────────────────────────────────────
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch(
          `http://${window.location.hostname}:3001/api/models`,
        );
        const data = await res.json();
        // LM Studio Responses API returns { models: [...] }
        // OpenAI-compat returns { data: [...] }
        const list = data?.models || data?.data || [];
        // Only show LLM models, not embeddings
        setModels(list.filter((m) => m.type === "llm" || !m.type));
      } catch (e) {
        console.error("Failed to fetch models:", e);
      }
    };
    fetchModels();
  }, []);

  // ── Health check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(
          `http://${window.location.hostname}:3001/api/health`,
        );
        setConnected(res.ok);
      } catch {
        setConnected(false);
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  // ── Apply preset when model changes ─────────────────────────────────────────
  const handleModelChange = (modelId) => {
    setSelectedModel(modelId);
    const preset = getPreset(modelId);
    setTemperature(preset.temperature);
    setReasoning(preset.reasoning);
    setMaxOutputTokens(preset.maxTokens || 4096);
    setCtxLength(preset.contextLength || 32768);

    // Reset session
    setResponseId(null);
    setMessages([]);
    setTokenStats(null);
  };

  // ── Build integrations list ──────────────────────────────────────────────────
  const buildIntegrations = useCallback(() => {
    const integrations = [];
    if (unityMcpEnabled) {
      integrations.push({
        type: "plugin",
        id: "mcp/unity-mcp",
      });
    }
    mcpServers
      .split("\n")
      .filter(Boolean)
      .forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("mcp/")) {
          integrations.push({ type: "plugin", id: trimmed });
        } else if (trimmed.startsWith("http")) {
          const [url, ...labelParts] = trimmed.split(" ");
          integrations.push({
            type: "ephemeral_mcp",
            server_label: labelParts.join(" ") || "custom",
            server_url: url,
          });
        } else {
          integrations.push({ type: "plugin", id: `mcp/${trimmed}` });
        }
      });
    return integrations.length > 0 ? integrations : undefined;
  }, [mcpServers, unityMcpEnabled]);

  // ── Send message ─────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (overrideInput) => {
      const text = (overrideInput ?? input).trim();
      if (!text || isLoading) return;

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setInput("");
      setIsLoading(true);
      setStreamText("");
      setTokenStats(null);
      setPromptProgress(null);
      if (inputRef.current) inputRef.current.style.height = "auto";

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const preset = getPreset(selectedModel);
        const integrations = buildIntegrations();
        const body = {
          model: selectedModel,
          input: text,
          stream: true,
          temperature,
          max_tokens: maxOutputTokens,
          top_p: topP,
          top_k: topK,
          min_p: minP,
          repeat_penalty: repeatPenalty,
          predictionConfig: {
            promptTemplate: (useCustomTemplate && selectedModel.toLowerCase().includes("qwen")) ? QWEN_TOOL_TEMPLATE : undefined,
            presetId: configPreset || undefined,
          },
        };

        if (!responseId) {
          body.system_prompt = getSystemPrompt(selectedModel);
        } else {
          body.previous_response_id = responseId;
        }

        if (reasoning !== "off" && reasoning !== "none") body.reasoning = reasoning;
        if (integrations) body.integrations = integrations;

        const response = await fetch(
          `http://${window.location.hostname}:3001/api/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(
            errData.error?.message ||
              errData.error ||
              `HTTP ${response.status}`,
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";
        let toolCalls = [];
        let reasoningContent = "";
        let newResponseId = null;
        let currentToolCall = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") continue;

            try {
              const event = JSON.parse(payload);

              switch (event.type) {
                // ── LM Studio Responses API SSE events ──
                case "message.delta":
                  fullContent += event.content || "";
                  setStreamText(fullContent);
                  break;
                case "reasoning.start":
                  break; // thinking begins — no action needed
                case "reasoning.delta":
                  reasoningContent += event.content || "";
                  break;
                case "prompt_processing.progress":
                  setPromptProgress(event.progress ?? null);
                  break;
                case "prompt_processing.end":
                  setPromptProgress(null);
                  break;
                case "chat.end":
                  // response_id and stats are nested under event.result
                  if (event.result?.response_id)
                    newResponseId = event.result.response_id;
                  if (event.result?.stats) setTokenStats(event.result.stats);
                  break;
                // ── Tool calls ──
                case "tool_call.start":
                  currentToolCall = {
                    tool: event.tool || "",
                    arguments: {},
                    output: "",
                    _argStr: "",
                  };
                  break;
                case "tool_call.arguments.delta":
                  if (currentToolCall)
                    currentToolCall._argStr += event.content || "";
                  break;
                case "tool_call.output":
                  if (currentToolCall)
                    currentToolCall.output = event.content || "";
                  break;
                case "tool_call.end":
                  if (currentToolCall) {
                    try {
                      currentToolCall.arguments = JSON.parse(
                        currentToolCall._argStr || "{}",
                      );
                    } catch {
                      // ignore malformed tool args
                    }
                    delete currentToolCall._argStr;
                    toolCalls.push(currentToolCall);
                    currentToolCall = null;
                  }
                  break;
              }
            } catch {
              // skip malformed
            }
          }
        }

        if (newResponseId) setResponseId(newResponseId);

        const parts = [];
        if (toolCalls.length > 0)
          parts.push({ role: "tool", tools: toolCalls });
        if (reasoningContent)
          parts.push({ role: "reasoning", content: reasoningContent });
        parts.push({
          role: "assistant",
          content: fullContent || "(No response)",
        });

        setMessages((prev) => [...prev, ...parts]);
        setStreamText("");
      } catch (error) {
        if (error.name === "AbortError") return;
        console.error("Chat Error:", error);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ ${error.message}` },
        ]);
        setStreamText("");
      } finally {
        setIsLoading(false);
        setPromptProgress(null);
        abortRef.current = null;
      }
    },
    [
      input,
      isLoading,
      selectedModel,
      temperature,
      topP,
      topK,
      minP,
      repeatPenalty,
      maxOutputTokens,
      ctxLength,
      configPreset,
      useCustomTemplate,
      reasoning,
      responseId,
      buildIntegrations,
    ],
  );

  const handleStop = () => {
    abortRef.current?.abort();
    setIsLoading(false);
    setPromptProgress(null);
    if (streamText) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: streamText },
      ]);
      setStreamText("");
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setResponseId(null);
    setStreamText("");
    setTokenStats(null);
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  const statusColor =
    connected === null ? "#888" : connected ? "#4caf50" : "#f44336";

  // Sort models: loaded first
  const sortedModels = useMemo(() => {
    return [...models].sort((a, b) => {
      const aLoaded = (a.loaded_instances?.length ?? 0) > 0;
      const bLoaded = (b.loaded_instances?.length ?? 0) > 0;
      if (aLoaded && !bLoaded) return -1;
      if (!aLoaded && bLoaded) return 1;
      return 0;
    });
  }, [models]);

  const renderMessage = (msg, i) => {
    if (msg.role === "tool") {
      return (
        <div key={i} className="message tool-call">
          <div className="tool-label">🔧 Tool Calls</div>
          {msg.tools.map((tc, j) => (
            <ToolCallItem key={j} tc={tc} />
          ))}
        </div>
      );
    }
    if (msg.role === "reasoning") {
      return (
        <div key={i} className="message reasoning">
          <details>
            <summary>💭 Reasoning ({msg.content.length} chars)</summary>
            <pre>{msg.content}</pre>
          </details>
        </div>
      );
    }
    return (
      <div key={i} className={`message ${msg.role === "user" ? "user" : "ai"}`}>
        {msg.role === "assistant" ? (
          <MarkdownMessage content={msg.content} />
        ) : (
          msg.content
        )}
      </div>
    );
  };

  return (
    <div className="main-layout">
      {/* Header */}
      <header className="glass header-bar">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexShrink: 0,
          }}
        >
          <span
            title={connected ? "LM Studio connected" : "LM Studio unreachable"}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusColor,
            }}
          />
          <span style={{ fontSize: "13px", fontWeight: 700, opacity: 0.9 }}>
            LM
          </span>
        </div>

        {/* Model selector */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            className="model-select"
          >
            {sortedModels.length === 0 ? (
              <option value={selectedModel}>
                {currentPreset.badge} {currentPreset.label}
              </option>
            ) : (
              sortedModels.map((m) => {
                const p = getPreset(m.key);
                const loaded = (m.loaded_instances?.length ?? 0) > 0;
                return (
                  <option key={m.key} value={m.key}>
                    {loaded ? "● " : "○ "}
                    {p.badge} {m.display_name || m.key}
                  </option>
                );
              })
            )}
          </select>
          {currentPreset.note && (
            <div
              style={{
                fontSize: "9px",
                opacity: 0.45,
                paddingLeft: "4px",
                marginTop: "1px",
              }}
            >
              {currentPreset.badge} {currentPreset.note}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
          <button
            onClick={() => setUnityMcpEnabled((v) => !v)}
            className={`icon-btn ${unityMcpEnabled ? "active" : ""}`}
            title="Toggle Unity MCP"
          >
            🎮
          </button>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="icon-btn"
            title="Settings"
          >
            ⚙️
          </button>
          <button
            onClick={handleNewChat}
            className="icon-btn"
            title="New chat"
            style={{ fontSize: "11px", padding: "5px 8px" }}
          >
            New
          </button>
        </div>
      </header>

      {/* Settings panel */}
      {showSettings && (
        <div className="glass settings-panel">
          <div className="settings-grid">
            <div className="settings-row">
              <label>Temp:</label>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
              <span>{temperature}</span>
            </div>
            <div className="settings-row">
              <label>Top P:</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={topP}
                onChange={(e) => setTopP(parseFloat(e.target.value))}
              />
              <span>{topP}</span>
            </div>
            <div className="settings-row">
              <label>Top K:</label>
              <input
                type="number"
                value={topK}
                onChange={(e) => setTopK(parseInt(e.target.value))}
                className="mini-input"
              />
            </div>
            <div className="settings-row">
              <label>Penalty:</label>
              <input
                type="number"
                step="0.05"
                value={repeatPenalty}
                onChange={(e) => setRepeatPenalty(parseFloat(e.target.value))}
                className="mini-input"
              />
            </div>
            <div className="settings-row">
              <label>Max Out:</label>
              <input
                type="number"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(parseInt(e.target.value))}
                className="mini-input"
              />
            </div>
            <div className="settings-row">
              <label>Context:</label>
              <input
                type="number"
                value={ctxLength}
                onChange={(e) => setCtxLength(parseInt(e.target.value))}
                className="mini-input"
              />
            </div>
            <div className="settings-row">
              <label>Reasoning:</label>
              <select
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                className="mini-select"
              >
                <option value="off">Off</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="settings-row">
              <label>Preset:</label>
              <select
                value={configPreset}
                onChange={(e) => setConfigPreset(e.target.value)}
                className="mini-select"
              >
                <option value="">None</option>
                <option value="@local:unity-parser">unity-parser</option>
                <option value="@local:qwen-coder-serena">serena</option>
                <option value="@local:unityMCP preset">unityMCP</option>
              </select>
            </div>
          </div>

          <div className="settings-checkbox">
            <label>
              <input
                type="checkbox"
                checked={useCustomTemplate}
                onChange={(e) => setUseCustomTemplate(e.target.checked)}
              />
              Use optimized Qwen Tool Template (Jinja)
            </label>
          </div>

          <div style={{ marginTop: "8px" }}>
            <label style={{ opacity: 0.6, fontSize: "11px" }}>
              Extra MCP servers (one per line):
            </label>
            <textarea
              value={mcpServers}
              onChange={(e) => setMcpServers(e.target.value)}
              placeholder={"mcp/plugin-id\nhttps://server-url label"}
              rows={2}
              className="mcp-textarea"
            />
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="quick-actions">
        {QUICK_ACTIONS.map((qa, i) => (
          <button
            key={i}
            onClick={() => handleSend(qa.prompt)}
            disabled={isLoading}
            className="qa-btn"
          >
            {qa.label}
          </button>
        ))}
      </div>

      {/* Chat */}
      <div className="chat-container">
        {messages.length === 0 && !streamText && (
          <div className="empty-state">
            {unityMcpEnabled
              ? `🎮 Unity MCP active · ${currentPreset.badge} ${currentPreset.label}`
              : `${currentPreset.badge} ${currentPreset.label} — ${currentPreset.note}`}
          </div>
        )}
        {messages.map(renderMessage)}
        {promptProgress !== null && (
          <div className="message ai thinking">
            Processing prompt… {Math.round(promptProgress * 100)}%
          </div>
        )}
        {streamText && (
          <div className="message ai streaming">
            <MarkdownMessage content={streamText} />
            <span className="cursor">▊</span>
          </div>
        )}
        {isLoading && !streamText && promptProgress === null && (
          <div className="message ai thinking">Thinking…</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="input-area">
        <div className="input-wrapper glass">
          <textarea
            ref={inputRef}
            rows="1"
            placeholder={`Message ${currentPreset.label}…`}
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          {isLoading ? (
            <button onClick={handleStop} className="stop-btn">
              Stop
            </button>
          ) : (
            <button onClick={() => handleSend()}>Send</button>
          )}
        </div>
        <div className="status-bar">
          {responseId && (
            <span title={responseId}>Session: {responseId.slice(0, 12)}…</span>
          )}
          {tokenStats && (
            <span title="Token stats">
              {tokenStats.input_tokens}↑ {tokenStats.total_output_tokens}↓
              {tokenStats.tokens_per_second
                ? ` · ${tokenStats.tokens_per_second.toFixed(1)} tok/s`
                : ""}
              {tokenStats.time_to_first_token_seconds
                ? ` · ${tokenStats.time_to_first_token_seconds.toFixed(1)}s TTFT`
                : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolCallItem({ tc }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="tool-item">
      <div className="tool-item-header" onClick={() => setExpanded((v) => !v)}>
        <strong>{tc.tool}</strong>
        <span className="tool-expand">{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && (
        <>
          <pre className="tool-args">
            {JSON.stringify(tc.arguments, null, 2)}
          </pre>
          {tc.output && (
            <div className="tool-output">
              {tc.output.length > 800
                ? tc.output.slice(0, 800) + "…"
                : tc.output}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;
