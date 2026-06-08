import OpenAI from "openai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const formData = await request.formData();
  const audio = formData.get("audio");

  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "No audio file was provided." }, { status: 400 });
  }

  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL,
  });

  try {
    const transcription = await client.audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1",
    });

    return Response.json({ text: transcription.text.trim() });
  } catch (error) {
    const message =
      error instanceof OpenAI.APIError
        ? `Transcription failed (${error.status}). Check your OpenAI API key.`
        : "Transcription failed. Please try again.";

    return Response.json({ error: message }, { status: 502 });
  }
}
