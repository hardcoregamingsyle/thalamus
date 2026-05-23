# AI Code Generation with Sandbox Testing

## How the System Works

The AI agents run in a feedback loop with a live Daytona sandbox:

### Command Execution Flow:
1. **Agent writes code** → Creates/edits files
2. **Agent tests code** → Runs `<<RUN-CMD="npm install">>`, `<<RUN-CMD="npm test">>`, etc.
3. **Sandbox executes** → Daytona runs the command
4. **Output returns** → Result comes BACK to the SAME agent
5. **Agent analyzes** → Sees success/failure
6. **Agent fixes or proceeds** → If error, fix and re-run; if success, continue
7. **Loop repeats** → Up to 10 times (MAX_CMD_LOOPS)

### Key Point: Output Goes Back to Same Agent
- Agent sees **actual command output**
- If command fails, agent **must fix the error**
- Next agent **doesn't run** until current one succeeds
- Tester agent **must mark pass/fail** based on real test results

---

## Agent Testing Requirements

### Coder Agent:
After creating files, MUST:
1. `npm install` - Install dependencies
2. `npm run build` - Check for syntax/compile errors
3. Fix any errors before proceeding

### Tester Agent:
MUST run actual tests:
1. `npm install` - Ensure dependencies
2. `npm test` - Run test suite
3. Mark `<<test.success>>` or `<<test.failed>>` based on REAL output

### Security Fixers:
After fixing vulnerabilities, MUST:
1. `npm run build` - Verify code compiles
2. Test the fix actually works

---

## What Changed in Prompts

### Now (Current System):
```
**TESTING YOUR CODE - MANDATORY**:
After creating files, you MUST test them:

1. Install dependencies:
   <<RUN-CMD="npm install">>

2. Check for syntax errors:
   <<RUN-CMD="npm run build">>

3. Run tests:
   <<RUN-CMD="npm test">>

**CRITICAL**: The command output comes back to YOU.
If you see errors, you MUST:
- Analyze the error message
- Fix the code
- Run the command again
- Repeat until it works

Do NOT move forward if commands fail.
The next agent won't run until you succeed.
```

This makes agents **responsible for their code** and forces them to **actually test it**.

---

## Benefits

### Self-Correcting Loop:
- **Agent sees errors** - Real command output, not imagination
- **Agent fixes errors** - Can't proceed until code works
- **Verified quality** - Tests actually run in sandbox
- **No false passes** - Tester must see real test output

### For Users:
- **Working code** - Actually tested before deployment
- **Fewer bugs** - Errors caught in agent loop, not production
- **Confidence** - Know the code was tested in a real environment

---

## What Agents Can Do

The AI agents have full capabilities:
- ✅ Create files (`<<CREATEFILE>>`)
- ✅ Edit files (`<<EDITFILE>>`)
- ✅ Execute commands (`<<RUN-CMD>>`)
- ✅ Install packages (`npm install`, `pip install`, etc.)
- ✅ Run tests (`npm test`, `pytest`, etc.)
- ✅ Build projects (`npm run build`, `cargo build`, etc.)
- ✅ Request API keys (`<<GET-INFO>>`)
- ✅ Provide instructions (`<<INSTRUCTIONS>>`)

### Command Loop Example:
```
Coder: Creates React app
Coder: <<RUN-CMD="npm install">>
Sandbox: ✅ Dependencies installed
Coder: <<RUN-CMD="npm run build">>
Sandbox: ❌ Error: Cannot find module 'react'
Coder: Fixes package.json
Coder: <<RUN-CMD="npm install">>
Sandbox: ✅ Success
Coder: <<RUN-CMD="npm run build">>
Sandbox: ✅ Build successful
Coder: Proceeds to next agent
```

---

## Future: Claude Code Integration

Added `src/convex/claudeCode.ts` as foundation for future work:

### What it will enable:
- **Proper tool use** via official Anthropic API
- **Agentic loop**: LLM → tool use → LLM → tool use → done
- **Structured tools**:
  - `read_file` - Read existing files
  - `write_file` - Create/overwrite files
  - `edit_file` - Surgical edits
  - `search_files` - Grep-like search
  - `list_files` - See project structure

### Why not now:
- Requires AWS Bedrock tool use support
- Need to test thoroughly before switching
- Current system works well after sandbox removal

---

## Testing the Improvements

### Try it:
1. Start a new Code Mode session
2. Ask AI to "create a React + Vite todo app"
3. Notice:
   - No command execution attempts
   - Clean file operations
   - Honest about what it can't test
   - Complete, working files

### What to expect:
- AI will create all files
- AI will NOT claim to have tested it
- AI will provide deploy instructions via `<<INSTRUCTIONS>>`
- **You** handle `npm install` and `npm run dev`

---

## Summary

The system uses a **self-correcting feedback loop**:
1. Agent writes code
2. Agent tests code in sandbox
3. Agent sees actual results
4. Agent fixes errors OR proceeds
5. Loop repeats until success

**Result**: Agents produce **tested, working code** that actually runs.

The key insight: **Output goes back to the same agent** so it can self-correct.
This eliminates hallucinations because agents see real command output.
