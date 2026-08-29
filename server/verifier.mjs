const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function validateImageDataUrl(imageDataUrl) {
  if (typeof imageDataUrl !== "string") throw Object.assign(new Error("A proof photo is required"), { statusCode: 400 });
  const match = imageDataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error("Proof must be a JPEG, PNG, or WebP image"), { statusCode: 400 });
  const estimatedBytes = Math.floor(match[2].length * 0.75);
  if (estimatedBytes > MAX_IMAGE_BYTES) throw Object.assign(new Error("Proof photo is larger than 5 MB"), { statusCode: 413 });
  return estimatedBytes;
}

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text) return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI response did not contain a verification result");
}

export class PhotoVerifier {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_VISION_MODEL || "gpt-5.4-mini",
    demoMode = process.env.GHOSTGRID_DEMO_VERIFIER !== "false",
    fetchImpl = fetch
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.demoMode = demoMode;
    this.fetchImpl = fetchImpl;
  }

  async verify({ mission, imageDataUrl, userId }) {
    const imageBytes = validateImageDataUrl(imageDataUrl);
    if (!this.apiKey) {
      if (!this.demoMode) throw Object.assign(new Error("OPENAI_API_KEY is not configured"), { statusCode: 503 });
      return {
        completed: true,
        confidence: 0.91,
        reason: "Demo verification accepted a valid proof image. Configure OPENAI_API_KEY for live visual verification.",
        observedState: `Photo received for: ${mission.expectedVisualEvidence}`,
        safetyConcern: false,
        mode: "demo",
        model: null,
        imageBytes
      };
    }

    const schema = {
      type: "object",
      properties: {
        completed: { type: "boolean" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string" },
        observed_state: { type: "string" },
        safety_concern: { type: "boolean" }
      },
      required: ["completed", "confidence", "reason", "observed_state", "safety_concern"],
      additionalProperties: false
    };

    const prompt = [
      "You are a strict visual verifier for an institution-approved energy-saving mission.",
      `Mission: ${mission.title}`,
      `Required action: ${mission.instruction}`,
      `Expected visible evidence: ${mission.expectedVisualEvidence}`,
      `Safety rule: ${mission.safety}`,
      "Decide whether the visible evidence is sufficient to confirm the action. Reject ambiguous, unrelated, dark, or obstructed photos.",
      "Do not identify people or infer personal or sensitive attributes. Evaluate only the equipment and room state."
    ].join("\n");

    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        safety_identifier: String(userId || "anonymous").slice(0, 64),
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl, detail: "low" }
          ]
        }],
        text: {
          format: {
            type: "json_schema",
            name: "mission_verification",
            strict: true,
            schema
          }
        },
        max_output_tokens: 220
      })
    });

    if (!response.ok) {
      const message = await response.text();
      const error = new Error(`OpenAI verification failed (${response.status}): ${message.slice(0, 240)}`);
      error.statusCode = 502;
      throw error;
    }
    const payload = await response.json();
    const parsed = JSON.parse(extractOutputText(payload));
    return {
      completed: parsed.completed,
      confidence: parsed.confidence,
      reason: parsed.reason,
      observedState: parsed.observed_state,
      safetyConcern: parsed.safety_concern,
      mode: "openai",
      model: payload.model || this.model,
      imageBytes
    };
  }
}
