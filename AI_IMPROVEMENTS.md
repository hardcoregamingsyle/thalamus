# AI Code Generation Improvements

## Problem: Sandbox Hallucinations

The previous system had major issues:

### Issues with Daytona Sandbox:
- **Timeouts**: Commands would hang or timeout (635 seconds)
- **Unreliable**: Sometimes worked, sometimes didn't
- **Hallucinations**: AI would make up command results when execution failed
- **Serverless incompatibility**: Convex can't run long-running commands
- **False confidence**: AI thought code was tested when it wasn't

### Result:
- AI generated broken code thinking it worked
- Spent more time debugging than building
- Users had to manually fix what AI claimed was "tested"

---

## Solution: Focus on What Works

### Removed:
- ❌ All `<<RUN-CMD>>` execution (19+ occurrences)
- ❌ Sandbox command instructions
- ❌ Fake testing prompts
- ❌ Complex deployment instructions

### Improved:
- ✅ **File operations only** - AI focuses on creating/editing files
- ✅ **Cleaner prompts** - Less confusion, more structured
- ✅ **No false testing** - AI doesn't claim code is tested when it isn't
- ✅ **User handles deployment** - Explicit separation of concerns

---

## What Changed in Prompts

### Before:
```
DAYTONA PORT RULES (CRITICAL — BREAKING THESE KILLS THE PREVIEW):
1. Node.js: app.listen(3000, '0.0.0.0')
2. Vite/React: vite --port 3000 --host 0.0.0.0
...
<<RUN-CMD="npm install 2>&1 | tail -5">>
<<RUN-CMD="npm run build 2>&1 | tail -20">>
```

### After:
```
DEPLOYMENT:
- Code will be deployed to a web environment
- Port 3000, host 0.0.0.0
- Use SQLite for databases (no external setup)

**IMPORTANT**: Do NOT use sandbox commands.
Focus ONLY on creating/editing files.
The user will handle deployment.
```

---

## Benefits

### For AI:
- **Less confusion** - Clear boundaries on what it can/can't do
- **No hallucinations** - Can't make up test results
- **Better code** - Focuses on correctness, not fake testing

### For Users:
- **Faster iterations** - No waiting for timeouts
- **Honest results** - AI says "user needs to test" instead of lying
- **Better code quality** - AI writes complete files instead of half-tested garbage

---

## File Operations Still Work

The AI can still:
- ✅ Create files (`<<CREATEFILE>>`)
- ✅ Edit files (`<<EDITFILE>>`)
- ✅ Request API keys (`<<GET-INFO>>`)
- ✅ Provide deployment instructions (`<<INSTRUCTIONS>>`)
- ✅ Set deploy commands (`<<DEPLOY-COMMANDS>>`)

But it **cannot** and **will not**:
- ❌ Execute bash commands
- ❌ Test the code
- ❌ Install packages
- ❌ Run the application

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

**Before**: AI hallucinates test results from broken sandbox
**After**: AI writes complete code, user handles deployment

This is a **massive improvement** in reliability and code quality.
