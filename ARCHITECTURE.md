<div align="center">

# 🏛️ AgentAI — Architecture Deep Dive

*How 9 specialized agents collaborate to build production software autonomously*

</div>

---

## 📐 System Overview

AgentAI is built on a **reactive, event-driven architecture** where every component communicates through Convex's real-time database. The system is designed around three core principles:

1. **Specialization** — Each agent has a single, well-defined responsibility
2. **Grounding** — Every agent call is enriched with RAG context before generation
3. **Verification** — Every output is validated by downstream agents before acceptance

