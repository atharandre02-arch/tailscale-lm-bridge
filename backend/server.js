require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const port = 3001;
const LM_STUDIO_URL = process.env.LM_STUDIO_URL || "http://localhost:7002";
const LM_STUDIO_API_KEY = process.env.LM_STUDIO_API_KEY || "";
const AUTH_HEADER = LM_STUDIO_API_KEY
  ? `Bearer ${LM_STUDIO_API_KEY}`
  : undefined;

app.use(cors());
app.use(express.json());

// Health check — lets the frontend show connection status
app.get("/api/health", async (req, res) => {
  try {
    await axios.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: AUTH_HEADER ? { Authorization: AUTH_HEADER } : {},
      timeout: 5000,
    });
    res.json({ ok: true, lmStudio: LM_STUDIO_URL });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.get("/api/models", async (req, res) => {
  try {
    const response = await axios.get(`${LM_STUDIO_URL}/api/v1/models`, {
      headers: AUTH_HEADER ? { Authorization: AUTH_HEADER } : {},
      timeout: 10000,
    });
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: error.message };
    res.status(status).json(data);
  }
});

app.post("/api/chat", async (req, res) => {
  console.log(
    `[${new Date().toLocaleTimeString()}] /api/chat from ${req.ip} | model: ${req.body.model} | stream: ${req.body.stream} | prev: ${req.body.previous_response_id || "none"}`,
  );

  const isStream = req.body.stream === true;

  try {
    const response = await axios({
      method: "post",
      url: `${LM_STUDIO_URL}/api/v1/chat`,
      headers: {
        ...(AUTH_HEADER ? { Authorization: AUTH_HEADER } : {}),
        "Content-Type": "application/json",
        Accept: isStream ? "text/event-stream" : "application/json",
      },
      data: req.body,
      timeout: 300000,
      responseType: isStream ? "stream" : "json",
    });

    if (isStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      response.data.pipe(res);
      response.data.on("error", (err) => {
        console.error("Stream error:", err.message);
        res.end();
      });
    } else {
      console.log(
        `[${new Date().toLocaleTimeString()}] LM Studio responded: ${response.status}`,
      );
      res.json(response.data);
    }
  } catch (error) {
    console.error("--- PROXY ERROR (/api/chat) ---");
    const status = error.response?.status || 500;
    let data;
    try {
      data =
        typeof error.response?.data === "object" &&
        error.response?.data !== null
          ? JSON.parse(
              JSON.stringify(error.response.data, (key, val) =>
                typeof val === "object" && val !== null && key === "socket"
                  ? undefined
                  : val,
              ),
            )
          : { error: error.message };
    } catch (_) {
      data = { error: error.message };
    }
    console.error(`Status: ${status}, Message: ${error.message}`);
    res.status(status).json(data);
  }
});

// OpenAI-compatible endpoint (legacy / VS Code extensions)
app.post("/v1/chat/completions", async (req, res) => {
  console.log(
    `[${new Date().toLocaleTimeString()}] /v1/chat/completions from ${req.ip}`,
  );

  try {
    const response = await axios({
      method: "post",
      url: `${LM_STUDIO_URL}/v1/chat/completions`,
      headers: {
        ...(AUTH_HEADER ? { Authorization: AUTH_HEADER } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      data: req.body,
      timeout: 120000,
      responseType: "json",
    });

    console.log(
      `[${new Date().toLocaleTimeString()}] LM Studio responded: ${response.status}`,
    );
    res.json(response.data);
  } catch (error) {
    console.error("--- PROXY ERROR (/v1/chat/completions) ---");
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: error.message };
    console.error(`Status: ${status}, Message: ${error.message}`);
    res.status(status).json(data);
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(`LM Studio Bridge Server running on http://0.0.0.0:${port}`);
  console.log(`LM Studio backend: ${LM_STUDIO_URL}`);
  console.log(
    `Endpoints: GET /api/health, GET /api/models, POST /api/chat, POST /v1/chat/completions`,
  );
});
