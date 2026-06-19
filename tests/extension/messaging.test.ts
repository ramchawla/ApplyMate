import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Content Script Messaging", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("should send JOB_EXTRACTED message to background", async () => {
    const messages: any[] = [];
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: (msg: any) => messages.push(msg),
      },
    };

    const { extractAndSend } = await import(
      "../../packages/extension/src/content/content"
    );

    await extractAndSend(
      "<h1>Senior Engineer</h1><p>Company: Acme</p>" +
        '<form><input type="text" name="name" placeholder="Full Name" /></form>',
    );

    const jobMsg = messages.find((m) => m.type === "JOB_EXTRACTED");
    expect(jobMsg).toBeDefined();
    expect(jobMsg.data).toHaveProperty("jobDescription");
    expect(jobMsg.data).toHaveProperty("formFields");
    expect(jobMsg.data.formFields.length).toBeGreaterThan(0);
    expect(jobMsg.data).toHaveProperty("board");
  });

  it("should inject an extension button into the page", async () => {
    const messages: any[] = [];
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: (msg: any) => messages.push(msg),
      },
    };

    const { extractAndSend } = await import(
      "../../packages/extension/src/content/content"
    );

    await extractAndSend("<h1>Role</h1>");

    const button = document.getElementById("applymate-button");
    expect(button).not.toBeNull();
  });
});
