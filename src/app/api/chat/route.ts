import OpenAI from "openai";

export const runtime = "nodejs";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

const coachPrompt = `You are Kodara Coach, a warm, direct marketing specialist for independent restaurant owners.

The user is Marcos, a restaurant business owner. He wants practical help with marketing, offers, menu combinations, local demand, customer retention, revenue, and daily operating decisions.

Answer like a specialist coach:
- Start with the most useful next step, not a long explanation.
- Ask at most one clarifying question when needed.
- Give restaurant-specific examples.
- Keep answers concise enough for a mobile chat.
- Avoid generic motivational language.
- If recommending a campaign, include the audience, offer, channel, timing, and success metric.
- When numbers are missing, state the assumption and give a simple way to collect the missing data.`;

const THINKING_PREFIX = "\x01";

function thinkingLine(text: string) {
  return `${THINKING_PREFIX}${text}\n`;
}

function pickThinkingSteps(question: string): string[] {
  const q = question.toLowerCase();

  if (q.includes("revenue") || q.includes("cash") || q.includes("financial")) {
    return [
      "Analysing your financial question",
      "Reviewing restaurant revenue patterns",
      "Formulating a cash-flow recommendation",
    ];
  }
  if (q.includes("instagram") || q.includes("social") || q.includes("post")) {
    return [
      "Analysing your social media question",
      "Checking effective restaurant campaign patterns",
      "Drafting a content strategy for you",
    ];
  }
  if (q.includes("menu") || q.includes("meal") || q.includes("combo")) {
    return [
      "Analysing your menu question",
      "Reviewing high-margin bundle strategies",
      "Formulating a menu recommendation",
    ];
  }
  return [
    "Analysing your question",
    "Checking your restaurant context",
    "Formulating a recommendation",
  ];
}

export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages?: ClientMessage[] };
  const safeMessages = (messages ?? [])
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .slice(-12);

  const lastQuestion = safeMessages.at(-1)?.content ?? "";
  const thinkingSteps = pickThinkingSteps(lastQuestion);
  const encoder = new TextEncoder();

  if (!process.env.OPENAI_API_KEY) {
    return streamWithThinking(
      thinkingSteps,
      streamText(mockCoachReply(lastQuestion)),
    );
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });

  // Start the OpenAI request immediately (runs in parallel with thinking steps)
  const openAiStreamPromise = client.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    stream: true,
    messages: [
      { role: "system", content: coachPrompt },
      ...safeMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
    temperature: 0.7,
  });

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          // Emit thinking steps while OpenAI processes
          for (const step of thinkingSteps) {
            controller.enqueue(encoder.encode(thinkingLine(step)));
            await new Promise((resolve) => setTimeout(resolve, 420));
          }

          // Stream the actual response
          const stream = await openAiStreamPromise;
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content;
            if (text) controller.enqueue(encoder.encode(text));
          }
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

function streamWithThinking(thinkingSteps: string[], contentResponse: Response) {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          // Emit thinking steps
          for (const step of thinkingSteps) {
            controller.enqueue(encoder.encode(thinkingLine(step)));
            await new Promise((resolve) => setTimeout(resolve, 420));
          }

          // Pipe mock content
          const reader = contentResponse.body?.getReader();
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          }
        } finally {
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

function streamText(text: string) {
  const encoder = new TextEncoder();
  const words = text.split(/(\s+)/);

  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const word of words) {
          controller.enqueue(encoder.encode(word));
          await new Promise((resolve) => setTimeout(resolve, 22));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

function mockCoachReply(question: string) {
  const normalized = question.toLowerCase();

  if (normalized.includes("meal") || normalized.includes("combination")) {
    return "Try three bundles this week: 1. Family dinner: two mains, one side, one dessert, priced 8-12% below buying separately. 2. Lunch lift: best-selling main plus a fast side and drink, available 11:30-2:00. 3. Date-night pair: two signature plates plus a shared appetizer. Promote the bundle with one photo, one deadline, and track average order value.";
  }

  if (normalized.includes("instagram") || normalized.includes("promo")) {
    return "Post one concrete offer: 'Tonight only: order any signature bowl and add our house dessert for $4.' Use a close-up food photo, put the offer in the first line, and add a 6-hour deadline. Measure saves, DMs, and how many customers mention the post at checkout.";
  }

  if (normalized.includes("slow") || normalized.includes("lunch")) {
    return "Pick one quiet 90-minute window and create a reason to visit now. For lunch, I’d test a 'ready in 12 minutes' combo for nearby workers: one main, one drink, one small side. Promote it on Google Business Profile and Instagram Stories before 10:45am for three days.";
  }

  return "Here’s the fastest useful move: choose one business goal for today: more covers, higher average order value, or repeat visits. If it is revenue today, run one narrow offer for one audience. Example: a 5-7pm early dinner combo for nearby families, promoted on Instagram Stories and Google Business Profile, with success measured by orders and average ticket.";
}
