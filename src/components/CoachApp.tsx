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
import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevronRight } from "@tabler/icons-react";
import { TextShimmer } from "./agent-elements/text-shimmer";

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
  const [chatTitle, setChatTitle] = useState("Marketing coach");
  const [chatMode, setChatMode] = useState<"general" | "financial">("general");
  const [voiceMode, setVoiceMode] = useState<"user" | "ai" | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState("");
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

  useEffect(() => {
    if (!isVoiceOpen) return;

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setVoiceElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isVoiceOpen]);

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
              // First non-thinking line → switch to content mode
              thinkingDone = true;
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
      setView("chat");
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

    const prefersReducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;

      let decayTimer = 0;
      const finish = () => {
        window.clearTimeout(decayTimer);
        setAiLevel(0);
        resolve();
      };

      utterance.onstart = () => setAiLevel(prefersReducedMotion ? 0.6 : 0.45);
      utterance.onboundary = () => {
        if (prefersReducedMotion) return;
        setAiLevel(1);
        window.clearTimeout(decayTimer);
        decayTimer = window.setTimeout(() => setAiLevel(0.4), 110);
      };
      utterance.onend = finish;
      utterance.onerror = finish;

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
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

      setVoiceStatus("speaking");
      await speakText(responseText);

      if (requestId.current !== currentRequest) return;

      setVoiceTranscript("");
      setVoiceMode("user");
      setVoiceStatus("listening");
    },
    [isLoading, messages, speakText, streamAssistantResponse, voiceMode],
  );

  const handleVoiceAudioComplete = useCallback(
    async (audio: Blob) => {
      if (isLoading || audio.size === 0) return;

      setVoiceStatus("transcribing");
      setVoiceNotice("Transcribing your answer...");

      try {
        const formData = new FormData();
        const extension = audio.type.includes("mp4") ? "mp4" : "webm";
        formData.append("audio", audio, `voice-answer.${extension}`);

        const response = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Transcription failed.");
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
    setView("chat");

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
    setView("home");
  }

  function openVoiceMode() {
    if (view !== "chat") {
      setChatTitle("Marketing coach");
      setChatMode("general");
      setView("chat");
    }
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
        <StatusBar />

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
            onBack={() => { closeVoiceMode(); setView("home"); }}
            onClose={closeVoiceMode}
            onNoticeChange={setVoiceNotice}
            onStatusChange={setVoiceStatus}
            onAudioComplete={handleVoiceAudioComplete}
            onTogglePhase={() =>
              setVoiceMode((current) => (current === "user" ? "ai" : "user"))
            }
          />
        ) : view === "home" ? (
          <HomeScreen
            input={input}
            onInputChange={setInput}
            onInputKeyDown={handleComposerKeyDown}
            onVoiceMode={openVoiceMode}
            onOpenChat={() => {
              setChatTitle("Marketing coach");
              setChatMode("general");
              setView("chat");
            }}
            onSend={() => void sendMessage()}
            onFinancialSpot={startFinancialSpot}
            onTaskPrompt={(prompt, taskTitle) => {
              setActiveTaskTitle(taskTitle);
              void sendMessage(prompt);
            }}
            completedTasks={completedTasks}
          />
        ) : (
          <ChatScreen
            chatMode={chatMode}
            title={chatTitle}
            error={error}
            input={input}
            isLoading={isLoading}
            messages={messages}
            thinkingSteps={thinkingSteps}
            onBack={() => setView("home")}
            onInputChange={setInput}
            onInputKeyDown={handleComposerKeyDown}
            onSend={() => void sendMessage()}
            onSuggestion={(suggestion) => void sendMessage(suggestion)}
            onVoiceMode={openVoiceMode}
            onCompleteTask={completeActiveTask}
          />
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <div className="h-[5px] w-36 rounded-full bg-[#b7b8c5]" />
        </div>
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
  onTaskPrompt,
  completedTasks,
}: {
  input: string;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFinancialSpot: () => void;
  onVoiceMode: () => void;
  onOpenChat: () => void;
  onSend: () => void;
  onTaskPrompt: (prompt: string, taskTitle: string) => void;
  completedTasks: string[];
}) {
  return (
    <>
      <TopBar label="New task" onMenu={onOpenChat} />

      <section className="px-6 pt-[151px]">
        <p className="text-[20px] leading-7 tracking-[-0.5px] text-[#2f3430]">
          Good morning Marcos,
          <br />
          <span className="text-[#6f756f]">You have 3 tasks to be done today.</span>
        </p>
      </section>

      <section className="mt-[78px] px-6">
        <div className="mb-3 flex items-center justify-between">
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
                        <Sparkle size={20} weight="regular" />
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoFollow.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    autoFollow.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <>
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
        className="chat-messages absolute inset-0 overflow-y-auto overflow-x-hidden px-8 pb-[164px] pt-[148px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="space-y-3">
          {chatMode === "financial" && messages.length > 1 ? (
            <FinancialChatHistory
              isLoading={isLoading}
              isThinking={isThinking}
              messages={messages}
            />
          ) : (
            messages.map((message) => {
              if (
                message.role === "assistant" &&
                !message.content &&
                isThinking
              ) {
                return null;
              }

              return (
                <div
                  key={message.id}
                  className={`message-enter flex ${
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
                    {message.content || <TypingDots />}
                  </div>
                </div>
              );
            })
          )}

          {isThinking ? (
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
}: {
  isLoading: boolean;
  isThinking: boolean;
  messages: Message[];
}) {
  return (
    <div className="space-y-7">
      {messages.map((message) => {
        // Skip the trailing empty assistant placeholder; the thinking/typing
        // indicator is rendered separately below.
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

        return (
          <p
            key={message.id}
            className="message-enter whitespace-pre-wrap text-base font-medium leading-7 tracking-[-0.2px] text-[#080c09]"
          >
            {message.content}
          </p>
        );
      })}

      {isLoading && !isThinking ? (
        <p className="whitespace-pre-wrap text-base font-medium leading-7 tracking-[-0.2px] text-[#080c09]">
          <TypingDots />
        </p>
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

function Composer({
  input,
  isLoading = false,
  onInputChange,
  onInputKeyDown,
  onSend,
  onVoiceMode,
  placeholder,
}: {
  input: string;
  isLoading?: boolean;
  onInputChange: (value: string) => void;
  onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onVoiceMode?: () => void;
  placeholder: string;
}) {
  const hasInput = Boolean(input.trim());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  return (
    <form
      className="absolute inset-x-0 bottom-0 z-10 w-full px-4 pb-10 pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="flex w-full flex-col gap-2 rounded-[24px] border border-[rgba(26,26,26,0.09)] bg-[rgba(255,255,255,0.36)] px-2 pb-2 pt-3 shadow-[0px_169px_47px_0px_rgba(0,0,0,0),0px_108px_43px_0px_rgba(0,0,0,0.01),0px_61px_37px_0px_rgba(0,0,0,0.02),0px_27px_27px_0px_rgba(0,0,0,0.04),0px_7px_15px_0px_rgba(0,0,0,0.04)] backdrop-blur-[20px]">
        <div className="flex w-full items-center px-3">
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

        <div className="flex w-full items-end justify-between">
          <button
            aria-label="Create a new task"
            className="flex items-center justify-center rounded-[24px] p-2 text-[#9aa29a] transition active:scale-95"
            type="button"
          >
            <Plus size={20} weight="bold" />
          </button>

          <div className="flex items-center gap-0.5">
            <button
              aria-label="Voice input"
              className="flex items-center justify-center rounded-[24px] p-2 text-[#9ba49c] transition active:scale-95"
              type="button"
            >
              <Microphone size={20} />
            </button>
            <button
              aria-label={hasInput ? "Send message" : "Open voice mode"}
              className="flex items-center justify-center rounded-[24px] bg-white p-2 text-[var(--brand)] shadow-[0_10px_24px_-18px_rgba(31,36,31,0.7)] transition active:scale-95 disabled:opacity-50"
              disabled={isLoading || (!hasInput && !onVoiceMode)}
              onClick={() => {
                if (!hasInput) onVoiceMode?.();
              }}
              type={hasInput ? "submit" : "button"}
            >
              {hasInput ? (
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
}: {
  aiLevel: number;
  elapsedSeconds: number;
  notice: string;
  onAudioComplete: (audio: Blob) => void;
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
}) {
  const isUserSpeaking = phase === "user";
  const isThinking = status === "processing";
  const [volumeLevel, setVolumeLevel] = useState(0);
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [isThinking, transcript]);

  useEffect(() => {
    if (status !== "listening") return;
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
    onNoticeChange,
    onStatusChange,
    status,
  ]);

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[1] transition-opacity ease-out"
        style={{
          opacity: isUserSpeaking ? volumeLevel * 0.28 : aiLevel * 0.6,
          transitionDuration: isUserSpeaking ? "75ms" : "140ms",
          background: isUserSpeaking
            ? "linear-gradient(to bottom, transparent 30%, rgba(180,155,115,0.7) 100%)"
            : "linear-gradient(to bottom, transparent 20%, rgba(16,80,52,0.6) 100%)",
        }}
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
        className="chat-messages flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-8 pb-[248px] pt-[232px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <p className="message-enter whitespace-pre-wrap text-base font-medium leading-7 tracking-[-0.2px] text-[#080c09]">
          {financialSpotMessages[0].content}
        </p>
        {transcript ? (
          <p className="mt-8 self-end rounded-[32px] bg-[rgba(26,26,26,0.09)] px-5 py-3 text-right text-base font-medium leading-6 tracking-[-0.2px] text-[rgba(31,36,31,0.68)]">
            {transcript}
          </p>
        ) : null}
        {isThinking ? (
          <div className="thinking-rise mt-6">
            <ThinkingProcess steps={thinkingSteps} />
          </div>
        ) : null}
        {notice ? (
          <p className="mt-4 rounded-2xl bg-white/70 px-4 py-3 text-sm leading-5 text-[#7d837e]">
            {notice}
          </p>
        ) : null}
      </section>

      <div className="voice-orb-enter absolute left-1/2 top-[628px]">
        <button
          aria-label={
            isUserSpeaking
              ? "Preview AI speaking color"
              : "Preview user speaking color"
          }
          className={`voice-orb size-[88px] rounded-full transition-[background] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isUserSpeaking
              ? "bg-[radial-gradient(circle_at_45%_28%,#d31f05_0%,#f28705_36%,#f6c55e_62%,#f2a09a_100%)]"
              : "bg-[radial-gradient(circle_at_48%_28%,#031714_0%,#0b533b_42%,#41a877_70%,#b1c5b4_100%)]"
          }`}
          onClick={onTogglePhase}
          style={
            {
              "--orb-speed":
                status === "speaking"
                  ? "1.9s"
                  : status === "processing"
                    ? "2.6s"
                    : "4s",
              "--orb-scale-a": status === "speaking" ? "1.08" : "1.045",
              "--orb-scale-b": status === "speaking" ? "1.05" : "1.02",
              "--orb-shadow": isUserSpeaking
                ? "0 18px 42px -26px rgba(196,63,8,0.75)"
                : "0 18px 42px -26px rgba(3,55,38,0.75)",
              "--orb-ring": isUserSpeaking
                ? "rgba(242,135,5,0.5)"
                : "rgba(65,168,119,0.5)",
            } as CSSProperties
          }
          type="button"
        >
          <span className="sr-only">
            {isUserSpeaking ? "User speaking" : "AI speaking"}
          </span>
        </button>
      </div>

      <VoiceComposer
        elapsedSeconds={elapsedSeconds}
        onClose={onClose}
        status={status}
      />
    </>
  );
}

function VoiceComposer({
  elapsedSeconds,
  onClose,
  status,
}: {
  elapsedSeconds: number;
  onClose: () => void;
  status: VoiceStatus;
}) {
  const waveformBars = [
    6, 10, 5, 13, 8, 16, 7, 11, 14, 6, 17, 9, 5, 12, 15, 7, 18, 4, 10, 6,
    14, 8, 16, 5,
  ];
  const statusLabel =
    status === "speaking"
      ? "Speaking"
      : status === "unsupported" || status === "error"
        ? "Paused"
        : formatTimer(elapsedSeconds);

  return (
    <div className="absolute inset-x-0 bottom-0 flex w-full items-center gap-2 px-4 pb-10 pt-5">
      <button
        aria-label="Create a new task"
        className="glass-surface flex size-14 shrink-0 items-center justify-center rounded-full text-[#9aa29a] transition active:scale-95"
        type="button"
      >
        <Plus size={20} weight="bold" />
      </button>

      <div className="glass-surface flex h-14 min-w-0 flex-1 items-center gap-2 rounded-full py-1 pl-5 pr-1">
        <div className="relative flex min-w-0 flex-1 items-center justify-between overflow-hidden pr-2">
          <div className="voice-copy-fade absolute inset-y-0 left-0 flex items-center text-base text-[#a2aaa3]">
            Ask me anything...
          </div>
          <Microphone
            className="voice-copy-fade absolute right-0 text-[#9ba49c]"
            size={20}
          />

          <div className="voice-input-enter flex h-6 w-full items-center justify-between gap-3">
            <div
              aria-hidden="true"
              className="flex h-4 w-[116px] items-center gap-[2px] text-[#858a86]"
            >
              {waveformBars.map((height, index) => (
                <span
                  className="voice-wave-bar w-px rounded-full bg-current"
                  key={`${height}-${index}`}
                  style={
                    {
                      "--bar-height": `${height}px`,
                      "--bar-index": index,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <span className="shrink-0 font-sans text-base leading-6 tracking-[-0.16px] text-[#a2aaa3]">
              {statusLabel}
            </span>
          </div>
        </div>
        <button
          aria-label="Close voice mode"
          className="flex size-11 items-center justify-center rounded-full bg-white text-[#8b928c] shadow-[0_10px_24px_-18px_rgba(31,36,31,0.7)] transition active:scale-95"
          onClick={onClose}
          type="button"
        >
          <X size={18} weight="bold" />
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
    <div className="absolute inset-x-0 top-[60px] flex items-center bg-white/60 px-6 py-4 backdrop-blur-2xl">
      <button
        aria-label="Open chat"
        className="flex items-center gap-4 py-1 text-[#6d746d] transition active:scale-[0.98]"
        onClick={onMenu}
        type="button"
      >
        <List size={20} />
        <span className="text-base font-medium">{label}</span>
      </button>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex h-[60px] items-center justify-between px-12 pt-1 text-[#111611]">
      <span className="text-[17px] font-semibold leading-none">9:41</span>
      <div className="flex items-center gap-1.5">
        <div className="flex h-4 items-end gap-[2px]">
          <span className="h-1.5 w-1 rounded-full bg-[#111611]" />
          <span className="h-2.5 w-1 rounded-full bg-[#111611]" />
          <span className="h-3.5 w-1 rounded-full bg-[#111611]" />
        </div>
        <div className="h-3 w-4 rounded-full border-2 border-[#111611] border-t-transparent" />
        <div className="flex h-[13px] w-[27px] items-center rounded-[4px] border border-[#111611] p-[2px]">
          <div className="h-full w-4 rounded-[2px] bg-[#111611]" />
        </div>
      </div>
    </div>
  );
}
