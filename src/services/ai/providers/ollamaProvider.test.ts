import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

import { fetch } from "@tauri-apps/plugin-http";
import { createOllamaProvider, clearOllamaProvider } from "./ollamaProvider";

const mockFetch = vi.mocked(fetch);

function jsonResponse(body: unknown, init: Partial<Response> = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  } as unknown as Response;
}

describe("ollamaProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOllamaProvider();
  });

  describe("complete", () => {
    it("posts OpenAI-compatible chat completions with model and messages", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: "Hello!" } }],
      }));

      const provider = createOllamaProvider("http://localhost:11434", "llama3.2");
      const result = await provider.complete({
        systemPrompt: "You are helpful",
        userContent: "Hi",
      });

      expect(result).toBe("Hello!");
      expect(mockFetch).toHaveBeenCalledWith("http://localhost:11434/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      });
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body);
      expect(body).toEqual({
        model: "llama3.2",
        max_tokens: 1024,
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hi" },
        ],
      });
    });

    it("normalizes trailing slashes and /v1 suffixes from server URL", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: "Hello!" } }],
      }));

      const provider = createOllamaProvider("http://localhost:11434///", "llama3.2");
      await provider.complete({ systemPrompt: "sys", userContent: "user" });

      expect(mockFetch.mock.calls[0]![0]).toBe("http://localhost:11434/v1/chat/completions");
    });

    it("adds Authorization only when an API key is configured", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: "Hello!" } }],
      }));

      const provider = createOllamaProvider("http://localhost:1234", "local-model", "secret");
      await provider.complete({ systemPrompt: "sys", userContent: "user" });

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:1234/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret",
        },
        body: expect.any(String),
      });
    });

    it("returns empty string when no content is returned", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: null } }] }));

      const provider = createOllamaProvider("http://localhost:11434", "llama3.2");
      const result = await provider.complete({
        systemPrompt: "sys",
        userContent: "user",
      });

      expect(result).toBe("");
    });

    it("uses LM Studio native chat endpoint for multimodal messages", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        output: [{ type: "message", content: "vision answer" }],
      }));

      const provider = createOllamaProvider("http://localhost:1234", "vision-model");
      const result = await provider.complete({
        systemPrompt: "ignored",
        userContent: "ignored",
        messages: [
          { role: "user", content: [
            { type: "text", text: "Describe" },
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
          ] },
        ],
      });

      expect(result).toBe("vision answer");
      expect(mockFetch.mock.calls[0]![0]).toBe("http://localhost:1234/api/v1/chat");
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as { body: string }).body);
      expect(body.input).toEqual([
        { type: "text", content: "Собеседник: Describe" },
        { type: "image", data_url: "data:image/png;base64,abc" },
      ]);
    });
  });

  describe("testConnection", () => {
    it("returns true when models and chat endpoints succeed", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ data: [{ id: "llama3.2" }] }))
        .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "hi" } }] }));

      const provider = createOllamaProvider("http://localhost:11434", "llama3.2");
      expect(await provider.testConnection()).toBe(true);
      expect(mockFetch.mock.calls[0]![0]).toBe("http://localhost:11434/v1/models");
      expect(mockFetch.mock.calls[1]![0]).toBe("http://localhost:11434/v1/chat/completions");
    });

    it("returns false when the server rejects a request", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(
        { error: { message: "Connection refused" } },
        { ok: false, status: 500, statusText: "Server Error" },
      ));

      const provider = createOllamaProvider("http://localhost:11434", "llama3.2");
      expect(await provider.testConnection()).toBe(false);
    });
  });
});
