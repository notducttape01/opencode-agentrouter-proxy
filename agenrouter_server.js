const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const client = new OpenAI({
  apiKey: "sk-rbL8xzhjT2lH9v9AIxUvXNw9XYexg5akEqNBl0xKlkj11sKR",
  baseURL: "https://agentrouter.org/v1",

  defaultHeaders: {
    "HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
    "X-Title": "Roo Code",
    "User-Agent": "RooCode/3.54.0",
    "X-Stainless-Arch": "x64",
    "X-Stainless-Lang": "js",
    "X-Stainless-OS": "Windows",
    "X-Stainless-Package-Version": "5.12.2",
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": process.version
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "AgentRouter Proxy Running"
  });
});

app.get("/v1/models", (req, res) => {
  res.json({ object: "list", data: [] });
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    if (!req.body || !req.body.messages) {
      return res.status(400).json({
        error: {
          message: "Invalid request body: missing messages",
          type: "invalid_request_error",
          code: 400
        }
      });
    }

    const body = {
      ...req.body,
      stream: true
    };

    const stream = await client.chat.completions.create(body);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const chunk of stream) {
      if (chunk) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Proxy Error:", err);

    if (!res.headersSent) {
      res.status(err.status || 500).json({
        error: {
          message: err.message || "Internal proxy error",
          type: err.type || "proxy_error",
          code: err.status || 500
        }
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.end();
    }
  }
});

app.post("/v1/responses", async (req, res) => {
  try {
    if (!req.body || !req.body.input) {
      return res.status(400).json({
        error: {
          message: "Invalid request body: missing input",
          type: "invalid_request_error",
          code: 400
        }
      });
    }

    const isStream = req.body.stream !== false;
    let reasoningEffort = req.body.reasoning?.effort || req.body.reasoning_effort;

    // Ubah minimal dari OpenCode menjadi max untuk gpt-6.1-sol
    if (reasoningEffort === "minimal" && req.body.model === "gpt-6.1-sol") {
      reasoningEffort = "max";
    }

    const mapOutbound = (val) => {
      if (typeof val === "string") {
        return val
          .replace(/opencode/gi, "Roo Code")
          .replace(/^run\s+(.+)$/i, "Please check the output of: $1");
      }
      if (Array.isArray(val)) {
        return val
          .filter((item) => !(item && typeof item === "object" && item.type === "reasoning"))
          .map(mapOutbound);
      }
      if (val && typeof val === "object") {
        if (val.type === "function" && val.name === "bash") {
          return {
            ...val,
            name: "execute_command",
            description: "Execute a CLI command on the system."
          };
        }

        const out = {};
        for (const [k, v] of Object.entries(val)) {
          if (k === "id" && typeof v === "string" && /^(msg|fc|rs|resp)_/.test(v)) {
            continue;
          }
          if (k === "name" && v === "bash") {
            out[k] = "execute_command";
          } else {
            out[k] = mapOutbound(v);
          }
        }
        return out;
      }
      return val;
    };

    const mapInbound = (val) => {
      if (Array.isArray(val)) {
        return val.map(mapInbound);
      }
      if (val && typeof val === "object") {
        const out = {};
        for (const [k, v] of Object.entries(val)) {
          if (k === "name" && v === "execute_command") {
            out[k] = "bash";
          } else {
            out[k] = mapInbound(v);
          }
        }
        return out;
      }
      return val;
    };

    const body = {
      ...req.body,
      store: false,
      ...(reasoningEffort && {
        reasoning: {
          ...(req.body.reasoning || {}),
          effort: reasoningEffort
        }
      }),
      instructions: "You are Roo, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.",
      input: mapOutbound(req.body.input),
      ...(req.body.tools && { tools: mapOutbound(req.body.tools) }),
      stream: isStream
    };

    delete body.reasoning_effort;
    delete body.previous_response_id;

    if (!isStream) {
      const response = await client.responses.create(body);
      return res.json(mapInbound(response));
    }

    const stream = await client.responses.create(body);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const event of stream) {
      if (event) {
        const mappedEvent = mapInbound(event);
        if (mappedEvent.type) {
          res.write(`event: ${mappedEvent.type}\n`);
        }
        res.write(`data: ${JSON.stringify(mappedEvent)}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Responses Proxy Error:", err);

    if (!res.headersSent) {
      res.status(err.status || 500).json({
        error: {
          message: err.message || "Internal proxy error",
          type: err.type || "proxy_error",
          code: err.status || 500
        }
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.end();
    }
  }
});

const PORT = 4000;

app.listen(PORT, () => {
  console.log(`Proxy running on http://127.0.0.1:${PORT}`);
});
