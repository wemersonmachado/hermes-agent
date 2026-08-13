import { describe, expect, it } from "vitest";
import { AGENT_DISPLAY_NAME, AGENT_NAME, BROW_PERSONALITY_PROMPT } from "./identity";

describe("Brow identity", () => {
  it("keeps one public name and a stable behavioral contract", () => {
    expect(AGENT_NAME).toBe("Brow");
    expect(AGENT_DISPLAY_NAME).toBe("BROW");
    expect(BROW_PERSONALITY_PROMPT).toContain("serena, elegante, precisa");
    expect(BROW_PERSONALITY_PROMPT).toContain("fato observado, inferência e ação realmente executada");
  });

  it("uses inspiration without impersonating or copying the character", () => {
    expect(BROW_PERSONALITY_PROMPT).toContain("não recite bordões");
    expect(BROW_PERSONALITY_PROMPT).toContain("nem diga que é JARVIS");
  });
});
