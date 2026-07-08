Set-Location "$PSScriptRoot"

# Remove any stale git lock file
$lock = ".git\index.lock"
if (Test-Path $lock) {
    Remove-Item $lock -Force
    Write-Host "Removed $lock"
}

# Stage all changes
git add -A

# Commit
git commit -m "feat: streaming, L4.5 agent pipeline, admin model config, GravityAds, API keys, tool anti-hallucination, README v2.0.0

- Streaming: codeBranches.streamingContent field + callModelWithStreaming drip-feed
- L4.5 pipeline: Critic retry loop (2 retries), richer Coder context (file inventory,
  completed tasks, Tester/Critic feedback), original user intent always recovered
- Tool anti-hallucination: explicit 'COPY EXACTLY' syntax blocks in all agent prompts
- Admin: ModelConfigTab (per-agent per-runMode overrides), GravityAdsTab with toggles
- Backend: admin.listAgentModelConfigs, admin.saveAgentModelConfig, admin.getAgentModelConfig
- Schema: agentModelConfig, gravityAdsConfig, userApiKeys tables + streaming fields
- API page (/api-keys): SHA-256 hashed keys, one-time reveal, credit allocation/revoke
- ThinkingPanel: Gemini-style collapsible pill with animated dots
- Security: ADMIN_TOKEN server-side only, session key rotated
- README: professional rewrite reflecting v2.0.0 features and architecture"

Write-Host ""
Write-Host "Commit done. Now push with your PAT:"
Write-Host 'git push origin main'
