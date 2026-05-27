import { Database, Activity, Code2, GitBranch as GitIcon, Rocket, Monitor, Key } from "lucide-react";

export const sidebarItems = [
  { title: "Backend", items: [
    { label: "Data", icon: Database, path: "data" },
    { label: "Logs", icon: Activity, path: "logs" },
    { label: "Usage", icon: Activity, path: "data-usage" },
  ]},
  { title: "Workspace", items: [
    { label: "Editor", icon: Code2, path: "code-ide" },
    { label: "Version", icon: GitIcon, path: "version-control" },
    { label: "Git-Sync", icon: GitIcon, path: "github" },
    { label: "Deploy", icon: Rocket, path: "deploy" },
    { label: "Sandbox", icon: Monitor, path: "sandbox" },
    { label: "Keys", icon: Key, path: "keys" },
  ]},
];
