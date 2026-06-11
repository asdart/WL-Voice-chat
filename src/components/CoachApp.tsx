"use client";

import {
  ArrowLeft,
  ArrowUp,
  Check,
  DotsThree,
  List,
  Microphone,
  NotePencil,
  Plus,
  Sparkle,
  Waveform,
  X,
} from "@phosphor-icons/react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronRight } from "@tabler/icons-react";
import { TextShimmer } from "./agent-elements/text-shimmer";
import VoiceOrbCluster from "./VoiceOrbCluster";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type VoiceStatus =
  | "idle"
  | "listening"
  | "transcribing"
  | "processing"
  | "speaking"
  | "unsupported"
  | "error";

type Task = {
  title: string;
  action: string;
  status: "done" | "ready";
  icon: "edit" | "sparkle";
  prompt?: string;
};

const tasks: Task[] = [
  {
    title: "Daily check-in - What is your today's revenue?",
    action: "Edit",
    status: "done",
    icon: "edit",
  },
  {
    title: "Build your financial spot",
    action: "Generate now",
    status: "ready",
    icon: "sparkle",
    prompt:
      "Help me understand my restaurant's financial spot today. What should I check first?",
  },
  {
    title: "Create 3 recommended meal combinations",
    action: "Show me",
    status: "ready",
    icon: "sparkle",
    prompt:
      "Create 3 recommended meal combinations I can promote this week to increase average order value.",
  },
];

const suggestions = [
  "How do I fill slow lunch hours?",
  "Write an Instagram promo for tonight",
  "What should I do with leftover inventory?",
];

const initialMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Hi Marcos, I’m your restaurant marketing coach. Tell me what you want to improve today: more bookings, bigger checks, repeat customers, or a specific campaign.",
  },
];

const financialSpotMessages: Message[] = [
  {
    id: "financial-spot-start",
    role: "assistant",
    content:
      "Before we start improving your restaurant's marketing, I'd like to understand the financial health of your business.\n\nThis helps me prioritize recommendations that generate the biggest impact without putting unnecessary pressure on cash flow.\n\nLet's start with a few numbers.\n\nHow much cash do you currently have available in your business bank accounts?",
  },
];

const fallbackCoachReply =
  "I’m having trouble connecting, but here is a quick move: pick one quiet hour today and run one clear offer for one audience. For example, a 5-7pm family combo with a deadline and a simple add-on.";

export function CoachApp() {
  const [view, setView] = useState<"home" | "chat">("home");
  const [viewPhase, setViewPhase] = useState<"idle" | "exit" | "enter">("idle");
  const [chatTitle, setChatTitle] = useState("Marketing coach");
  const [chatMode, setChatMode] = useState<"general" | "financial">("general");
  const [voiceMode, setVoiceMode] = useState<"user" | "ai" | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceAnswer, setVoiceAnswer] = useState("");
  const [voiceNotice, setVoiceNotice] = useState("");
  const [aiLevel, setAiLevel] = useState(0);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [completedTasks, setCompletedTasks] = useState<string[]>([]);
  const [activeTaskTitle, setActiveTaskTitle] = useState<string | null>(null);
  const requestId = useRef(0);
  const isVoiceOpen = voiceMode !== null;
  const thinkingAudioRef = useRef<HTMLAudioElement | null>(null);
  const thinkingFadeRef = useRef(0);

  // Animated navigation: play exit on current screen, swap, then play enter.
  const navigateTo = useCallback(
    (next: "home" | "chat", afterSwap?: () => void) => {
      if (next === view) { afterSwap?.(); return; }
      setViewPhase("exit");
      window.setTimeout(() => {
        setView(next);
        afterSwap?.();
        setViewPhase("enter");
        window.setTimeout(() => setViewPhase("idle"), 400);
      }, 220);
    },
    [view],
  );

  useEffect(() => {
    if (!isVoiceOpen) return;

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setVoiceElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isVoiceOpen]);

  // Ambient "thinking" loop — plays softly while the coach is reasoning (both
  // text and voice modes) and fades out the moment the answer starts.
  const lastMsg = messages[messages.length - 1];
  const isThinkingAudio =
    (isLoading && lastMsg?.role === "assistant" && !lastMsg.content) ||
    voiceStatus === "processing";

  useEffect(() => {
    if (!thinkingAudioRef.current) {
      const audio = new Audio("/thinking-loop.mp3");
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 0;
      thinkingAudioRef.current = audio;
    }
    const audio = thinkingAudioRef.current;
    const TARGET_VOLUME = 0.12; // keep it well under the coach's voice
    const STEP_MS = 40;
    const FADE_IN_MS = 1200; // gentle ramp up at the start
    const FADE_OUT_MS = 1400; // gentle ramp down at the end
    const fadeInStep = TARGET_VOLUME / (FADE_IN_MS / STEP_MS);
    const fadeOutStep = TARGET_VOLUME / (FADE_OUT_MS / STEP_MS);

    window.clearInterval(thinkingFadeRef.current);

    if (isThinkingAudio) {
      audio.currentTime = 0;
      void audio.play().catch(() => {
        /* autoplay may be blocked until a user gesture; safe to ignore */
      });
      thinkingFadeRef.current = window.setInterval(() => {
        audio.volume = Math.min(TARGET_VOLUME, audio.volume + fadeInStep);
        if (audio.volume >= TARGET_VOLUME) window.clearInterval(thinkingFadeRef.current);
      }, STEP_MS);
    } else {
      thinkingFadeRef.current = window.setInterval(() => {
        audio.volume = Math.max(0, audio.volume - fadeOutStep);
        if (audio.volume <= 0) {
          audio.pause();
          window.clearInterval(thinkingFadeRef.current);
        }
      }, STEP_MS);
    }

    return () => window.clearInterval(thinkingFadeRef.current);
  }, [isThinkingAudio]);

  useEffect(() => {
    return () => {
      window.clearInterval(thinkingFadeRef.current);
      thinkingAudioRef.current?.pause();
    };
  }, []);

  const streamAssistantResponse = useCallback(
    async (
      nextMessages: Message[],
      assistantId: string,
      currentRequest: number,
    ) => {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: nextMessages }),
        });

        if (!response.ok || !response.body) {
          throw new Error("The coach could not answer right now.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = "";
        let thinkingDone = false;
        let content = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || currentRequest !== requestId.current) break;

          const raw = decoder.decode(value, { stream: true });

          if (thinkingDone) {
            content += raw;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, content } : message,
              ),
            );
            continue;
          }

          // Still in the thinking-detection phase — buffer and parse lines
          lineBuffer += raw;

          let newlineIdx: number;
          while ((newlineIdx = lineBuffer.indexOf("\n")) !== -1) {
            const line = lineBuffer.slice(0, newlineIdx);
            lineBuffer = lineBuffer.slice(newlineIdx + 1);

            if (line.startsWith("\x01")) {
              // Thinking event — update steps
              const step = line.slice(1).trim();
              if (step) setThinkingSteps((prev) => [...prev, step]);
            } else {
              // First non-thinking line → pause so thinking UI settles, then show content
              thinkingDone = true;
              await new Promise((r) => setTimeout(r, 500));
              content += line + (lineBuffer.length > 0 ? lineBuffer : "");
              lineBuffer = "";
              if (content) {
                setMessages((current) =>
                  current.map((message) =>
                    message.id === assistantId
                      ? { ...message, content }
                      : message,
                  ),
                );
              }
              break;
            }
          }

          // If buffer has content that doesn't start with the thinking prefix, flush it
          if (
            !thinkingDone &&
            lineBuffer.length > 0 &&
            !lineBuffer.startsWith("\x01")
          ) {
            thinkingDone = true;
            await new Promise((r) => setTimeout(r, 500));
            content += lineBuffer;
            lineBuffer = "";
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, content } : message,
              ),
            );
          }
        }

        // Flush any remaining buffer as content
        if (lineBuffer.trim() && !lineBuffer.startsWith("\x01")) {
          content += lineBuffer;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId ? { ...message, content } : message,
            ),
          );
        }

        return content;
      } catch {
        setError("I lost the connection to the coach. Try asking again.");
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: fallbackCoachReply }
              : message,
          ),
        );
        return fallbackCoachReply;
      }
    },
    [],
  );

  async function sendMessage(nextInput = input) {
    const trimmed = nextInput.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    const assistantId = `assistant-${Date.now()}`;
    const nextMessages = [...messages, userMessage];

    if (view !== "chat") {
      setChatTitle("Marketing coach");
      setChatMode("general");
      navigateTo("chat");
    }
    setVoiceMode(null);
    setInput("");
    setError("");
    setIsLoading(true);
    setThinkingSteps([]);
    setMessages([...nextMessages, { id: assistantId, role: "assistant", content: "" }]);

    const currentRequest = ++requestId.current;

    await streamAssistantResponse(nextMessages, assistantId, currentRequest);
    setIsLoading(false);
  }

  const speakText = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      return Promise.resolve();
    }
    // Nothing to say — resolve immediately so the voice flow continues.
    if (!text.trim()) return Promise.resolve();

    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;

      let decayTimer = 0;
      let fallbackTimer = 0;
      let pollTimer = 0;
      let resolved = false;
      let hasSpoken = false;
      const pollStart = Date.now();

      const finish = () => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(decayTimer);
        window.clearTimeout(fallbackTimer);
        window.clearInterval(pollTimer);
        setAiLevel(0);
        resolve();
      };

      utterance.onstart = () => {
        hasSpoken = true;
        setAiLevel(prefersReducedMotion ? 0.6 : 0.45);
      };
      utterance.onboundary = () => {
        if (prefersReducedMotion) return;
        setAiLevel(1);
        window.clearTimeout(decayTimer);
        decayTimer = window.setTimeout(() => setAiLevel(0.4), 110);
      };
      utterance.onend = finish;
      // "canceled" / "interrupted" fire on Chrome when cancel() is called right
      // before speak() — those are false positives; ignore them so the delayed
      // speak() below still runs. Only resolve on real errors.
      utterance.onerror = (e) => {
        const code = (e as SpeechSynthesisErrorEvent).error;
        if (code === "canceled" || code === "interrupted") return;
        finish();
      };

      // cancel() + speak() in the same tick causes a silent failure on macOS
      // Chrome. The small delay lets the engine flush the cancel first.
      window.speechSynthesis.cancel();
      window.setTimeout(() => {
        if (!resolved) window.speechSynthesis.speak(utterance);
      }, 80);

      // Primary safety net: macOS Chrome/Safari frequently never fire `onend`.
      // Poll the engine's own `speaking` flag and finish once it has actually
      // started and then stopped.
      pollTimer = window.setInterval(() => {
        if (window.speechSynthesis.speaking) {
          hasSpoken = true;
          return;
        }
        if (hasSpoken) {
          finish(); // completed normally
          return;
        }
        // Speech never started — bail after 3 s so the voice flow isn't stuck.
        if (Date.now() - pollStart > 3000) finish();
      }, 250);

      // Absolute last resort: estimate speaking time + generous buffer.
      const wordCount = text.trim().split(/\s+/).length;
      const estimatedMs = wordCount * 430 + 6000;
      fallbackTimer = window.setTimeout(finish, estimatedMs);
    });
  }, []);

  const handleVoiceTranscriptComplete = useCallback(
    async (transcript: string) => {
      const trimmed = transcript.trim();
      if (!trimmed || isLoading) return;

      const userMessage: Message = {
        id: `voice-user-${Date.now()}`,
        role: "user",
        content: trimmed,
      };
      const assistantId = `voice-assistant-${Date.now()}`;
      const nextMessages = [...messages, userMessage];
      const currentRequest = ++requestId.current;

      setVoiceTranscript(trimmed);
      setVoiceAnswer("");
      setVoiceNotice("");
      setVoiceMode("ai");
      setVoiceStatus("processing");
      setError("");
      setIsLoading(true);
      setThinkingSteps([]);
      setMessages([
        ...nextMessages,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      const responseText = await streamAssistantResponse(
        nextMessages,
        assistantId,
        currentRequest,
      );
      setIsLoading(false);

      if (requestId.current !== currentRequest || !voiceMode) return;

      // Reveal the answer in the chat while the coach speaks it aloud.
      setVoiceAnswer(responseText);
      setVoiceStatus("speaking");
      await speakText(responseText);

      if (requestId.current !== currentRequest) return;

      setVoiceTranscript("");
      setVoiceAnswer("");
      setVoiceMode("user");
      setVoiceStatus("listening");
    },
    [isLoading, messages, speakText, streamAssistantResponse, voiceMode],
  );

  const handleVoiceAudioComplete = useCallback(
    async (audio: Blob) => {
      if (isLoading || audio.size === 0) return;

      setVoiceStatus("transcribing");
      setVoiceNotice("");

      try {
        const formData = new FormData();
        const extension = audio.type.includes("mp4") ? "mp4" : "webm";
        formData.append("audio", audio, `voice-answer.${extension}`);

        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const { error } = (await response
            .json()
            .catch(() => ({ error: "" }))) as { error?: string };
          setVoiceStatus("error");
          setVoiceNotice(
            error?.includes("OPENAI_API_KEY")
              ? "Add your OpenAI API key to .env.local and restart the dev server."
              : error || "I could not transcribe that. Try speaking again.",
          );
          return;
        }

        const { text } = (await response.json()) as { text?: string };
        const transcript = text?.trim();

        if (!transcript) {
          setVoiceStatus("listening");
          setVoiceNotice("I did not catch any words. Try speaking again.");
          return;
        }

        await handleVoiceTranscriptComplete(transcript);
      } catch {
        setVoiceStatus("listening");
        setVoiceNotice("I could not transcribe that. Try speaking again.");
      }
    },
    [handleVoiceTranscriptComplete, isLoading],
  );

  // Barge-in: the user started talking while the coach was speaking. Stop the
  // TTS immediately and switch to listening so their input is captured and
  // appended to the conversation.
  const handleBargeIn = useCallback(() => {
    window.speechSynthesis?.cancel();
    setAiLevel(0);
    setVoiceTranscript("");
    setVoiceAnswer("");
    setVoiceNotice("");
    setVoiceMode("user");
    setVoiceStatus("listening");
  }, []);

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  function startFinancialSpot() {
    requestId.current += 1;
    const currentRequest = requestId.current;
    const introId = "financial-spot-start";

    setChatTitle("Built your financial spot");
    setChatMode("financial");
    setActiveTaskTitle("Build your financial spot");
    setMessages([{ id: introId, role: "assistant", content: "" }]);
    setInput("");
    setError("");
    setIsLoading(false);
    navigateTo("chat");

    // Stream the intro text word-by-word like a real chat response
    const fullText = financialSpotMessages[0].content;
    const tokens = fullText.split(/(\s+)/); // words + spaces preserved
    let index = 0;

    function typeNext() {
      if (requestId.current !== currentRequest) return;
      index++;
      const partial = tokens.slice(0, index).join("");
      setMessages([{ id: introId, role: "assistant", content: partial }]);
      if (index < tokens.length) {
        setTimeout(typeNext, 22);
      }
    }

    // Small pause before typing starts so the screen transition settles
    setTimeout(typeNext, 260);
  }

  function completeActiveTask() {
    if (activeTaskTitle) {
      setCompletedTasks((prev) =>
        prev.includes(activeTaskTitle) ? prev : [...prev, activeTaskTitle],
      );
    }
    setActiveTaskTitle(null);
    requestId.current += 1;
    window.speechSynthesis?.cancel();
    setAiLevel(0);
    setVoiceMode(null);
    setVoiceStatus("idle");
    setIsLoading(false);
    navigateTo("home");
  }

  function openVoiceMode() {
    if (view !== "chat") {
      setChatTitle("Marketing coach");
      setChatMode("general");
      navigateTo("chat");
    }
    window.speechSynthesis?.cancel();
    setVoiceTranscript("");
    setVoiceNotice("");
    setVoiceElapsed(0);
    setVoiceStatus("listening");
    setVoiceMode("user");
  }

  // Opens voice mode from the "Create 3 recommended meal combinations"
  // dashboard task.
  function openOrbPreview(taskTitle: string) {
    setActiveTaskTitle(taskTitle);
    setChatTitle("Meal combinations");
    setChatMode("general");
    navigateTo("chat");
    window.speechSynthesis?.cancel();
    setVoiceTranscript("");
    setVoiceNotice("");
    setVoiceElapsed(0);
    setVoiceStatus("listening");
    setVoiceMode("user");
  }

  function closeVoiceMode() {
    requestId.current += 1;
    window.speechSynthesis?.cancel();
    setAiLevel(0);
    setVoiceMode(null);
    setVoiceStatus("idle");
    setVoiceTranscript("");
    setVoiceNotice("");
    setIsLoading(false);
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_25%_0%,rgba(255,255,255,0.95),transparent_32%),linear-gradient(135deg,#eef4ec_0%,#dde9e3_48%,#f8f6ef_100%)] p-0 text-[#202520] sm:p-6">
      <section
        className={`phone-shadow chat-shell relative flex h-[844px] w-full max-w-[390px] flex-col overflow-hidden rounded-none border border-[var(--hairline)] sm:rounded-[48px] ${
          isVoiceOpen
            ? voiceMode === "user"
              ? "chat-shell-user"
              : "chat-shell-coach"
            : ""
        } ${isVoiceOpen && isLoading ? "is-streaming" : ""}`}
      >
        {voiceMode ? (
          <VoiceModeScreen
            aiLevel={aiLevel}
            elapsedSeconds={voiceElapsed}
            notice={voiceNotice}
            phase={voiceMode}
            status={voiceStatus}
            thinkingSteps={thinkingSteps}
            title={chatTitle}
            transcript={voiceTranscript}
            aiAnswer={voiceAnswer}
            onBack={() => { closeVoiceMode(); navigateTo("home"); }}
            onClose={closeVoiceMode}
            onNoticeChange={setVoiceNotice}
            onStatusChange={setVoiceStatus}
          onAudioComplete={handleVoiceAudioComplete}
          onTranscriptComplete={handleVoiceTranscriptComplete}
          onInterrupt={handleBargeIn}
          onTogglePhase={() =>
              setVoiceMode((current) => (current === "user" ? "ai" : "user"))
            }
          />
        ) : view === "home" ? (
          <div className={`view-screen z-0 ${viewPhase === "exit" ? "view-exit-to-chat" : viewPhase === "enter" ? "view-enter-from-chat" : ""}`}>
            <HomeScreen
              input={input}
              onInputChange={setInput}
              onInputKeyDown={handleComposerKeyDown}
              onVoiceMode={openVoiceMode}
              onOpenChat={() => {
                setChatTitle("Marketing coach");
                setChatMode("general");
                navigateTo("chat");
              }}
              onSend={() => void sendMessage()}
              onSendText={(text) => void sendMessage(text)}
              onFinancialSpot={startFinancialSpot}
              onTaskPrompt={(prompt, taskTitle) => {
                setActiveTaskTitle(taskTitle);
                void sendMessage(prompt);
              }}
              onShowOrb={openOrbPreview}
              completedTasks={completedTasks}
            />
          </div>
        ) : (
          <div className={`view-screen z-0 ${viewPhase === "exit" ? "view-exit-to-home" : viewPhase === "enter" ? "view-enter-from-home" : ""}`}>
          <ChatScreen
            chatMode={chatMode}
            title={chatTitle}
            error={error}
            input={input}
            isLoading={isLoading}
            messages={messages}
            thinkingSteps={thinkingSteps}
            onBack={() => navigateTo("home")}
            onInputChange={setInput}
            onInputKeyDown={handleComposerKeyDown}
            onSend={() => void sendMessage()}
            onSendText={(text) => void sendMessage(text)}
            onSuggestion={(suggestion) => void sendMessage(suggestion)}
            onVoiceMode={openVoiceMode}
            onCompleteTask={completeActiveTask}
          />
          </div>
        )}

      </section>
    </main>
  );
}

function HomeScreen({
  input,
  onInputChange,
  onInputKeyDown,
  onFinancialSpot,
  onVoiceMode,
  onOpenChat,
  onSend,
  onSendText,
  onTaskPrompt,
  onShowOrb,
  completedTasks,
}: {
  input: string;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFinancialSpot: () => void;
  onVoiceMode: () => void;
  onOpenChat: () => void;
  onSend: () => void;
  onSendText: (text: string) => void;
  onTaskPrompt: (prompt: string, taskTitle: string) => void;
  onShowOrb: (taskTitle: string) => void;
  completedTasks: string[];
}) {
  const [greetingShown, setGreetingShown] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setGreetingShown(true), 80);
    return () => clearTimeout(id);
  }, []);

  return (
    <>
      <TopBar label="New task" onMenu={onOpenChat} />

      <section className="px-6 pt-[151px]">
        <div className={`t-stagger${greetingShown ? " is-shown" : ""}`}>
          <strong className="t-stagger-line t-stagger-line--1 text-[20px] font-normal leading-7 tracking-[-0.5px] text-[#2f3430]">
            Good morning Marcos,
          </strong>
          <span className="t-stagger-line t-stagger-line--2 text-[20px] leading-7 tracking-[-0.5px] text-[#6f756f]">
            You have 3 tasks to be done today.
          </span>
        </div>
      </section>

      <section className="mt-[78px] px-6">
        <div className="dash-section-enter mb-3 flex items-center justify-between">
          <h1 className="text-base font-medium text-[#101511]">Today</h1>
          <button className="text-base font-medium text-[var(--brand)] transition active:scale-[0.98]">
            See all
          </button>
        </div>

        <div className="space-y-2">
          {tasks.map((task, index) => {
            const isDone =
              task.status === "done" || completedTasks.includes(task.title);

            return (
              <button
                key={task.title}
                className="task-enter task-card block w-full rounded-[24px] p-5 text-left transition duration-300 active:scale-[0.99]"
                onClick={() => {
                  if (isDone) return;
                  if (task.action === "Generate now") {
                    onFinancialSpot();
                    return;
                  }
                  if (task.action === "Show me") {
                    onShowOrb(task.title);
                    return;
                  }
                  if (task.prompt) onTaskPrompt(task.prompt, task.title);
                }}
                style={{ "--index": index } as CSSProperties}
                type="button"
              >
                <p
                  className={`text-base font-medium leading-6 ${
                    isDone
                      ? "text-[#9aa09b] line-through"
                      : "text-[rgba(31,36,31,0.62)]"
                  }`}
                >
                  {task.title}
                </p>
                <div
                  className={`mt-3 flex items-center gap-1 text-base font-medium ${
                    isDone ? "text-[#9aa09b]" : "text-[var(--brand)]"
                  }`}
                >
                  {isDone ? (
                    <>
                      <Check size={20} weight="bold" />
                      <span>Completed</span>
                    </>
                  ) : (
                    <>
                      {task.icon === "edit" ? (
                        <NotePencil size={20} weight="regular" />
                      ) : (
                        <Sparkle className="sparkle-breathe" size={20} weight="regular" />
                      )}
                      <span>{task.action}</span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <Composer
        input={input}
        onInputChange={onInputChange}
        onInputKeyDown={onInputKeyDown}
        onSend={onSend}
        onSendText={onSendText}
        onVoiceMode={onVoiceMode}
        placeholder="Ask me anything..."
      />
    </>
  );
}

function ChatScreen({
  chatMode,
  error,
  input,
  isLoading,
  messages,
  thinkingSteps,
  onBack,
  onInputChange,
  onInputKeyDown,
  onSend,
  onSendText,
  onSuggestion,
  onVoiceMode,
  onCompleteTask,
  title,
}: {
  chatMode: "general" | "financial";
  error: string;
  input: string;
  isLoading: boolean;
  messages: Message[];
  thinkingSteps: string[];
  onBack: () => void;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onSendText: (text: string) => void;
  onSuggestion: (suggestion: string) => void;
  onVoiceMode: () => void;
  onCompleteTask: () => void;
  title: string;
}) {
  const lastMessage = messages[messages.length - 1];
  const isThinking =
    isLoading && lastMessage?.role === "assistant" && !lastMessage.content;
  const scrollRef = useRef<HTMLElement>(null);
  const autoFollow = useRef(true);
  const prevUserMsgCount = useRef(0);
  const lastUserMsgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const userMsgCount = messages.filter((m) => m.role === "user").length;
    if (userMsgCount > prevUserMsgCount.current) {
      prevUserMsgCount.current = userMsgCount;
      autoFollow.current = true;
      // Scroll the user's bubble to just below the header so the AI reply
      // streams into the natural reading zone below it (ChatGPT-style).
      lastUserMsgRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (!autoFollow.current) return;
    // Only chase the bottom when the AI response actually extends past
    // the visible fold — short replies stay anchored below the user bubble.
    const belowFold = el.scrollHeight - el.scrollTop - el.clientHeight > 40;
    if (belowFold) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isThinking]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    autoFollow.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <>
      {/* Static green glow background, matching the voice-mode backdrop at 20% */}
      <img
        alt=""
        aria-hidden="true"
        src="/voice-bg.svg"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover opacity-20"
      />
      {/* Header + status bar unified frosted panel */}
      <div className="absolute inset-x-0 top-0 z-10 bg-white">
        {/* Nav row */}
        <div className="flex items-center justify-between px-6 pb-5 pt-[68px]">
          <button
            aria-label="Back to dashboard"
            className="flex size-7 items-center justify-center rounded-full bg-[rgba(26,26,26,0.09)] text-[#333a34] transition active:scale-95"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={16} weight="bold" />
          </button>
          <p className="text-base font-medium tracking-[-0.15px] text-[rgba(26,26,26,0.6)]">
            {title}
          </p>
          <button
            aria-label="Complete task"
            className="flex size-7 items-center justify-center rounded-full bg-[#106844] text-white transition active:scale-95"
            onClick={onCompleteTask}
            type="button"
          >
            <Check size={14} weight="bold" />
          </button>
        </div>
      </div>

      {/* Content fade — sits below header, overlays the scroll area */}
      <div className="pointer-events-none absolute inset-x-0 top-[116px] z-[9] h-[60px] bg-gradient-to-b from-white to-transparent" />

      {/* Content fade — sits above composer, masks scrolling messages */}
      <div aria-hidden="true" className="chat-composer-fade" />

      <section
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-messages absolute inset-0 z-[1] overflow-y-auto overflow-x-hidden px-8 pb-[164px] pt-[148px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="space-y-3">
          {chatMode === "financial" && messages.length > 1 ? (
            <FinancialChatHistory
              isLoading={isLoading}
              isThinking={isThinking}
              messages={messages}
              thinkingSteps={thinkingSteps}
            />
          ) : (() => {
              const lastUserIdx = messages.reduce(
                (acc, m, i) => (m.role === "user" ? i : acc),
                -1,
              );
              const lastAssistantIdx = messages.reduce(
                (acc, m, i) => (m.role === "assistant" ? i : acc),
                -1,
              );
              return messages.map((message, idx) => {
              if (
                message.role === "assistant" &&
                !message.content &&
                isThinking
              ) {
                return null;
              }

              const isLastUserMsg = message.role === "user" && idx === lastUserIdx;
              // Only stream-animate the currently-streaming message so older
              // assistant messages don't replay their entrance when isLoading flips.
              const isStreamingMsg =
                message.role === "assistant" && isLoading && idx === lastAssistantIdx;

              return (
                <div
                  key={message.id}
                  ref={isLastUserMsg ? lastUserMsgRef : undefined}
                  className={`message-enter flex [scroll-margin-top:160px] ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`whitespace-pre-wrap ${
                      message.role === "user"
                        ? "max-w-[82%] rounded-[24px] bg-[var(--brand)] px-4 py-3 text-[15px] leading-6 text-white shadow-[0_12px_26px_-18px_rgba(16,104,68,0.75)]"
                        : chatMode === "financial"
                          ? "mt-[72px] max-w-full text-base font-medium leading-7 tracking-[-0.2px] text-[#080c09]"
                          : "glass-surface max-w-[82%] rounded-[24px] px-4 py-3 text-[15px] leading-6 text-[#303630]"
                    }`}
                  >
                    {message.content
                      ? (isStreamingMsg
                          ? <StreamingText text={message.content} />
                          : message.content)
                      : <TypingDots />}
                  </div>
                </div>
              );
            });
          })()}

          {/* Pure thinking phase (general mode only): financial mode handles this internally */}
          {isThinking && chatMode !== "financial" ? (
            <div className="thinking-rise pt-1">
              <ThinkingProcess steps={thinkingSteps} />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {chatMode === "general" && messages.length === 1 ? (
            <div className="pt-3">
              <p className="mb-2 px-1 text-xs font-medium uppercase tracking-[0.12em] text-[#879087]">
                Try asking
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="rounded-full border border-black/[0.06] bg-white/60 px-3 py-2 text-left text-sm text-[#4f5750] backdrop-blur transition active:scale-[0.98]"
                    onClick={() => onSuggestion(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <Composer
        input={input}
        isLoading={isLoading}
        onInputChange={onInputChange}
        onInputKeyDown={onInputKeyDown}
        onSend={onSend}
        onSendText={onSendText}
        onVoiceMode={onVoiceMode}
        placeholder="Ask the coach..."
      />
    </>
  );
}

function FinancialChatHistory({
  isLoading,
  isThinking,
  messages,
  thinkingSteps,
}: {
  isLoading: boolean;
  isThinking: boolean;
  messages: Message[];
  thinkingSteps: string[];
}) {
  const lastAssistantIdx = messages.reduce(
    (acc, m, i) => (m.role === "assistant" ? i : acc),
    -1,
  );

  return (
    <div className="space-y-7">
      {messages.map((message, idx) => {
        // Skip the trailing empty assistant placeholder; shown via isThinking below.
        if (message.role === "assistant" && !message.content) return null;

        if (message.role === "user") {
          return (
            <div key={message.id} className="message-enter flex justify-end">
              <div className="rounded-[32px] bg-[rgba(26,26,26,0.09)] px-5 py-3 text-right text-base font-medium leading-6 tracking-[-0.2px] text-[rgba(26,26,26,0.78)]">
                {message.content}
              </div>
            </div>
          );
        }

        const isStreamingMsg = isLoading && idx === lastAssistantIdx;

        return (
          <p
            key={message.id}
            className="message-enter whitespace-pre-wrap text-base font-medium leading-7 tracking-[-0.2px] text-[#080c09]"
          >
            {isStreamingMsg
              ? <StreamingText text={message.content} />
              : message.content}
          </p>
        );
      })}

      {/* Pure thinking phase: content not yet started */}
      {isThinking ? (
        <div className="thinking-rise pt-1">
          <ThinkingProcess steps={thinkingSteps} />
        </div>
      ) : null}

    </div>
  );
}

function ThinkingProcess({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  const currentStep = steps.at(-1) ?? "Thinking…";
  const previousSteps = steps.slice(0, -1);

  return (
    <div className="w-full text-left">
      <button
        className="flex w-full items-center gap-2 py-0.5 text-left"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {/* key forces shimmer restart on each new step */}
        <TextShimmer
          as="span"
          className="flex-1 text-base font-medium leading-6"
          duration={1.4}
          key={currentStep}
        >
          {currentStep}
        </TextShimmer>

        {steps.length > 1 ? (
          <IconChevronRight
            className={`size-3.5 text-[rgba(31,36,31,0.3)] transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
        ) : null}
      </button>

      {open && previousSteps.length > 0 ? (
        <div className="mt-2.5 space-y-1.5 border-l-2 border-[rgba(16,104,68,0.18)] pl-4">
          {previousSteps.map((step) => (
            <p
              className="text-base leading-6 text-[rgba(31,36,31,0.38)]"
              key={step}
            >
              {step}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-[#778078]">
      <span className="size-1.5 animate-pulse rounded-full bg-current" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
    </span>
  );
}

function StreamingText({ text }: { text: string }) {
  // Split into word+trailing-space units so whitespace renders naturally.
  const tokens = text.match(/\S+\s*/g) ?? (text ? [text] : []);

  // Track which token index animation should start from. prevCount drives the
  // state update via useLayoutEffect so the read never happens mid-render.
  const prevCountRef = useRef(0);
  const [animateFrom, setAnimateFrom] = useState(0);

  useLayoutEffect(() => {
    if (tokens.length !== prevCountRef.current) {
      setAnimateFrom(prevCountRef.current);
      prevCountRef.current = tokens.length;
    }
  }, [tokens.length]);

  return (
    <>
      {tokens.map((token, i) =>
        i >= animateFrom ? (
          <span
            className="stream-word"
            key={i}
            style={
              {
                "--stream-delay": `${(i - animateFrom) * 16}ms`,
              } as CSSProperties
            }
          >
            {token}
          </span>
        ) : (
          <span key={i}>{token}</span>
        ),
      )}
    </>
  );
}

type MicState = "idle" | "recording" | "transcribing";

function Composer({
  input,
  isLoading = false,
  onInputChange,
  onInputKeyDown,
  onSend,
  onSendText,
  onVoiceMode,
  placeholder,
}: {
  input: string;
  isLoading?: boolean;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onSendText?: (text: string) => void;
  onVoiceMode?: () => void;
  placeholder: string;
}) {
  const hasInput = Boolean(input.trim());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [micState, setMicState] = useState<MicState>("idle");
  const [waveHistory, setWaveHistory] = useState<number[]>(() =>
    new Array(WAVE_HISTORY_SIZE).fill(0),
  );
  const lastHistorySampleRef = useRef(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(null);

  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const inputRef = useRef(input);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef(0);
  const stopTimeoutRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);
  // Which action the pending stop should resolve to once audio is captured.
  const pendingActionRef = useRef<"field" | "send" | "cancel">("field");

  useEffect(() => {
    inputRef.current = input;
  });

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const stopMedia = useCallback(() => {
    window.clearTimeout(stopTimeoutRef.current);
    window.cancelAnimationFrame(animationRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();
    streamRef.current = null;
    audioContextRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => () => stopMedia(), [stopMedia]);

  const transcribe = useCallback(
    async (audio: Blob, mode: "field" | "send") => {
      setMicState("transcribing");

      try {
        const formData = new FormData();
        const extension = audio.type.includes("mp4") ? "mp4" : "webm";
        formData.append("audio", audio, `voice-input.${extension}`);

        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) throw new Error("Transcription failed.");

        const { text } = (await response.json()) as { text?: string };
        const trimmed = text?.trim();

        if (trimmed) {
          if (mode === "send" && onSendText) {
            onSendText(trimmed);
          } else {
            const current = inputRef.current.trim();
            onInputChange(current ? `${current} ${trimmed}` : trimmed);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }
        }
      } catch {
        /* Surface nothing destructive — leave the field as-is for the user. */
      } finally {
        setMicState("idle");
      }
    },
    [onInputChange, onSendText],
  );

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];
      pendingActionRef.current = "field";
      lastHistorySampleRef.current = 0;
      setWaveHistory(new Array(WAVE_HISTORY_SIZE).fill(0));

      const mimeType = getSupportedAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      mediaRecorderRef.current = recorder;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      const samples = new Uint8Array(analyser.fftSize);
      source.connect(analyser);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stopMedia();
        setWaveHistory(new Array(WAVE_HISTORY_SIZE).fill(0));
        const action = pendingActionRef.current;

        if (action === "cancel") {
          setMicState("idle");
          return;
        }

        const audio = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });

        if (audio.size === 0) {
          setMicState("idle");
          return;
        }

        void transcribe(audio, action);
      };

      const monitorVolume = () => {
        analyser.getByteTimeDomainData(samples);
        const volume =
          samples.reduce((sum, value) => sum + Math.abs(value - 128), 0) /
          samples.length;
        const lvl = Math.min(volume / 18, 1);

        // Push a new sample to the scrolling history at ~20 fps
        const now = performance.now();
        if (now - lastHistorySampleRef.current >= 50) {
          lastHistorySampleRef.current = now;
          setWaveHistory((prev) => [...prev.slice(1), lvl]);
        }

        animationRef.current = window.requestAnimationFrame(monitorVolume);
      };

      recorder.start();
      monitorVolume();
      // Safety cap so a forgotten recording doesn't run forever.
      stopTimeoutRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, 30000);

      setMicState("recording");
    } catch {
      stopMedia();
      setMicState("idle");
    }
  }, [stopMedia, transcribe]);

  const stopToField = useCallback(() => {
    pendingActionRef.current = "field";
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const stopToSend = useCallback(() => {
    pendingActionRef.current = "send";
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const wrapperClass =
    "rounded-[24px] border border-[rgba(26,26,26,0.09)] bg-[rgba(255,255,255,0.36)] shadow-[0px_169px_47px_0px_rgba(0,0,0,0),0px_108px_43px_0px_rgba(0,0,0,0.01),0px_61px_37px_0px_rgba(0,0,0,0.02),0px_27px_27px_0px_rgba(0,0,0,0.04),0px_7px_15px_0px_rgba(0,0,0,0.04)] backdrop-blur-[20px]";

  const isActive = micState !== "idle";
  const isRecording = micState === "recording";

  return (
    <form
      className="dash-composer-enter absolute inset-x-0 bottom-0 z-10 w-full px-4 pb-10 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isActive) onSend();
      }}
    >
      <div className={`${wrapperClass} flex w-full flex-col p-2`}>

        {/* ── Textarea row: collapses vertically when mic is active ── */}
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isActive ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex w-full items-center px-3 pb-2 pt-2">
              <textarea
                ref={textareaRef}
                aria-label={placeholder}
                rows={1}
                className="max-h-[120px] min-w-0 flex-1 resize-none bg-transparent text-base font-medium leading-6 tracking-[-0.16px] text-[rgba(26,26,26,0.8)] outline-none placeholder:font-medium placeholder:tracking-[-0.16px] placeholder:text-[rgba(26,26,26,0.36)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder={placeholder}
                value={input}
              />
            </div>
          </div>
        </div>

        {/* ── Single action row (always visible) ── */}
        <div className="flex w-full items-center gap-2">

          {/* Left cluster: Plus/Stop button + waveform (expands horizontally) */}
          <div className="flex min-w-0 flex-1 items-center gap-2">

            {/* Plus ↔ Stop / Spinner crossfade */}
            <div className="relative shrink-0">
              {menuOpen && menuPos
                ? createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[9998]"
                        onClick={() => setMenuOpen(false)}
                      />
                      <div
                        className="composer-menu-enter fixed z-[9999] w-[238px] rounded-[24px] shadow-[0px_67px_19px_0px_rgba(0,0,0,0),0px_43px_17px_0px_rgba(0,0,0,0.01),0px_24px_15px_0px_rgba(0,0,0,0.02),0px_11px_11px_0px_rgba(0,0,0,0.03),0px_3px_6px_0px_rgba(0,0,0,0.04)] backdrop-blur-[10px]"
                        style={{ left: menuPos.left, bottom: menuPos.bottom }}
                      >
                        <div className="overflow-hidden rounded-[24px] border border-[rgba(26,26,26,0.09)] bg-[rgba(255,255,255,0.6)]">
                          <div className="flex flex-col px-6 py-2">
                            <button
                              className="flex items-center gap-2 border-b border-[rgba(26,26,26,0.06)] py-4 text-left text-base font-medium leading-6 text-[rgba(26,26,26,0.6)] transition active:opacity-60"
                              onClick={() => { setMenuOpen(false); cameraInputRef.current?.click(); }}
                              type="button"
                            >
                            <span className="flex size-6 items-center justify-center">
                              <svg fill="none" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M19 5.00065H16L15.324 3.19932C15.1294 2.67932 14.632 2.33398 14.076 2.33398H9.92404C9.36804 2.33398 8.87071 2.67932 8.67604 3.19932L8.00004 5.00065H5.00004C3.52671 5.00065 2.33337 6.19398 2.33337 7.66732V16.334C2.33337 17.8073 3.52671 19.0007 5.00004 19.0007H19C20.4734 19.0007 21.6667 17.8073 21.6667 16.334V7.66732C21.6667 6.19398 20.4734 5.00065 19 5.00065Z" stroke="#1A1A1A" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.6" strokeWidth="1.5"/>
                                <path d="M12 15.6673C14.0251 15.6673 15.6667 14.0257 15.6667 12.0007C15.6667 9.97561 14.0251 8.33398 12 8.33398C9.975 8.33398 8.33337 9.97561 8.33337 12.0007C8.33337 14.0257 9.975 15.6673 12 15.6673Z" stroke="#1A1A1A" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.6" strokeWidth="1.5"/>
                                <path d="M5.66675 9.33398C6.21903 9.33398 6.66675 8.88627 6.66675 8.33398C6.66675 7.7817 6.21903 7.33398 5.66675 7.33398C5.11446 7.33398 4.66675 7.7817 4.66675 8.33398C4.66675 8.88627 5.11446 9.33398 5.66675 9.33398Z" fill="#1A1A1A" fillOpacity="0.6"/>
                              </svg>
                            </span>
                            Camera
                          </button>
                          <button
                            className="flex items-center gap-2 border-b border-[rgba(26,26,26,0.06)] py-4 text-left text-base font-medium leading-6 text-[rgba(26,26,26,0.6)] transition active:opacity-60"
                            onClick={() => { setMenuOpen(false); fileInputRef.current?.click(); }}
                            type="button"
                          >
                            <span className="flex size-6 items-center justify-center">
                              <svg fill="none" height="20" viewBox="0 0 17 20" width="17" xmlns="http://www.w3.org/2000/svg">
                                <path d="M8.39988 8.4C7.90282 8.4 7.49988 8.80294 7.49988 9.3V10.5H6.29988C5.80282 10.5 5.39988 10.9029 5.39988 11.4C5.39988 11.8971 5.80282 12.3 6.29988 12.3H7.49988V13.5C7.49988 13.9971 7.90282 14.4 8.39988 14.4C8.89693 14.4 9.29988 13.9971 9.29988 13.5V12.3H10.4999C10.9969 12.3 11.3999 11.8971 11.3999 11.4C11.3999 10.9029 10.9969 10.5 10.4999 10.5H9.29988V9.3C9.29988 8.80294 8.89693 8.4 8.39988 8.4Z" fill="#1A1A1A" fillOpacity="0.6"/>
                                <path clipRule="evenodd" d="M-0.00012207 3.3C-0.00012207 1.47694 1.47682 0 3.29988 0H10.0031C10.5579 0 11.0938 0.219521 11.4886 0.615961L11.4896 0.616903L16.1847 5.312C16.5791 5.70643 16.7999 6.24017 16.7999 6.7968V15.9C16.7999 17.7231 15.3229 19.2 13.4999 19.2H3.29988C1.47682 19.2 -0.00012207 17.7231 -0.00012207 15.9V3.3ZM3.29988 1.8C2.47093 1.8 1.79988 2.47106 1.79988 3.3V15.9C1.79988 16.7289 2.47093 17.4 3.29988 17.4H13.4999C14.3288 17.4 14.9999 16.7289 14.9999 15.9V7.20006H11.6999C10.5404 7.20006 9.59988 6.25952 9.59988 5.10006V1.8H3.29988ZM11.3999 3.07279L13.7271 5.40006H11.6999C11.5345 5.40006 11.3999 5.2654 11.3999 5.10006V3.07279Z" fill="#1A1A1A" fillOpacity="0.6" fillRule="evenodd"/>
                              </svg>
                            </span>
                            Upload file
                          </button>
                          <button
                            className="flex items-center gap-2 py-4 text-left text-base font-medium leading-6 text-[rgba(26,26,26,0.6)] transition active:opacity-60"
                            onClick={() => { setMenuOpen(false); imageInputRef.current?.click(); }}
                            type="button"
                          >
                            <span className="flex size-6 items-center justify-center">
                              <svg fill="none" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M9.03044 6.98867C9.19484 6.49907 10.0039 6.49907 10.1683 6.98867L10.6746 8.50391L12.1898 9.00898C12.4346 9.09062 12.6011 9.32056 12.6011 9.57852C12.6009 9.83624 12.4355 10.0653 12.191 10.1469L10.6758 10.652L10.1695 12.1672C10.0867 12.412 9.85798 12.5785 9.59998 12.5785C9.34199 12.5785 9.11204 12.412 9.03044 12.1672L8.52537 10.652L7.00896 10.1469C6.76444 10.0653 6.59905 9.83622 6.5988 9.57852C6.5988 9.32058 6.76425 9.09063 7.00896 9.00898L8.52537 8.50391L9.03044 6.98867Z" fill="#1A1A1A" fillOpacity="0.6"/>
                                <path clipRule="evenodd" d="M17.1 3.59961C18.9225 3.59961 20.4 5.07707 20.4 6.89961V17.0996C20.4 18.9221 18.9225 20.3996 17.1 20.3996H6.89998C6.73613 20.3996 6.57578 20.3828 6.41834 20.3598C6.39203 20.3564 6.3658 20.3538 6.33982 20.348C4.78442 20.0817 3.59998 18.731 3.59998 17.0996V6.89961C3.59998 5.07707 5.07744 3.59961 6.89998 3.59961H17.1ZM16.0594 13.3391C15.4737 12.7535 14.524 12.7537 13.9383 13.3391L8.67888 18.5996H17.1C17.9284 18.5996 18.6 17.928 18.6 17.0996V15.8797L16.0594 13.3391ZM6.89998 5.39961C6.07155 5.39961 5.39998 6.07118 5.39998 6.89961V17.0996C5.39998 17.7035 5.75756 18.2223 6.27185 18.4602L12.6656 12.0664C13.9543 10.7781 16.0435 10.7779 17.332 12.0664L18.6 13.3344V6.89961C18.6 6.07118 17.9284 5.39961 17.1 5.39961H6.89998Z" fill="#1A1A1A" fillOpacity="0.6" fillRule="evenodd"/>
                              </svg>
                            </span>
                              Upload image
                            </button>
                          </div>
                        </div>
                      </div>
                    </>,
                    document.body,
                  )
                : null}

              <button
                ref={plusBtnRef}
                aria-label={isActive ? "Stop recording" : menuOpen ? "Close menu" : "Add attachment"}
                aria-expanded={!isActive ? menuOpen : undefined}
                className={`relative flex items-center justify-center rounded-[24px] p-2 transition-[transform,background-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-95 ${
                  isActive
                    ? "text-[rgba(26,26,26,0.7)]"
                    : menuOpen
                    ? "rotate-45 bg-[rgba(26,26,26,0.09)] text-[rgba(26,26,26,0.7)]"
                    : "rotate-0 text-[#9aa29a]"
                }`}
                onClick={() => {
                  if (isActive) { stopToField(); return; }
                  if (!menuOpen) {
                    const rect = plusBtnRef.current?.getBoundingClientRect();
                    if (rect) {
                      setMenuPos({
                        left: rect.left,
                        bottom: window.innerHeight - rect.top + 8,
                      });
                    }
                  }
                  setMenuOpen((open) => !open);
                }}
                type="button"
              >
                {/* Plus — fades out + shrinks when active */}
                <span
                  className={`flex items-center justify-center transition-[opacity,transform] duration-200 ${
                    isActive ? "scale-50 opacity-0" : "scale-100 opacity-100"
                  }`}
                >
                  <Plus size={20} weight="bold" />
                </span>
                {/* Stop / Spinner — fades in + grows when active */}
                <span
                  className={`absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-200 ${
                    isActive ? "scale-100 opacity-100" : "scale-50 opacity-0"
                  }`}
                >
                  {isRecording ? (
                    <span className="size-3 rounded-[3px] bg-[rgba(26,26,26,0.72)]" />
                  ) : (
                    <span className="composer-spinner size-4 rounded-full border-2 border-[rgba(26,26,26,0.14)] border-t-[rgba(26,26,26,0.55)]" />
                  )}
                </span>
              </button>
            </div>

            {/* Waveform / Transcribing — expands horizontally via grid-cols trick */}
            <div
              className="grid min-w-0 flex-1 transition-[grid-template-columns] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ gridTemplateColumns: isActive ? "1fr" : "0fr" }}
            >
              <div className="min-w-0 overflow-hidden">
                <div
                  aria-hidden={!isActive}
                  className={`flex h-4 items-center gap-[1px] overflow-hidden transition-opacity duration-200 ${
                    isActive ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {isRecording ? (
                    waveHistory.map((amp, i) => {
                      const t = i / (WAVE_HISTORY_SIZE - 1);
                      const opacity = 0.12 + t * 0.62;
                      const barHeight = Math.max(2, amp * 14);
                      return (
                        <span
                          key={i}
                          className="shrink-0 rounded-full transition-[height] duration-75 ease-out"
                          style={{
                            width: "2px",
                            height: `${barHeight}px`,
                            backgroundColor: `rgba(26,26,26,${opacity.toFixed(2)})`,
                          }}
                        />
                      );
                    })
                  ) : (
                    <p className="truncate text-base font-medium leading-6 tracking-[-0.16px] text-[rgba(26,26,26,0.6)]">
                      Transcribing...
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right cluster: Mic (shrinks away) + Send */}
          <div className="flex shrink-0 items-center gap-0.5">

            <input ref={cameraInputRef} accept="image/*" capture="environment" className="hidden" onChange={(e) => { e.target.value = ""; }} type="file" />
            <input ref={fileInputRef} className="hidden" onChange={(e) => { e.target.value = ""; }} type="file" />
            <input ref={imageInputRef} accept="image/*" className="hidden" onChange={(e) => { e.target.value = ""; }} type="file" />

            {/* Mic button — collapses width + fades when active */}
            <div
              className="overflow-hidden transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ maxWidth: isActive ? "0px" : "44px", opacity: isActive ? 0 : 1 }}
            >
              <button
                aria-label="Record voice message"
                className="flex items-center justify-center rounded-[24px] p-2 text-[#9ba49c] transition active:scale-95 disabled:opacity-50"
                disabled={isLoading || isActive}
                onClick={() => void startRecording()}
                type="button"
              >
                <Microphone size={20} />
              </button>
            </div>

            {/* Send / Voice / Stop-and-send */}
            <button
              aria-label={isActive ? "Stop and send" : hasInput ? "Send message" : "Open voice mode"}
              className="flex items-center justify-center rounded-[24px] bg-white p-2 text-[var(--brand)] shadow-[0_10px_24px_-18px_rgba(31,36,31,0.7)] transition active:scale-95 disabled:opacity-50"
              disabled={isLoading || (isActive && (!isRecording || !onSendText)) || (!isActive && !hasInput && !onVoiceMode)}
              onClick={() => {
                if (isActive) { stopToSend(); return; }
                if (!hasInput) onVoiceMode?.();
              }}
              type={hasInput && !isActive ? "submit" : "button"}
            >
              {isActive || hasInput ? (
                <ArrowUp size={20} weight="bold" />
              ) : (
                <Waveform size={20} weight="bold" />
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function VoiceModeScreen({
  aiLevel,
  elapsedSeconds,
  notice,
  onAudioComplete,
  onTranscriptComplete,
  onInterrupt,
  onBack,
  onClose,
  onNoticeChange,
  onStatusChange,
  onTogglePhase,
  phase,
  status,
  thinkingSteps,
  title,
  transcript,
  aiAnswer,
}: {
  aiLevel: number;
  elapsedSeconds: number;
  notice: string;
  onAudioComplete: (audio: Blob) => void;
  onTranscriptComplete: (transcript: string) => void;
  onInterrupt: () => void;
  onBack: () => void;
  onClose: () => void;
  onNoticeChange: (notice: string) => void;
  onStatusChange: (status: VoiceStatus) => void;
  onTogglePhase: () => void;
  phase: "user" | "ai";
  status: VoiceStatus;
  thinkingSteps: string[];
  title: string;
  transcript: string;
  aiAnswer: string;
}) {
  const isUserSpeaking = phase === "user";
  const isThinking = status === "processing";
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [revealedChars, setRevealedChars] = useState(0);
  const scrollRef = useRef<HTMLElement>(null);
  const transcriptRef = useRef<HTMLParagraphElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const scrollAnimRef = useRef(0);

  // Write the coach's answer into the chat while it's being spoken aloud,
  // revealing it letter by letter. Each new letter animates in (fade + rise +
  // deblur), and the pacing tracks the spoken delivery so text and voice stay
  // in sync (caption-style).
  useEffect(() => {
    if (!aiAnswer) {
      setRevealedChars(0);
      return;
    }
    const wordCount = aiAnswer.trim().split(/\s+/).filter(Boolean).length || 1;
    const totalMs = wordCount * 360; // ~ speaking pace at rate 0.95
    const stepMs = Math.max(16, Math.round(totalMs / aiAnswer.length));
    let i = 0;
    setRevealedChars(0);
    const id = window.setInterval(() => {
      i += 1;
      setRevealedChars(i);
      if (i >= aiAnswer.length) window.clearInterval(id);
    }, stepMs);
    return () => window.clearInterval(id);
  }, [aiAnswer]);

  // As letters reveal, keep the latest text above the orb zone: when the
  // text's bottom edge nears the orb, scroll the container down (teleprompter
  // style) so the words never overlap the particles. The scroll glides with a
  // 400ms ease-out each time it needs to move.
  useEffect(() => {
    const el = scrollRef.current;
    const ans = answerRef.current;
    if (!el || !ans || revealedChars === 0) return;
    // Keep the answer's bottom ~340px above the container bottom — that line
    // sits just above the orb, which is anchored in the lower zone.
    const ORB_SAFE = 340;
    const target = ans.offsetTop + ans.offsetHeight - (el.clientHeight - ORB_SAFE);
    if (target <= el.scrollTop) return;

    const from = el.scrollTop;
    const distance = target - from;
    const duration = 400;
    const start = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3); // cubic ease-out

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      el.scrollTop = from + distance * easeOut(t);
      if (t < 1) scrollAnimRef.current = requestAnimationFrame(step);
    };
    scrollAnimRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(scrollAnimRef.current);
  }, [revealedChars]);

  // When the user's words become a bubble, push the conversation up so the
  // bubble rests 24px below the top bar (ChatGPT-style). The thinking steps
  // then appear right underneath it, clear of the orb in the bottom zone.
  // We scroll the container explicitly (rather than scrollIntoView) so it is
  // deterministic and re-pins when the thinking step grows the content.
  useEffect(() => {
    const el = scrollRef.current;
    const bubble = transcriptRef.current;
    if (!el || !bubble) return;
    const TOP_GAP = 140; // top bar (~116px) + 24px breathing room
    const raf = requestAnimationFrame(() => {
      el.scrollTo({ top: Math.max(0, bubble.offsetTop - TOP_GAP), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [transcript, isThinking]);

  useEffect(() => {
    if (status !== "listening") return;

    // When configured for Whisper, skip the Web Speech API entirely (it streams to
    // Google's servers and is blocked on some networks) and go straight to Path B.
    const preferWhisper = process.env.NEXT_PUBLIC_VOICE_PROVIDER === "whisper";

    // ── Path A: Web Speech API (no API key needed; works on Chrome/Safari/Edge) ──
    interface ISpeechRecognition extends EventTarget {
      continuous: boolean; interimResults: boolean; lang: string;
      start(): void; abort(): void;
      onresult: ((event: { results: { [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } }; resultIndex: number }) => void) | null;
      onend: (() => void) | null;
      onerror: ((event: { error: string }) => void) | null;
    }
    type SpeechRecognitionCtor = new () => ISpeechRecognition;
    const SpeechRecCtor: SpeechRecognitionCtor | undefined =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;

    if (SpeechRecCtor && !preferWhisper) {
      const recognition = new SpeechRecCtor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      let finalTranscript = "";
      let cleanedUp = false;
      let animFrame = 0;

      // Gentle idle pulse for the orb — no competing getUserMedia while SpeechRecognition
      // already holds the mic (a second concurrent grab triggers audio-capture errors on macOS).
      let phase = 0;
      const pulse = () => {
        if (cleanedUp) return;
        phase += 0.025;
        setVolumeLevel(0.18 + Math.sin(phase) * 0.12);
        animFrame = requestAnimationFrame(pulse);
      };
      animFrame = requestAnimationFrame(pulse);

      const cleanup = () => {
        cleanedUp = true;
        window.cancelAnimationFrame(animFrame);
        setVolumeLevel(0);
        try { recognition.abort(); } catch { /* noop */ }
      };

      recognition.onresult = (event: { results: { [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } }; resultIndex: number }) => {
        finalTranscript = "";
        for (let i = 0; i < Object.keys(event.results).length; i++) {
          if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        }
        // Briefly spike the orb when speech is detected
        setVolumeLevel(0.75);
      };

      recognition.onend = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        window.cancelAnimationFrame(animFrame);
        setVolumeLevel(0);

        const trimmed = finalTranscript.trim();
        if (!trimmed) {
          onNoticeChange("I didn't catch that. Try speaking again.");
          onStatusChange("idle");
          window.setTimeout(() => onStatusChange("listening"), 300);
          return;
        }
        onTranscriptComplete(trimmed);
      };

      recognition.onerror = (event: { error: string }) => {
        // "aborted" fires when we call recognition.abort() ourselves — ignore it.
        if (event.error === "aborted") return;
        if (cleanedUp) return;
        cleanedUp = true;
        window.cancelAnimationFrame(animFrame);
        setVolumeLevel(0);

        if (event.error === "not-allowed") {
          onStatusChange("error");
          onNoticeChange("Microphone access is blocked. Allow it in your browser settings.");
        } else if (event.error === "no-speech") {
          onNoticeChange("I'm listening. Speak a little closer to the mic.");
          onStatusChange("idle");
          window.setTimeout(() => onStatusChange("listening"), 300);
        } else if (event.error === "network") {
          // Chrome sends audio to Google — fail gracefully and try the local fallback path
          onNoticeChange("Speech service unavailable. Tap the mic and try again.");
          onStatusChange("idle");
          window.setTimeout(() => onStatusChange("listening"), 400);
        } else {
          onStatusChange("error");
          onNoticeChange("Could not access the microphone. Check your browser permissions and try again.");
        }
      };

      try {
        recognition.start();
        onStatusChange("listening");
        onNoticeChange("");
      } catch {
        cleanedUp = true;
        window.cancelAnimationFrame(animFrame);
        onStatusChange("error");
        onNoticeChange("Could not start voice recognition. Try refreshing the page.");
      }

      return cleanup;
    }

    // ── Path B: MediaRecorder + Whisper fallback (requires OPENAI_API_KEY) ──
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      onStatusChange("unsupported");
      onNoticeChange("Voice recording is not supported in this browser.");
      return;
    }

    let audioContext: AudioContext | null = null;
    let animationFrame = 0;
    let mediaRecorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;
    let stopTimeout = 0;
    let hasStopped = false;
    let heardSpeech = false;
    let silentSince = 0;
    const chunks: Blob[] = [];

    const stopRecording = () => {
      if (hasStopped) return;
      hasStopped = true;
      window.clearTimeout(stopTimeout);
      window.cancelAnimationFrame(animationFrame);
      setVolumeLevel(0);

      if (mediaRecorder?.state === "recording") {
        mediaRecorder.stop();
      }

      stream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
    };

    void navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((capturedStream) => {
        stream = capturedStream;
        const mimeType = getSupportedAudioMimeType();
        mediaRecorder = new MediaRecorder(
          capturedStream,
          mimeType ? { mimeType } : undefined,
        );
        audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(capturedStream);
        const analyser = audioContext.createAnalyser();
        const samples = new Uint8Array(analyser.fftSize);
        source.connect(analyser);

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
          if (!heardSpeech) {
            onNoticeChange("I’m listening. Speak a little closer to the mic.");
            onStatusChange("idle");
            window.setTimeout(() => onStatusChange("listening"), 300);
            return;
          }

          const audio = new Blob(chunks, {
            type: mediaRecorder?.mimeType || "audio/webm",
          });
          onAudioComplete(audio);
        };

        const monitorVolume = () => {
          analyser.getByteTimeDomainData(samples);
          const volume =
            samples.reduce((sum, value) => sum + Math.abs(value - 128), 0) /
            samples.length;
          const now = performance.now();

          setVolumeLevel(Math.min(volume / 18, 1));

          if (volume > 5.5) {
            heardSpeech = true;
            silentSince = 0;
            onNoticeChange("");
          } else if (heardSpeech) {
            silentSince ||= now;
            if (now - silentSince > 1200) {
              stopRecording();
              return;
            }
          }

          animationFrame = window.requestAnimationFrame(monitorVolume);
        };

        mediaRecorder.start();
        onStatusChange("listening");
        onNoticeChange("");
        monitorVolume();
        stopTimeout = window.setTimeout(stopRecording, 15000);
      })
      .catch((error: unknown) => {
        onStatusChange("error");
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          onNoticeChange("Microphone access is blocked. Allow it to use voice chat.");
          return;
        }

        onNoticeChange("I could not access the microphone. Check your input device.");
      });

    return () => {
      stopRecording();
    };
  }, [
    onAudioComplete,
    onTranscriptComplete,
    onNoticeChange,
    onStatusChange,
    status,
  ]);

  // ── Barge-in: detect the user speaking while the coach is talking ──
  // While the AI is speaking we monitor the mic; if the user starts talking we
  // interrupt the TTS and hand control back to them.
  //
  // The hard part: browser echo cancellation does NOT remove `speechSynthesis`
  // output, because the OS TTS engine plays outside the browser's audio
  // pipeline. So the coach's own voice leaks into the mic. A fixed threshold
  // either makes the AI interrupt itself or misses the user entirely.
  //
  // Instead we learn an adaptive baseline of the ambient + AI-leakage level
  // during a short warm-up, then only fire when the live mic volume spikes
  // clearly above that baseline (the user talking directly into the mic is
  // much louder than the AI bleeding through the speakers).
  useEffect(() => {
    if (status !== "speaking") return;
    if (!navigator.mediaDevices?.getUserMedia) return;

    let audioContext: AudioContext | null = null;
    let animationFrame = 0;
    let stream: MediaStream | null = null;
    let stopped = false;
    let startTimer = 0;

    // Adaptive detection state.
    let baseline = 0; // smoothed ambient + AI-leak volume
    let armedAt = 0; // when detection becomes active (after warm-up)
    let loudSince = 0;

    const WARMUP_MS = 700; // let the baseline settle before arming
    const MIN_ABSOLUTE = 12; // never trigger below this raw volume (real speech)
    const SPIKE_FACTOR = 2.2; // user must be ~2.2x louder than the baseline
    const SUSTAIN_MS = 350; // sustained window to reject transient noise

    const stop = () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(startTimer);
      window.cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
    };

    // Wait until speechSynthesis is actually speaking before opening the mic.
    // Opening getUserMedia while the TTS engine is still initialising can kill
    // the utterance on macOS Chrome, so poll (capped) until speaking is true.
    const pollStart = Date.now();
    const openWhenSpeaking = () => {
      if (stopped) return;
      const speaking = window.speechSynthesis?.speaking;
      if (!speaking && Date.now() - pollStart < 8000) {
        startTimer = window.setTimeout(openWhenSpeaking, 150);
        return;
      }
      void navigator.mediaDevices
        .getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        })
        .then((capturedStream) => {
          if (stopped) {
            capturedStream.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = capturedStream;
          audioContext = new AudioContext();
          void audioContext.resume();
          const source = audioContext.createMediaStreamSource(capturedStream);
          const analyser = audioContext.createAnalyser();
          const samples = new Uint8Array(analyser.fftSize);
          source.connect(analyser);

          armedAt = performance.now() + WARMUP_MS;

          const monitor = () => {
            if (stopped) return;
            analyser.getByteTimeDomainData(samples);
            const volume =
              samples.reduce((sum, value) => sum + Math.abs(value - 128), 0) /
              samples.length;
            const now = performance.now();

            // During warm-up just track the baseline (AI voice + ambient).
            if (now < armedAt) {
              baseline = baseline === 0 ? volume : baseline * 0.9 + volume * 0.1;
              animationFrame = window.requestAnimationFrame(monitor);
              return;
            }

            const threshold = Math.max(MIN_ABSOLUTE, baseline * SPIKE_FACTOR);

            if (volume > threshold) {
              loudSince ||= now;
              if (now - loudSince > SUSTAIN_MS) {
                stop();
                onInterrupt();
                return;
              }
            } else {
              loudSince = 0;
              // Slowly track rising baseline (e.g. AI getting louder) so we
              // don't drift into false positives, but never let a sustained
              // user voice pull the baseline up fast enough to escape.
              baseline = baseline * 0.99 + volume * 0.01;
            }

            animationFrame = window.requestAnimationFrame(monitor);
          };
          monitor();
        })
        .catch(() => {
          /* barge-in is best-effort; ignore mic failures here */
        });
    };

    // Small initial delay so the speak() call has fired before we start polling.
    startTimer = window.setTimeout(openWhenSpeaking, 250);

    return stop;
  }, [status, onInterrupt]);

  // Figma voice-mode background glow. Base opacity sits at 0.2 and pulses up
  // toward 0.4 driven by whoever is currently speaking (mic level when the user
  // talks, TTS amplitude when the AI talks). The user gets a warm sunset glow;
  // the AI keeps the green glow.
  const speakingLevel = Math.min(1, isUserSpeaking ? volumeLevel : aiLevel);
  const backdropOpacity = 0.2 + speakingLevel * 0.1;

  return (
    <>
      <img
        alt=""
        aria-hidden="true"
        src={isUserSpeaking ? "/voice-bg-warm.svg" : "/voice-bg.svg"}
        className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-100 ease-out"
        style={{ opacity: backdropOpacity }}
      />
      <div className="absolute inset-x-0 top-0 z-10 bg-white">
        <div className="flex items-center justify-between px-6 pb-5 pt-[68px]">
          <button
            aria-label="Back to dashboard"
            className="flex size-7 items-center justify-center rounded-full bg-[rgba(26,26,26,0.09)] text-[#333a34] transition active:scale-95"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={16} weight="bold" />
          </button>
          <p className="text-base font-medium tracking-[-0.15px] text-[rgba(26,26,26,0.6)]">
            {title}
          </p>
          <div className="flex size-7 items-center justify-center rounded-full bg-[rgba(26,26,26,0.09)] text-[#333a34]">
            <DotsThree size={20} weight="bold" />
          </div>
        </div>
        <div className="h-[24px] bg-gradient-to-b from-[rgba(255,255,255,0.6)] to-transparent" />
      </div>

      {/* Content fade — sits below header, overlays the scroll area */}
      <div className="pointer-events-none absolute inset-x-0 top-[116px] z-[9] h-[60px] bg-gradient-to-b from-white to-transparent" />

      <section
        ref={scrollRef}
        className="chat-messages relative z-[2] flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-8 pb-[700px] pt-[148px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <p className="message-enter whitespace-pre-wrap text-base font-medium leading-7 tracking-[-0.2px] text-[#080c09]">
          {financialSpotMessages[0].content}
        </p>
        {transcript ? (
          <p
            ref={transcriptRef}
            className="mt-8 self-end rounded-[32px] bg-[rgba(26,26,26,0.09)] px-5 py-3 text-right text-base font-medium leading-6 tracking-[-0.2px] text-[rgba(31,36,31,0.68)] [scroll-margin-top:140px]"
          >
            {transcript}
          </p>
        ) : null}
        {isThinking ? (
          <div className="thinking-rise mt-6">
            <ThinkingProcess steps={thinkingSteps} />
          </div>
        ) : null}
        {revealedChars > 0 ? (
          <div
            ref={answerRef}
            className="mt-6 whitespace-pre-wrap text-base font-medium leading-7 tracking-[-0.2px] text-[#080c09]"
          >
            {(() => {
              // Tokenise the revealed text into words and whitespace. Words are
              // wrapped in an inline-block so they never break mid-word; each
              // letter animates in on mount. Stable per-letter keys (absolute
              // index) mean already-shown letters never re-animate.
              const visible = aiAnswer.slice(0, revealedChars);
              const tokens = visible.match(/\S+|\s+/g) ?? [];
              let idx = 0;
              return tokens.map((tok, ti) => {
                if (/^\s+$/.test(tok)) {
                  const start = idx;
                  idx += tok.length;
                  return <span key={`s${start}`}>{tok}</span>;
                }
                const letters = tok.split("").map((ch) => {
                  const k = idx++;
                  return (
                    <span key={k} className="voice-answer-char">
                      {ch}
                    </span>
                  );
                });
                return (
                  <span key={`w${ti}`} className="voice-answer-word">
                    {letters}
                  </span>
                );
              });
            })()}
          </div>
        ) : null}
        {notice ? (
          <p className="mt-4 rounded-2xl bg-white/70 px-4 py-3 text-sm leading-5 text-[#7d837e]">
            {notice}
          </p>
        ) : null}
      </section>

      {/* ChatGPT-style anchor: the orb is pinned to the bottom zone, 32px above
          the composer. Text scrolls from the top and never reaches it, and the
          position is identical whether the user or the AI is speaking. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[124px] z-[3] flex justify-center">
        <button
          aria-label={
            isUserSpeaking
              ? "Preview AI speaking color"
              : "Preview user speaking color"
          }
          className="voice-orb-inline-enter pointer-events-auto block rounded-full transition active:scale-[0.98]"
          onClick={onTogglePhase}
          type="button"
        >
          <VoiceOrbCluster
            speaker={
              isUserSpeaking
                ? status === "processing"
                  ? "user-processing"
                  : "user"
                : status === "processing"
                  ? "processing"
                  : "ai"
            }
            level={isUserSpeaking ? volumeLevel : aiLevel}
            userColor="#F28705"
            aiColor="#106844"
            size={160}
          />
          <span className="sr-only">
            {isUserSpeaking ? "User speaking" : "AI speaking"}
          </span>
        </button>
      </div>

      <VoiceComposer
        level={isUserSpeaking ? volumeLevel : aiLevel}
        onClose={onClose}
        status={status}
      />
    </>
  );
}

function VoiceComposer({
  level,
  onClose,
  status,
}: {
  level: number;
  onClose: () => void;
  status: VoiceStatus;
}) {
  const [waveHistory, setWaveHistory] = useState<number[]>(() =>
    new Array(WAVE_HISTORY_SIZE).fill(0),
  );
  const levelRef = useRef(level);
  const lastSampleRef = useRef(0);

  useEffect(() => {
    levelRef.current = level;
  });

  useEffect(() => {
    if (status === "transcribing") {
      setWaveHistory(new Array(WAVE_HISTORY_SIZE).fill(0));
      return;
    }
    let rafId: number;
    const tick = (now: number) => {
      if (now - lastSampleRef.current >= 50) {
        lastSampleRef.current = now;
        setWaveHistory((prev) => [...prev.slice(1), Math.max(0, Math.min(1, levelRef.current))]);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [status]);


  return (
    <div className="absolute inset-x-0 bottom-0 z-[2] flex w-full items-center px-4 pb-10 pt-5">
      <div className="flex w-full items-center gap-4 rounded-[24px] border border-[rgba(26,26,26,0.09)] bg-[rgba(255,255,255,0.36)] p-2 shadow-[0px_169px_47px_0px_rgba(0,0,0,0),0px_108px_43px_0px_rgba(0,0,0,0.01),0px_61px_37px_0px_rgba(0,0,0,0.02),0px_27px_27px_0px_rgba(0,0,0,0.04),0px_7px_15px_0px_rgba(0,0,0,0.04)] backdrop-blur-[20px]">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Left icon: Plus in normal state, spinner while transcribing */}
          {status === "transcribing" ? (
            <span className="flex shrink-0 items-center justify-center rounded-[24px] p-2">
              <span className="composer-spinner size-4 rounded-full border-2 border-[rgba(26,26,26,0.14)] border-t-[rgba(26,26,26,0.55)]" />
            </span>
          ) : (
            <button
              aria-label="Create a new task"
              className="flex shrink-0 items-center justify-center rounded-[24px] p-2 text-[#9aa29a] transition active:scale-95"
              type="button"
            >
              <Plus size={20} weight="bold" />
            </button>
          )}

          <div className="voice-input-enter flex min-w-0 flex-1 items-center justify-between gap-3">
            {status === "transcribing" ? (
              <p className="min-w-0 flex-1 truncate text-base font-medium leading-6 tracking-[-0.16px] text-[rgba(26,26,26,0.6)]">
                Transcribing...
              </p>
            ) : (
              <>
                {/* Scrolling history waveform — bars fill full width, oldest=faint left, newest=bright right */}
                <div
                  aria-hidden="true"
                  className="flex min-w-0 flex-1 items-center gap-[1px] overflow-hidden"
                >
                  {waveHistory.map((amp, i) => {
                    const t = i / (WAVE_HISTORY_SIZE - 1); // 0=oldest, 1=newest
                    const opacity = 0.12 + t * 0.62;
                    const barHeight = Math.max(2, amp * 14);
                    return (
                      <span
                        key={i}
                        className="flex-1 rounded-full transition-[height] duration-75 ease-out"
                        style={{
                          height: `${barHeight}px`,
                          backgroundColor: `rgba(26,26,26,${opacity.toFixed(2)})`,
                        }}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <button
          aria-label="Close voice mode"
          className="flex shrink-0 items-center justify-center rounded-[24px] bg-white p-2 text-[#8b928c] shadow-[0_10px_24px_-18px_rgba(31,36,31,0.7)] transition active:scale-95"
          onClick={onClose}
          type="button"
        >
          <X size={20} weight="bold" />
        </button>
      </div>
    </div>
  );
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

const WAVE_HISTORY_SIZE = 70;


function getSupportedAudioMimeType() {
  const supportedTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];

  return supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));
}

function TopBar({ label, onMenu }: { label: string; onMenu: () => void }) {
  return (
    <div className="dash-topbar-enter absolute inset-x-0 top-[60px] flex items-center bg-white/60 px-6 py-4 backdrop-blur-2xl">
      <button
        aria-label="Open chat"
        className="flex items-center gap-4 py-1 text-[#6d746d] transition active:scale-[0.98]"
        onClick={onMenu}
        type="button"
      >
        <List className="topbar-icon-enter" size={20} />
        <span className="topbar-label-enter text-base font-medium">{label}</span>
      </button>
    </div>
  );
}

