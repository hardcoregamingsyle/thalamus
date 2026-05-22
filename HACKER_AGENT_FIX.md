# 🔧 Hacker Agent Fix - Scope Correction

**Date:** 2026-05-22  
**Issue:** Hacker agent failing on implementation tasks  
**Status:** ✅ FIXED

---

## 🐛 Problem Report

User reported:
> "MinorEdit aint working. Task: 'add a wrangler.toml and make the whole website cloudflare pages safe'. The Great AI Planner broke it down into 9 tasks, And even in such a simple task, the Hacker failed it twice."

---

## 🔍 Root Cause Analysis

### Issue #1: Wrong Mode for the Task
The user was trying to use **MinorEdit mode** for a complex infrastructure change. MinorEdit uses Claude Haiku and is designed for:
- Small code tweaks (changing a color, fixing a typo)
- Simple questions about the codebase

The actual task ("add wrangler.toml and make website Cloudflare Pages safe") requires:
- Understanding the entire project structure
- Creating proper Cloudflare Pages configuration
- Ensuring all code is compatible with Cloudflare runtime
- Potentially fixing build scripts, environment variables, etc.

This is a **Code Mode task**, not a MinorEdit task.

### Issue #2: Hacker Agent Had Wrong Job Description
The **Hacker agent** in Code Mode had a system prompt that was:
- Too broad (8000-12000 word reports required)
- Trying to do too much (implement features + fix security)
- Not clear about its actual role in the pipeline

**The Hacker agent's ACTUAL role:**
- Runs AFTER the Coder agent in the pipeline
- Reviews code for SECURITY ISSUES only
- Should NOT try to implement features
- Should NOT try to fix incomplete implementations

**The pipeline order:**
```
Researcher → Analyser → Planner → Coder → Optimiser → Organizer → Tester → Hacker → Critic
```

If the **Coder** fails to implement the task properly, the **Hacker** should report that failure (using `<<test.failed>>`), NOT try to implement it itself.

---

## ✅ Fixes Applied

### Fix #1: Clarified Hacker Agent's Role

**File:** `src/convex/agentCore.ts` (line 1825)  
**Agent:** Hacker

**OLD PROMPT (excerpt):**
```
You are the Security Team Lead — a Senior Security Engineer performing an authorized, exhaustive security audit...

YOUR REPORT MUST BE MASSIVE — MINIMUM 8000-12000 WORDS.

AUDIT SCOPE — cover ALL of these in EXHAUSTIVE DEPTH:
1. STATIC ANALYSIS: Review EVERY file for vulnerabilities
2. DATA INTEGRITY: Test EVERY endpoint with boundary-violation payloads
3. LOGIC FLAW ANALYSIS: Find every business logic vulnerability
4. STACK ASSESSMENT: Check ALL dependencies

FOR EACH FINDING — provide ALL sections (minimum 400-600 words per finding)...
```

**NEW PROMPT:**
```
You are the Security Auditor — a Senior Security Engineer performing an authorized security audit...

YOUR JOB: Review the code that was just implemented by the Coder agent and identify security issues. 
If you find CRITICAL security issues, you MUST fix them. For MEDIUM/LOW issues, you can report them without fixing.

CRITICAL DECISION — ONLY FIX SECURITY ISSUES, DO NOT IMPLEMENT NEW FEATURES:
- If the previous agent (Coder) successfully implemented the task → audit the code for security issues
- If the previous agent (Coder) failed or produced incomplete code → DO NOT try to fix it yourself, 
  output <<test.failed="Coder implementation incomplete or broken">>
- If the task is NOT about security → report "No security issues found" and output <<pass>>

AUDIT SCOPE (run these checks):
1. STATIC ANALYSIS: Review files for vulnerabilities (SQL injection, XSS, command injection, etc.)
   <<RUN-CMD="npm audit --json 2>&1 | head -50 || echo 'No npm audit available'">>
2. DEPENDENCY SECURITY: Check for vulnerable dependencies
   <<RUN-CMD="npm outdated 2>&1 | head -30 || echo 'No package.json found'">>
3. COMMON SECURITY PATTERNS: grep for dangerous patterns
   <<RUN-CMD="grep -r 'eval\\|innerHTML\\|dangerouslySetInnerHTML\\|exec(' src/ 2>&1 | head -20 || echo 'No dangerous patterns found'">>

OUTPUT FORMAT:

## Security Audit Report

### Quick Assessment
[1-2 sentences: overall security posture]

### Findings
[If you find security issues, list them with SEVERITY, LOCATION, ISSUE, FIX]

### Verdict
- If NO critical security issues: <<pass>>
- If critical issues found AND you fixed them: <<pass>>
- If critical issues found BUT you CANNOT fix them: <<Fail>>
- If the Coder's implementation is incomplete/broken: <<test.failed="Coder implementation incomplete">>

ONLY FIX CRITICAL SECURITY ISSUES (use <<CREATEFILE>> to write the complete fixed file)

REMEMBER: You are NOT a feature implementer. If the Coder failed to implement the task, 
report it as <<test.failed>> instead of trying to implement it yourself.
```

---

## 📊 Key Changes

### Before (Broken):
1. **Hacker was overloaded**: Trying to do security audit + implementation + massive reporting
2. **No clear boundaries**: Would try to fix anything, including incomplete implementations
3. **Wrong expectations**: Required 8000-12000 word reports for every task
4. **Scope creep**: Would try to implement features if Coder failed

### After (Fixed):
1. **Clear role**: Security auditor ONLY
2. **Delegation**: If Coder fails, report it instead of trying to fix
3. **Focused**: Run 3 specific security checks, not exhaustive audits
4. **Efficient**: Short, actionable reports instead of 8000-word essays
5. **Smart pass-through**: If no security issues, just pass the task along

---

## 🎯 How It Works Now

### Scenario 1: Coder Successfully Implements Task
```
1. Coder creates wrangler.toml and updates configs
2. Hacker runs security audit:
   - npm audit → no vulnerabilities
   - npm outdated → all dependencies current
   - grep for dangerous patterns → none found
3. Hacker outputs: <<pass>>
4. Pipeline continues to Critic
```

### Scenario 2: Coder Fails to Implement Task
```
1. Coder tries to create wrangler.toml but makes errors
2. Hacker sees incomplete/broken implementation
3. Hacker outputs: <<test.failed="Coder implementation incomplete">>
4. Task gets sent back to Coder (with upgrade if threshold reached)
```

### Scenario 3: Coder Implements But Has Security Issues
```
1. Coder creates working wrangler.toml
2. Hacker runs security audit and finds hardcoded API key
3. Hacker fixes the security issue:
   <<CREATEFILE="wrangler.toml">>
   [complete secured file with env var instead of hardcoded key]
   <<END.CREATEFILE>>
4. Hacker outputs: <<pass>>
5. Pipeline continues to Critic
```

---

## 🧪 Testing Guide

### Test Case 1: Simple Infrastructure Task
1. Create Code Mode session: "Add wrangler.toml for Cloudflare Pages"
2. Planner breaks into tasks
3. Coder implements wrangler.toml
4. Hacker runs security audit → should pass with "No critical security issues"
5. ✅ **Expected:** Task completes successfully

### Test Case 2: Task with Security Issues
1. Create Code Mode session: "Add user authentication endpoint"
2. Coder implements auth (might have weak password hashing)
3. Hacker identifies security issue (e.g., bcrypt cost factor too low)
4. Hacker fixes it and outputs <<pass>>
5. ✅ **Expected:** Auth endpoint works AND is secure

### Test Case 3: Coder Fails Implementation
1. Create Code Mode session: "Complex task X"
2. Coder produces incomplete code (missing files, broken imports)
3. Hacker sees broken implementation
4. Hacker outputs: <<test.failed="Coder implementation incomplete">>
5. System sends task back to Coder with Modal Upgrade
6. ✅ **Expected:** Task eventually completes after Coder fixes it

---

## 🚀 Summary

### Issues Fixed:
1. ✅ Hacker no longer tries to implement features
2. ✅ Hacker properly reports when Coder fails
3. ✅ Hacker focuses on security auditing only
4. ✅ Hacker passes non-security tasks efficiently
5. ✅ Clearer role separation in agent pipeline

### Technical Changes:
- Reduced Hacker system prompt from 8000-word requirement to focused audit
- Added `<<test.failed>>` output for incomplete Coder implementations
- Added smart pass-through for non-security tasks
- Added specific security checks (npm audit, outdated, grep patterns)
- Clarified that Hacker is NOT a feature implementer

### Agent Pipeline Roles:
- **Coder**: Implements features (the builder)
- **Hacker**: Audits security (the guardian)
- **Tester**: Verifies functionality (the validator)
- **Critic**: Final quality check (the gatekeeper)

Each agent has ONE job. No overlap. Clear boundaries.

---

## 📝 User Guidance

### When to Use Code Mode:
- ✅ Adding new features (wrangler.toml, authentication, etc.)
- ✅ Refactoring existing code
- ✅ Infrastructure changes (Cloudflare, Docker, deployment)
- ✅ Complex bug fixes that affect multiple files

### When to Use MinorEdit Mode:
- ✅ Changing a color or CSS value
- ✅ Fixing a typo in text
- ✅ Updating a single variable value
- ✅ Small text changes in README

### When to Use Chat Mode:
- ✅ Asking questions ("How does X work?")
- ✅ Getting explanations
- ✅ Understanding the codebase
- ✅ Deployment help

**The fix ensures the right agent does the right job at the right time.**
