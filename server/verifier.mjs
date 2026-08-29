const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIN_IMAGE_BYTES = 1024;

function validateImageDataUrl(imageDataUrl) {
  if (typeof imageDataUrl !== "string") throw Object.assign(new Error("A proof photo is required"), { statusCode: 400 });
  const match = imageDataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error("Proof must be a JPEG, PNG, or WebP image"), { statusCode: 400 });
  const estimatedBytes = Math.floor(match[2].length * 0.75);
  if (estimatedBytes < MIN_IMAGE_BYTES) {
    throw Object.assign(new Error("Proof photo is empty or too small to verify"), { statusCode: 400 });
  }
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
    demoMode = (process.env.JOULING_DEMO_VERIFIER ?? process.env.GHOSTGRID_DEMO_VERIFIER) !== "false",
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
        failureCode: "none",
        reason: "Demo verification accepted a valid proof image. Configure OPENAI_API_KEY for live visual verification.",
        observedState: `Photo received for: ${mission.expectedVisualEvidence}`,
        userGuidance: "Mission proof accepted in demo mode.",
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
        failure_code: {
          type: "string",
          enum: ["none", "room_still_active", "camera_obscured", "image_unclear", "wrong_device_or_location", "required_state_missing", "unsafe_action"]
        },
        reason: { type: "string" },
        observed_state: { type: "string" },
        user_guidance: { type: "string" },
        safety_concern: { type: "boolean" }
      },
      required: ["completed", "confidence", "failure_code", "reason", "observed_state", "user_guidance", "safety_concern"],
      additionalProperties: false
    };

    const prompt = [
      "You are a strict visual verifier for an institution-approved energy-saving mission.",
      `Mission: ${mission.title}`,
      `Required action: ${mission.instruction}`,
      `Expected visible evidence: ${mission.expectedVisualEvidence}`,
      `Safety rule: ${mission.safety}`,
      "Judge only what is visibly supported by this single photo. Be conservative: completed=true requires a clear match to the labelled location/device and every required final state.",
      "Use failure_code=room_still_active when relevant lights, screens, cooling, or equipment visibly remain on.",
      "Use failure_code=camera_obscured for a blocked, nearly black, finger-covered, or unusable camera view.",
      "Use failure_code=image_unclear for blur, severe darkness, glare, cropping, or an unreadable device state.",
      "Use failure_code=wrong_device_or_location when the image does not show the mission's approved equipment or area.",
      "Use failure_code=required_state_missing when the correct scene is present but one or more required conditions are not visible, such as a closed door.",
      "Use failure_code=unsafe_action and safety_concern=true if the photo suggests tampering with panels, exposed wiring, climbing, obstruction of emergency systems, or another unsafe act.",
      "Use failure_code=none only when completed=true. Give a short factual reason and one actionable, user-friendly next step.",
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
            { type: "input_image", image_url: imageDataUrl, detail: "high" }
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
        max_output_tokens: 320
      })
    });

    if (!response.ok) {
      await response.text();
      const userMessage = response.status === 401
        ? "The server's OpenAI API key was rejected. Replace it and restart Jouling."
        : response.status === 429
          ? "Photo verification is busy right now. Please try again in a moment."
          : response.status === 400
            ? "The verification service could not read this photo. Retake it as a clear JPEG, PNG, or WebP image."
            : "Photo verification is temporarily unavailable. Please try again.";
      const error = new Error(userMessage);
      error.statusCode = 502;
      throw error;
    }
    const payload = await response.json();
    const parsed = JSON.parse(extractOutputText(payload));
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    const safetyConcern = Boolean(parsed.safety_concern) || parsed.failure_code === "unsafe_action";
    const lowConfidence = parsed.completed && confidence < 0.72;
    const failureCode = safetyConcern
      ? "unsafe_action"
      : lowConfidence
        ? "image_unclear"
        : (!parsed.completed && parsed.failure_code === "none" ? "required_state_missing" : parsed.failure_code);
    const completed = Boolean(parsed.completed) && failureCode === "none" && !safetyConcern;
    return {
      completed,
      confidence,
      failureCode,
      reason: parsed.reason,
      observedState: parsed.observed_state,
      userGuidance: lowConfidence
        ? "Retake the photo closer to the labelled device so its final state is unambiguous."
        : parsed.user_guidance,
      safetyConcern,
      mode: "openai",
      model: payload.model || this.model,
      imageBytes
    };
  }
}
