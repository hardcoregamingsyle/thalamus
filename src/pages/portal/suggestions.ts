// Empty-state prompt chips shown before a conversation has any messages,
// keyed by mode. Currently consumed by GuestPortal; PortalDesktop's empty
// state uses a plain "start a new session" prompt, not these chips.

export interface ModeSuggestion {
  icon: string;
  title: string;
  prompt: string;
}

export const SUGGESTIONS_BY_MODE: Record<string, ModeSuggestion[]> = {
  chat: [
    { icon: "💡", title: "Explain a concept", prompt: "Explain quantum computing in simple terms" },
    { icon: "✍️", title: "Write something", prompt: "Write a professional email declining a meeting" },
    { icon: "🔍", title: "Analyze text", prompt: "Analyze the pros and cons of remote work" },
    { icon: "🧮", title: "Solve a problem", prompt: "Help me debug this logic: if I have 3 apples and give away 2, why do I feel sad?" },
    { icon: "🌍", title: "Translate", prompt: "Translate 'Hello, how are you?' into 5 languages" },
    { icon: "📊", title: "Compare options", prompt: "Compare React vs Vue vs Angular for a new project" },
  ],
  research: [
    { icon: "🔬", title: "Deep dive topic", prompt: "Research the latest advancements in CRISPR gene editing" },
    { icon: "📈", title: "Market analysis", prompt: "Research the current state of the AI chip market" },
    { icon: "🏛️", title: "Historical research", prompt: "Research the causes and effects of the 2008 financial crisis" },
    { icon: "🧬", title: "Science topic", prompt: "Research how mRNA vaccines work and their long-term safety data" },
    { icon: "🌐", title: "Tech trends", prompt: "Research the current state of quantum computing and timeline to practical use" },
    { icon: "📚", title: "Academic topic", prompt: "Research the psychological effects of social media on teenagers" },
  ],
  study: [
    { icon: "📖", title: "Explain a topic", prompt: "Explain Newton's laws of motion with examples" },
    { icon: "🧪", title: "Science concept", prompt: "How does photosynthesis work step by step?" },
    { icon: "📐", title: "Math help", prompt: "Explain the concept of derivatives in calculus" },
    { icon: "🗺️", title: "History", prompt: "What were the main causes of World War I?" },
    { icon: "💻", title: "Programming", prompt: "Explain object-oriented programming concepts with examples" },
    { icon: "🔤", title: "Language", prompt: "Explain the difference between active and passive voice" },
  ],
  code: [
    { icon: "🌐", title: "Full-stack web app", prompt: "Build a full-stack todo app with React, Node.js, and PostgreSQL" },
    { icon: "📱", title: "Mobile-first app", prompt: "Build a responsive expense tracker with charts and local storage" },
    { icon: "🤖", title: "AI-powered app", prompt: "Build a chatbot interface with streaming responses and conversation history" },
    { icon: "🛒", title: "E-commerce", prompt: "Build a product catalog with cart, checkout, and payment integration" },
    { icon: "📊", title: "Dashboard", prompt: "Build an analytics dashboard with real-time data visualization" },
    { icon: "🔐", title: "Auth system", prompt: "Build a secure authentication system with JWT, refresh tokens, and 2FA" },
  ],
};
