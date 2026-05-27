import { Rocket, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface DeployViewProps {
  branchId: string;
}

const deployPlatforms = [
  {
    name: "Vercel",
    icon: "▲",
    description: "Deploy with zero configuration",
    url: "https://vercel.com",
  },
  {
    name: "Netlify",
    icon: "◆",
    description: "Continuous deployment from Git",
    url: "https://netlify.com",
  },
  {
    name: "Cloudflare Pages",
    icon: "☁",
    description: "Fast, global deployment",
    url: "https://pages.cloudflare.com",
  },
];

export function DeployView({ branchId }: DeployViewProps) {
  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Rocket className="h-6 w-6" />
          Deployment
        </h2>
        <p className="text-muted-foreground mt-1">
          Deploy your application to production
        </p>
      </div>

      <div className="grid gap-4">
        {deployPlatforms.map((platform) => (
          <Card key={platform.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-xl">
                    {platform.icon}
                  </div>
                  <div>
                    <CardTitle className="text-lg">{platform.name}</CardTitle>
                    <CardDescription>{platform.description}</CardDescription>
                  </div>
                </div>
                <Badge variant="outline">Coming Soon</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Button className="w-full gap-2" variant="outline" disabled>
                <ExternalLink className="h-4 w-4" />
                Deploy to {platform.name}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Deployment Guide</CardTitle>
          <CardDescription>
            AI will prepare your codebase for deployment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The AI team will analyze your project and create platform-specific configuration
            files (vercel.json, netlify.toml, etc.) to ensure smooth deployment.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
