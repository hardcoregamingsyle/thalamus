import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import {
  Cpu, Zap, Brain, Code2, Shield, Trophy, ChevronRight, ExternalLink,
  Users, Star, Rocket, Globe, Terminal, Activity, Award, Target,
} from "lucide-react";

// ── AMD Hackathon Data ─────────────────────────────────────────────────────────
const TRACKS = [
  {
    icon: Brain,
    emoji: "🤖",
    title: "AI Agents & Agentic Workflows",
    badge: "BEST FOR BEGINNERS",
    badgeColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    desc: "Build intelligent AI systems that automate workflows, coordinate agents, or assist users in complex tasks.",
    tech: ["LangChain", "CrewAI", "AutoGen", "Llama", "DeepSeek"],
    prize: "$5,000",
    color: "border-primary/40 hover:border-primary",
    glow: "hover:shadow-[0_0_30px_oklch(0.60_0.22_25/0.2)]",
  },
  {
    icon: Cpu,
    emoji: "⚡",
    title: "Fine-Tuning on AMD GPUs",
    badge: "ADVANCED / GPU-INTENSIVE",
    badgeColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    desc: "Leverage AMD Instinct MI300X GPUs to fine-tune open-source models for domain specialization.",
    tech: ["ROCm", "PyTorch", "Hugging Face", "vLLM", "MI300X"],
    prize: "$5,000",
    color: "border-accent/40 hover:border-accent",
    glow: "hover:shadow-[0_0_30px_oklch(0.70_0.18_50/0.2)]",
  },
  {
    icon: Globe,
    emoji: "🎨",
    title: "Vision & Multimodal AI",
    badge: "MULTIMODAL",
    badgeColor: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    desc: "Build applications that process images, video, and audio using AMD GPU memory bandwidth.",
    tech: ["Llama 3.2 Vision", "Qwen-VL", "ROCm", "MI300X"],
    prize: "$5,000",
    color: "border-violet-500/40 hover:border-violet-500",
    glow: "hover:shadow-[0_0_30px_rgba(139,92,246,0.2)]",
  },
];

const PRIZES = [
  { place: "🏆 Grand Prize", amount: "$5,000", desc: "Overall top project" },
  { place: "🥇 Track 1st", amount: "$2,500", desc: "Per track winner" },
  { place: "🥈 Track 2nd", amount: "$1,500", desc: "Per track runner-up" },
  { place: "🥉 Track 3rd", amount: "$1,000", desc: "Per track 3rd place" },
];

const TECH_STACK = [
  { name: "AMD Instinct MI300X", desc: "World's most powerful AI GPU", icon: Cpu },
  { name: "ROCm Platform", desc: "Open-source GPU computing", icon: Code2 },
  { name: "Hugging Face Hub", desc: "2M+ models & datasets", icon: Brain },
  { name: "AMD Developer Cloud", desc: "$100 credits for members", icon: Globe },
  { name: "PyTorch + ROCm", desc: "Full ML framework support", icon: Zap },
  { name: "vLLM Serving", desc: "High-throughput inference", icon: Activity },
];

const JUDGES = [
  { name: "Sanem Avcil", role: "AI & Blockchain Advisor", company: "Kaisvault", img: "https://cdn.builder.io/api/v1/image/assets%2F972274c44a2d4c658b0fa440848d24a1%2F65da17e9ad4b415da2e398b2efa2002d" },
  { name: "Rahul Gupta", role: "Head of AI Foundry", company: "Evergreen", img: "https://cdn.builder.io/api/v1/image/assets%2F972274c44a2d4c658b0fa440848d24a1%2Fb3c2d7b34eac49b5a2a0f563fdd91b69" },
  { name: "Vishal Paul", role: "Senior Software Engineer", company: "PayPal", img: "https://cdn.builder.io/api/v1/image/assets%2F972274c44a2d4c658b0fa440848d24a1%2Fff0c43e7c97847f8be0f2f439fecd290" },
  { name: "Pawel Czech", role: "CEO", company: "NativelyAI", img: "https://cdn.builder.io/api/v1/image/assets%2F972274c44a2d4c658b0fa440848d24a1%2F3debee6a46d44a2da556a6564c7bd7bd" },
];

// ── Animated counter ───────────────────────────────────────────────────────────
function Counter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const step = target / 60;
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + step, target);
      setCount(Math.floor(current));
      if (current >= target) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target]);
  return <span>{count.toLocaleString()}{suffix}</span>;
}

// ── Particle background ────────────────────────────────────────────────────────
function ParticleField() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 20 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-px h-px rounded-full bg-primary/40"
          style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%` }}
          animate={{
            y: [0, -30, 0],
            opacity: [0, 0.6, 0],
            scale: [0, 2, 0],
          }}
          transition={{
            duration: 3 + Math.random() * 4,
            delay: Math.random() * 5,
            repeat: Infinity,
            repeatDelay: Math.random() * 3,
          }}
        />
      ))}
    </div>
  );
}

// ── Main Landing ───────────────────────────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  const handleLaunch = () => {
    navigate(isAuthenticated ? "/portal" : "/auth");
  };

  return (
    <div className="min-h-screen bg-background font-mono overflow-x-hidden">
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Cpu className="h-4 w-4 text-primary" />
            </div>
            <div>
              <span className="text-primary font-bold text-sm tracking-widest amd-glow">AGENT_AI</span>
              <span className="text-[10px] text-muted-foreground ml-2">× AMD Developer Hackathon</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://lablab.ai/ai-hackathons/amd-developer"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              lablab.ai
            </a>
            <button
              onClick={handleLaunch}
              className="flex items-center gap-2 text-xs border border-primary text-primary px-4 py-1.5 rounded-lg hover:bg-primary hover:text-primary-foreground transition-all font-bold amd-glow"
            >
              {isLoading ? "..." : isAuthenticated ? "OPEN PORTAL" : "GET STARTED"}
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center pt-14 overflow-hidden">
        <ParticleField />

        {/* Background grid */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "linear-gradient(oklch(0.60 0.22 25) 1px, transparent 1px), linear-gradient(90deg, oklch(0.60 0.22 25) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />

        {/* AMD red gradient orb */}
        <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center gap-2 border border-primary/30 bg-primary/10 text-primary text-[11px] font-bold px-3 py-1.5 rounded-full mb-6"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              AMD DEVELOPER HACKATHON 2025
              <span className="text-muted-foreground">• $21,500+ PRIZES</span>
            </motion.div>

            <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
              <span className="text-foreground">Build the</span>
              <br />
              <span className="text-primary amd-glow">Next-Gen</span>
              <br />
              <span className="text-foreground">AI Agents</span>
            </h1>

            <p className="text-muted-foreground text-sm leading-relaxed mb-4 max-w-lg">
              Powered by <span className="text-accent font-bold">AMD Instinct MI300X GPUs</span> and ROCm. 
              Fine-tune Llama 3 8B, build agentic workflows, and ship production-ready AI — all in the cloud.
            </p>

            <p className="text-muted-foreground text-xs leading-relaxed mb-8 max-w-lg">
              Track 2: Fine-Tuning on AMD GPUs — We're fine-tuning a <span className="text-primary font-bold">Llama 3 8B model</span> with custom API endpoints, 
              domain-specific training, and production deployment on AMD hardware.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <motion.button
                onClick={handleLaunch}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
              >
                <Rocket className="h-4 w-4" />
                LAUNCH AGENT PORTAL
                <ChevronRight className="h-4 w-4" />
              </motion.button>
              <motion.a
                href="https://lablab.ai/ai-hackathons/amd-developer"
                target="_blank"
                rel="noopener noreferrer"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="flex items-center justify-center gap-2 px-6 py-3.5 border border-border text-muted-foreground text-sm rounded-xl hover:border-primary hover:text-primary transition-all"
              >
                <ExternalLink className="h-4 w-4" />
                VIEW HACKATHON
              </motion.a>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-6 text-xs">
              <div>
                <div className="text-primary font-bold text-lg amd-glow"><Counter target={7336} /></div>
                <div className="text-muted-foreground">Participants</div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <div className="text-accent font-bold text-lg amd-glow-orange">$21,500+</div>
                <div className="text-muted-foreground">Prize Pool</div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <div className="text-primary font-bold text-lg amd-glow">3</div>
                <div className="text-muted-foreground">Tracks</div>
              </div>
            </div>
          </motion.div>

          {/* Right: Agent pipeline visualization */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative"
          >
            <div className="border border-border bg-card rounded-2xl p-6 shadow-2xl">
              {/* Terminal header */}
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-border">
                <div className="w-3 h-3 rounded-full bg-destructive" />
                <div className="w-3 h-3 rounded-full bg-accent" />
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
                <span className="text-xs text-muted-foreground ml-2">agent_team — AMD MI300X</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-emerald-400">RUNNING</span>
                </div>
              </div>

              {/* Agent pipeline */}
              <div className="space-y-2.5">
                {[
                  { name: "Researcher", color: "text-cyan-400", bg: "bg-cyan-400/10 border-cyan-400/30", status: "✓ DONE", active: false },
                  { name: "Analyser", color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/30", status: "✓ DONE", active: false },
                  { name: "Planner", color: "text-violet-400", bg: "bg-violet-400/10 border-violet-400/30", status: "✓ DONE", active: false },
                  { name: "Coder", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30", status: "RUNNING...", active: true },
                  { name: "Optimiser", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/30", status: "QUEUED", active: false },
                  { name: "Organizer", color: "text-orange-400", bg: "bg-orange-400/10 border-orange-400/30", status: "QUEUED", active: false },
                  { name: "Tester", color: "text-green-400", bg: "bg-green-400/10 border-green-400/30", status: "QUEUED", active: false },
                  { name: "Hacker", color: "text-red-400", bg: "bg-red-400/10 border-red-400/30", status: "QUEUED", active: false },
                  { name: "Critic", color: "text-purple-400", bg: "bg-purple-400/10 border-purple-400/30", status: "QUEUED", active: false },
                ].map((agent, i) => (
                  <motion.div
                    key={agent.name}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + i * 0.06 }}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${agent.bg} ${agent.active ? "neon-pulse" : ""}`}
                  >
                    <div className={`w-6 h-6 rounded-md border ${agent.bg} flex items-center justify-center text-[10px] font-bold ${agent.color}`}>
                      {agent.name[0]}
                    </div>
                    <span className={`text-xs font-bold ${agent.color}`}>{agent.name}</span>
                    <span className={`ml-auto text-[10px] ${agent.active ? "text-emerald-400 animate-pulse" : agent.status.includes("✓") ? "text-emerald-400/60" : "text-muted-foreground"}`}>
                      {agent.status}
                    </span>
                  </motion.div>
                ))}
              </div>

              {/* Bottom stats */}
              <div className="mt-4 pt-4 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Task 3/12 • PLANNING PHASE</span>
                <span className="text-primary">gemini-3.1-flash-lite</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Tracks ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">HACKATHON TRACKS</p>
            <h2 className="text-3xl font-bold text-foreground mb-3">
              Choose Your <span className="text-primary amd-glow">Challenge</span>
            </h2>
            <p className="text-sm text-muted-foreground max-w-xl mx-auto">
              Three tracks, each powered by AMD's cloud infrastructure. No hardware required — just build.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {TRACKS.map((track, i) => (
              <motion.div
                key={track.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`border ${track.color} ${track.glow} bg-card rounded-2xl p-6 transition-all duration-300 cursor-pointer group`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="text-3xl">{track.emoji}</div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${track.badgeColor}`}>
                    {track.badge}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-foreground mb-2">{track.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-4">{track.desc}</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {track.tech.map(t => (
                    <span key={t} className="text-[10px] bg-muted border border-border px-2 py-0.5 rounded text-muted-foreground">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">Prize Pool</span>
                  <span className="text-sm font-bold text-primary amd-glow">{track.prize}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Our Submission ───────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20 bg-card/30">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">OUR SUBMISSION</p>
            <h2 className="text-3xl font-bold text-foreground mb-3">
              AgentAI — <span className="text-primary amd-glow">Level 4.5 Agent System</span>
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
              A multi-agent orchestration platform powered by fine-tuned Llama 3 8B on AMD MI300X GPUs. 
              9 specialized agents working in concert to build, test, and deploy production software.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Brain,
                title: "Fine-Tuned Llama 3 8B",
                desc: "Custom fine-tuned on AMD MI300X GPUs using ROCm + PyTorch. Domain-specific training for code generation and agentic reasoning.",
                color: "text-primary",
                border: "border-primary/30",
                bg: "bg-primary/5",
                status: "IN PROGRESS",
              },
              {
                icon: Users,
                title: "9-Agent Pipeline",
                desc: "Researcher → Analyser → Planner → Coder → Optimiser → Organizer → Tester → Hacker → Critic. Each agent specialized for its role.",
                color: "text-accent",
                border: "border-accent/30",
                bg: "bg-accent/5",
                status: "LIVE",
              },
              {
                icon: Zap,
                title: "Daytona Sandbox",
                desc: "Live code execution in isolated sandboxes. Agents write, run, test, and deploy code in real-time with full terminal access.",
                color: "text-emerald-400",
                border: "border-emerald-400/30",
                bg: "bg-emerald-400/5",
                status: "LIVE",
              },
              {
                icon: Code2,
                title: "Custom API Endpoints",
                desc: "Fine-tuned model served via vLLM on AMD hardware. Custom API compatible with OpenAI format for seamless integration.",
                color: "text-violet-400",
                border: "border-violet-400/30",
                bg: "bg-violet-400/5",
                status: "COMING SOON",
              },
              {
                icon: Shield,
                title: "GraphRAG Knowledge Base",
                desc: "Per-session knowledge grounding via ChromaDB + GraphRAG. Agents learn from project context and previous sessions.",
                color: "text-cyan-400",
                border: "border-cyan-400/30",
                bg: "bg-cyan-400/5",
                status: "LIVE",
              },
              {
                icon: Activity,
                title: "Real-Time Streaming",
                desc: "Live agent output streaming via Convex reactive queries. Watch agents think, plan, and code in real-time.",
                color: "text-amber-400",
                border: "border-amber-400/30",
                bg: "bg-amber-400/5",
                status: "LIVE",
              },
            ].map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className={`border ${item.border} ${item.bg} rounded-xl p-5 transition-all hover:scale-[1.02]`}
              >
                <div className="flex items-start justify-between mb-3">
                  <item.icon className={`h-5 w-5 ${item.color}`} />
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    item.status === "LIVE" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                    item.status === "IN PROGRESS" ? "bg-amber-500/10 text-amber-400 border-amber-500/30" :
                    "bg-muted text-muted-foreground border-border"
                  }`}>
                    {item.status}
                  </span>
                </div>
                <h3 className={`text-sm font-bold ${item.color} mb-2`}>{item.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Tech Stack ──────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">POWERED BY</p>
            <h2 className="text-3xl font-bold text-foreground mb-3">
              AMD's <span className="text-accent amd-glow-orange">Full Stack</span>
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TECH_STACK.map((tech, i) => (
              <motion.div
                key={tech.name}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center gap-4 p-4 border border-border bg-card rounded-xl hover:border-primary/40 transition-all"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <tech.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">{tech.name}</p>
                  <p className="text-[11px] text-muted-foreground">{tech.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Prizes ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20 bg-card/30">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">PRIZE POOL</p>
            <h2 className="text-3xl font-bold text-foreground mb-3">
              <span className="text-primary amd-glow">$21,500+</span> in Prizes
            </h2>
            <p className="text-sm text-muted-foreground">Plus AMD Radeon AI PRO R9700 GPU hardware reward</p>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {PRIZES.map((prize, i) => (
              <motion.div
                key={prize.place}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="border border-border bg-card rounded-xl p-5 text-center hover:border-primary/40 transition-all"
              >
                <div className="text-2xl mb-2">{prize.place.split(" ")[0]}</div>
                <div className="text-xl font-bold text-primary amd-glow mb-1">{prize.amount}</div>
                <div className="text-xs text-muted-foreground">{prize.place.split(" ").slice(1).join(" ")}</div>
                <div className="text-[10px] text-muted-foreground/60 mt-1">{prize.desc}</div>
              </motion.div>
            ))}
          </div>

          {/* Hardware prize */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="border border-accent/30 bg-accent/5 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6"
          >
            <div className="w-16 h-16 rounded-2xl bg-accent/20 border border-accent/30 flex items-center justify-center shrink-0">
              <Award className="h-8 w-8 text-accent" />
            </div>
            <div className="text-center md:text-left">
              <p className="text-xs text-accent font-bold mb-1">EXCLUSIVE HARDWARE REWARD</p>
              <h3 className="text-lg font-bold text-foreground mb-1">AMD Radeon™ AI PRO R9700 GPU</h3>
              <p className="text-xs text-muted-foreground">Awarded for outstanding social engagement or project promotion. Share your build journey on X/LinkedIn tagging @AIatAMD.</p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Judges ──────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <p className="text-xs text-muted-foreground mb-2 font-bold tracking-widest">JUDGING PANEL</p>
            <h2 className="text-3xl font-bold text-foreground mb-3">
              Meet the <span className="text-primary amd-glow">Judges</span>
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {JUDGES.map((judge, i) => (
              <motion.div
                key={judge.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="border border-border bg-card rounded-xl p-5 text-center hover:border-primary/40 transition-all group"
              >
                <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-border group-hover:border-primary/40 transition-all mx-auto mb-3">
                  <img src={judge.img} alt={judge.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(judge.name)}&background=1a1a1a&color=ed1c24&size=64`; }} />
                </div>
                <p className="text-xs font-bold text-foreground mb-0.5">{judge.name}</p>
                <p className="text-[11px] text-muted-foreground mb-1">{judge.role}</p>
                <span className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">{judge.company}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="border-t border-border py-20 bg-card/30">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="border border-primary/30 bg-primary/5 rounded-2xl p-10">
              <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-6">
                <Rocket className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-3xl font-bold text-foreground mb-3">
                Ready to <span className="text-primary amd-glow">Build?</span>
              </h2>
              <p className="text-sm text-muted-foreground mb-8 max-w-lg mx-auto">
                Launch the AgentAI portal and experience the 9-agent pipeline in action. 
                Fine-tuned Llama 3 8B integration coming soon.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <motion.button
                  onClick={handleLaunch}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center justify-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground text-sm font-bold rounded-xl hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
                >
                  <Terminal className="h-4 w-4" />
                  LAUNCH AGENT PORTAL
                  <ChevronRight className="h-4 w-4" />
                </motion.button>
                <motion.a
                  href="https://lablab.ai/ai-hackathons/amd-developer"
                  target="_blank"
                  rel="noopener noreferrer"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center justify-center gap-2 px-6 py-3.5 border border-border text-muted-foreground text-sm rounded-xl hover:border-primary hover:text-primary transition-all"
                >
                  <Star className="h-4 w-4" />
                  JOIN HACKATHON
                </motion.a>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Cpu className="h-3 w-3 text-primary" />
            </div>
            <span className="text-xs text-muted-foreground">AgentAI — AMD Developer Hackathon 2025</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <a href="https://lablab.ai/ai-hackathons/amd-developer" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              lablab.ai
            </a>
            <a href="https://www.amd.com/en/developer/ai-dev-program.html" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              AMD Developer
            </a>
            <span>Powered by <a href="https://vly.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">vly.ai</a></span>
          </div>
        </div>
      </footer>
    </div>
  );
}