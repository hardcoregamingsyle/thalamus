<div align="center">

<img src="public/assets/Untitled_design.png" alt="Thalamus AI" width="120" />

# THALAMUS AI
### World's First L4.5 Agent Platform

**By Aphantic Corporations**

*The most powerful all-purpose AI platform ever built — combining intelligent conversation, deep research, adaptive learning, autonomous code generation, and full OS virtualization in one unified experience.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://reactjs.org/)
[![Convex](https://img.shields.io/badge/Convex-Backend-f97316?style=flat-square)](https://convex.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](./LICENSE)

</div>

---

## 📖 Table of Contents

1. [What is Thalamus?](#-what-is-thalamus)
2. [The Four Modes](#-the-four-modes)
3. [The AI Agent System (Code Mode)](#-the-ai-agent-system-code-mode)
4. [The Sandbox & OS Emulator](#-the-sandbox--os-emulator)
5. [The VM Bridge](#-the-vm-bridge)
6. [The Installer](#-the-installer)
7. [The Desktop App](#-the-desktop-app)
8. [Supported Operating Systems](#-supported-operating-systems)
9. [GitHub Sync](#-github-sync)
10. [Authentication & Users](#-authentication--users)
11. [Credits & Billing](#-credits--billing)
12. [Admin Panel](#-admin-panel)
13. [Tech Stack](#-tech-stack)
14. [Project Structure](#-project-structure)
15. [Getting Started (Developers)](#-getting-started-developers)
16. [Environment Variables](#-environment-variables)
17. [Deployment](#-deployment)
18. [Frequently Asked Questions](#-frequently-asked-questions)

---

## 🧠 What is Thalamus?

Thalamus is a **Level 4.5 AI Agent Platform** — a term coined by Aphantic Corporations to describe an AI system that goes beyond simple question-answering. It can:

- **Understand** what you need, even if you don't know how to ask it
- **Research** topics in real time using live web data
- **Teach** you anything, from school subjects to advanced university topics
- **Build** complete software applications, websites, and tools from a plain English description
- **Run** actual operating systems (Windows, macOS, Linux, Android) inside your browser session

Think of it as having a brilliant friend who is simultaneously a doctor, lawyer, engineer, teacher, researcher, and software developer — available 24/7, never tired, never impatient.

### Who is it for?

| Person | How Thalamus Helps |
|--------|-------------------|
| **Students** | Explains lessons, creates practice questions, summarizes textbooks |
| **Professionals** | Drafts emails, reports, presentations, and research summaries |
| **Developers** | Writes, reviews, debugs, and deploys full applications |
| **Entrepreneurs** | Researches markets, writes business plans, builds MVPs |
| **Curious people** | Answers any question with depth, clarity, and accuracy |
| **Non-technical users** | Runs real operating systems without any technical knowledge |

---

## 🎯 The Four Modes

Thalamus has four distinct operating modes, each optimized for a different type of task. You can switch between them at any time from the portal.

---

### 💬 Chat Mode

**What it is:** A conversational AI that understands context, nuance, and intent.

**What you can do:**
- Ask any question and get a clear, accurate answer
- Have multi-turn conversations where the AI remembers what you said earlier
- Get help with writing — emails, essays, cover letters, social media posts
- Plan your day, week, or year
- Get advice on decisions, relationships, health, finance, and more
- Translate between languages
- Summarize long documents or articles

**How it works:**
- Powered by Claude (Anthropic via AWS Bedrock) and Gemini (Google) models
- Uses the most capable model available for your subscription tier
- Maintains full conversation history within a session
- Supports file uploads — paste text, upload documents, share images

**Example prompts:**
- "Explain quantum computing like I'm 10 years old"
- "Write a professional email declining a job offer politely"
- "What are the pros and cons of moving to Canada?"
- "Help me plan a 7-day trip to Japan on a $2000 budget"

---

### 🔍 Research Mode

**What it is:** A deep research assistant that searches the web, synthesizes information, and gives you structured, accurate summaries.

**What you can do:**
- Get up-to-date information on any topic (not limited to training data)
- Compare products, services, companies, or ideas
- Understand complex topics quickly with clear explanations
- Get summaries of news, scientific papers, or market trends
- Research competitors, industries, or technologies

**How it works:**
- Uses web search to find current information
- Synthesizes multiple sources into a single coherent answer
- Cites sources so you can verify the information
- Uses Gemini and Claude models for analysis

**Example prompts:**
- "What are the latest developments in fusion energy as of 2025?"
- "Compare the top 5 electric vehicles under $40,000"
- "Summarize the current state of the AI industry"
- "What does the science say about intermittent fasting?"

---

### 📚 Study Mode

**What it is:** A patient, adaptive tutor that explains anything at your level and helps you prepare for exams.

**What you can do:**
- Upload your notes, textbooks, or study materials
- Get explanations tailored to your level (beginner, intermediate, advanced)
- Generate practice questions and quizzes
- Get step-by-step solutions to problems
- Create flashcards and revision summaries
- Ask follow-up questions until you truly understand

**How it works:**
- Analyzes your uploaded materials using RAG (Retrieval-Augmented Generation)
- Stores your study profile (subjects, level, goals)
- Generates questions based on your materials
- Tracks what you've studied in your session

**Example prompts:**
- "I have an exam on thermodynamics tomorrow. Quiz me on the key concepts."
- "Explain the French Revolution like I'm a high school student"
- "Here are my chemistry notes [upload]. Create 20 practice questions."
- "Walk me through solving this integral step by step: ∫x²sin(x)dx"

---

### 🛠️ Build Mode (Code Mode)

**What it is:** A fully autonomous software development system powered by 9 specialized AI agents working in sequence.

**What you can do:**
- Describe any software project in plain English
- Get a complete, working application built automatically
- Build websites, APIs, mobile apps, scripts, tools, and more
- Debug existing code by pasting it in
- Add features to existing projects
- Get security audits of your code

**How it works — The 9-Agent Pipeline:**

1. **Project Understanding Agent** - Takes your plain English description and creates a detailed technical specification
2. **Architecture Design Agent** - Designs the system architecture, database schema, and technology stack
3. **Component Specification Agent** - Breaks down the application into modular components with detailed requirements
4. **API Design Agent** - Creates comprehensive API specifications and documentation
5. **Frontend Development Agent** - Builds responsive, accessible user interfaces
6. **Backend Development Agent** - Implements server-side logic, databases, and authentication
7. **Integration Agent** - Connects all components and ensures seamless communication
8. **Testing Agent** - Creates comprehensive test suites and performs automated testing
9. **Deployment Agent** - Packages and deploys the complete application to your environment

**Example prompts:**
- "Build a full-stack e-commerce platform with user authentication, product catalog, shopping cart, and payment processing"
- "Create a weather application that shows current conditions, forecasts, and radar maps"
- "Develop a personal finance manager with budget tracking, expense categorization, and financial goal setting"
- "Build a mobile app for a local restaurant that allows customers to order food and track delivery status"

**Key Features:**
- Fully autonomous development from concept to deployment
- No need to write code or understand technical details
- Complete applications with working APIs and databases
- Built-in security features and error handling
- Continuous integration and testing
- Version control and deployment history

**Note:** The Build Mode is the most powerful feature of Thalamus, allowing you to create complex software applications without writing a single line of code. Simply describe your vision in plain English, and Thalamus will handle the entire development process.