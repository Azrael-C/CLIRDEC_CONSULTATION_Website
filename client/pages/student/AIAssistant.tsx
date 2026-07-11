import { useState } from "react";
import AuthLayout from "@/components/AuthLayout";
import { Send } from "lucide-react";

interface Message {
  id: string;
  type: "user" | "bot";
  content: string;
}

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      type: "bot",
      content: "Hello! I'm the Consult AI assistant. How can I help you with bookings, teachers, or campus consultations?",
    },
  ]);
  const [input, setInput] = useState("");

  const suggestions = [
    "How do I book a session?",
    "Where are sessions held?",
    "Can I cancel?",
  ];

  const handleSend = () => {
    if (!input.trim()) return;

    setMessages(prev => [
      ...prev,
      { id: Date.now().toString(), type: "user", content: input },
    ]);
    setInput("");

    // Simulate bot response
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          type: "bot",
          content: "I'm here to help! You can ask me anything about the Consult platform.",
        },
      ]);
    }, 500);
  };

  return (
    <AuthLayout userRole="student" userName="Sofia Navaro">
      <div className="p-8 flex flex-col h-full max-h-[calc(100vh-200px)]">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">AI Assistant</h1>

        <div className="border border-gray-200 rounded flex flex-col flex-1">
          {/* Chat Header */}
          <div className="p-4 border-b border-gray-200 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-700 flex items-center justify-center text-white text-sm font-bold">
              C
            </div>
            <div>
              <p className="font-semibold text-gray-900">Consult AI</p>
              <p className="text-xs text-gray-600">Online</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-xs px-4 py-2 rounded ${
                    msg.type === "user"
                      ? "bg-gray-900 text-white rounded-br-none"
                      : "bg-gray-100 text-gray-900 rounded-bl-none"
                  }`}
                >
                  <p className="text-sm">{msg.content}</p>
                </div>
              </div>
            ))}

            {/* Suggestions */}
            {messages.length === 1 && (
              <div className="mt-8 space-y-2">
                {suggestions.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => setInput(suggestion)}
                    className="w-full px-4 py-2 text-left border border-gray-300 text-gray-900 rounded hover:bg-gray-50 transition-colors text-sm"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyPress={e => e.key === "Enter" && handleSend()}
                placeholder="Ask me anything..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded focus:outline-none focus:border-green-700"
              />
              <button
                onClick={handleSend}
                className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800 transition-colors"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}
