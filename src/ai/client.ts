import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { EngineError } from "../errors.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

export type StructuredRequest = {
  /** Used in logs and error messages only. */
  label: string;
  system: string;
  content: string | Anthropic.Beta.BetaContentBlockParam[];
  /** JSON schema sent to the API as a structured-output constraint. Validation is still done by the caller. */
  schema: z.ZodType;
  maxTokens?: number;
};

export type StructuredResponse = {
  /** Raw text returned by the model; callers run JSON.parse -> Zod -> business validation on it. */
  raw: string;
  model: string;
};

/** Injectable LLM boundary so the engine can be tested without network calls. */
export type LlmCaller = (request: StructuredRequest) => Promise<StructuredResponse>;

export function hasAnthropicCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function createAnthropicCaller(options: { client?: Anthropic; model?: string; effort?: Effort } = {}): LlmCaller {
  const model = options.model ?? process.env.FREIGHTRECOVER_AI_MODEL ?? DEFAULT_MODEL;
  const effort = options.effort ?? (process.env.FREIGHTRECOVER_AI_EFFORT as Effort | undefined) ?? "medium";
  let client = options.client;

  return async (request) => {
    if (!client) {
      if (!hasAnthropicCredentials()) {
        throw new EngineError("AI_UNAVAILABLE", "AI extraction is not configured: ANTHROPIC_API_KEY is missing on the server.");
      }
      client = new Anthropic();
    }

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: request.maxTokens ?? 16000,
        // Server-side fallback re-runs the request on Anthropic's recommended model if it is declined.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort, format: zodOutputFormat(request.schema) },
        system: request.system,
        messages: [{ role: "user", content: request.content }],
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        throw new EngineError("AI_UNAVAILABLE", "AI provider rejected the configured credentials.");
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new EngineError("AI_REQUEST_FAILED", `AI provider rate limit reached during ${request.label}. Retry shortly.`);
      }
      if (error instanceof Anthropic.APIError) {
        throw new EngineError("AI_REQUEST_FAILED", `AI request failed during ${request.label} (status ${error.status ?? "n/a"}).`);
      }
      throw new EngineError("AI_REQUEST_FAILED", `AI request failed during ${request.label}.`, String(error));
    }

    if (response.stop_reason === "refusal") {
      throw new EngineError("AI_REFUSAL", `The AI model declined the ${request.label} request.`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new EngineError("INVALID_AI_OUTPUT", `AI output for ${request.label} was truncated.`);
    }

    const raw = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    return { raw, model: response.model };
  };
}

let defaultCaller: LlmCaller | undefined;

export function getDefaultCaller(): LlmCaller {
  defaultCaller ??= createAnthropicCaller();
  return defaultCaller;
}
