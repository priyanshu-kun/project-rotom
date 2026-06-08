import { claudeCliProvider } from "../generation/claudeCli.provider.js";
import type { GenerationProvider } from "../generation/provider.js";
import { buildSystemContract } from "../generation/prompts.js";
import { buildJdExtractionPrompt } from "./jd.prompts.js";
import { structuredJdJsonSchema, structuredJdSchema, type StructuredJd } from "./jd.schema.js";

/**
 * Structure raw job-posting text into a {@link StructuredJd} via the AI layer.
 * Synchronous (one CLI call, P50<5s per the NFR) because it feeds the create →
 * review step before the user triggers the heavier, queued generation.
 *
 * The provider is injected for testability; defaults to the shared CLI provider.
 */
export async function extractStructuredJd(
  rawText: string,
  provider: GenerationProvider = claudeCliProvider,
): Promise<StructuredJd> {
  const result = await provider.generate<StructuredJd>({
    systemContract: buildSystemContract({ jsonOnly: true }),
    userPrompt: buildJdExtractionPrompt(rawText),
    jsonSchema: structuredJdJsonSchema,
    outputSchema: structuredJdSchema,
  });
  // structured is guaranteed present because outputSchema was supplied.
  return result.structured ?? structuredJdSchema.parse(JSON.parse(result.text));
}
