import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Rocket, ExternalLink, Loader2, Check, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

interface DeployViewProps {
  projectId: string;
  branchId: string;
}

const deployPlatforms = [
  {
    id: "vercel" as const,
    name: "Vercel",
    icon: "▲",
    description: "Deploy with zero configuration",
    url: "https://vercel.com",
    tokenUrl: "https://vercel.com/account/tokens",
    color: "from-black to-gray-800",
  },
  {
    id: "netlify" as const,
    name: "Netlify",
    icon: "◆",
    description: "Continuous deployment from Git",
    url: "https://netlify.com",
    tokenUrl: "https://app.netlify.com/user/applications#personal-access-tokens",
    color: "from-teal-600 to-cyan-600",
  },
  {
    id: "cloudflare" as const,
    name: "Cloudflare Pages",
    icon: "☁",
    description: "Fast, global deployment",
    url: "https://pages.cloudflare.com",
    tokenUrl: "https://dash.cloudflare.com/profile/api-tokens",
    color: "from-orange-600 to-yellow-600",
  },
];

export function DeployView({ projectId, branchId }: DeployViewProps) {
  const token = localStorage.getItem("agentai_session_token") || "";
  const [selectedPlatform, setSelectedPlatform] = useState<typeof deployPlatforms[number] | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [projectName, setProjectName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);
  const [isGeneratingConfig, setIsGeneratingConfig] = useState<string | null>(null);

  const deployToVercel = useAction(api.deployments.deployToVercel);
  const deployToNetlify = useAction(api.deployments.deployToNetlify);
  const deployToCloudflare = useAction(api.deployments.deployToCloudflare);
  const generateConfig = useAction(api.deployments.generateDeployConfig);

  const handleDeploy = async () => {
    if (!selectedPlatform || !apiToken.trim()) {
      toast.error("Please provide API token");
      return;
    }

    setIsDeploying(true);
    setDeployedUrl(null);

    try {
      let result;

      switch (selectedPlatform.id) {
        case "vercel":
          result = await deployToVercel({
            token,
            projectId,
            branchId,
            vercelToken: apiToken,
            projectName: projectName || undefined,
          });
          break;

        case "netlify":
          result = await deployToNetlify({
            token,
            projectId,
            branchId,
            netlifyToken: apiToken,
            siteName: projectName || undefined,
          });
          break;

        case "cloudflare":
          if (!accountId.trim()) {
            toast.error("Cloudflare Account ID is required");
            setIsDeploying(false);
            return;
          }
          result = await deployToCloudflare({
            token,
            projectId,
            branchId,
            cloudflareToken: apiToken,
            accountId: accountId,
            projectName: projectName || undefined,
          });
          break;
      }

      if (result?.success) {
        setDeployedUrl(result.url);
        toast.success(`Deployed to ${selectedPlatform.name}!`);
        setSelectedPlatform(null);
        setApiToken("");
        setProjectName("");
        setAccountId("");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setIsDeploying(false);
    }
  };

  const handleGenerateConfig = async (platformId: "vercel" | "netlify" | "cloudflare") => {
    setIsGeneratingConfig(platformId);
    try {
      const result = await generateConfig({
        token,
        branchId,
        platform: platformId,
      });

      if (result.success) {
        toast.success(`Created ${result.filesCreated.join(", ")}`);
      }
    } catch {
      toast.error("Failed to generate config");
    } finally {
      setIsGeneratingConfig(null);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Rocket className="h-6 w-6" />
            Deploy to Production
          </h2>
          <p className="text-muted-foreground mt-1">
            Deploy your application to Vercel, Netlify, or Cloudflare
          </p>
        </div>
      </div>

      {deployedUrl && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <Check className="h-5 w-5" />
              Deployment Successful!
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-sm font-mono">{deployedUrl}</span>
              <Button size="sm" variant="outline" asChild>
                <a href={deployedUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3 w-3 mr-2" />
                  Visit
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {deployPlatforms.map((platform) => (
          <Card key={platform.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${platform.color} flex items-center justify-center text-xl text-white font-bold`}>
                    {platform.icon}
                  </div>
                  <div>
                    <CardTitle className="text-lg">{platform.name}</CardTitle>
                    <CardDescription>{platform.description}</CardDescription>
                  </div>
                </div>
                <a
                  href={platform.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Docs
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      className="flex-1 gap-2"
                      onClick={() => setSelectedPlatform(platform)}
                    >
                      <Rocket className="h-4 w-4" />
                      Deploy to {platform.name}
                    </Button>
                  </DialogTrigger>
                  {selectedPlatform?.id === platform.id && (
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Deploy to {platform.name}</DialogTitle>
                        <DialogDescription>
                          Enter your API credentials to deploy
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="api-token">API Token *</Label>
                          <Input
                            id="api-token"
                            type="password"
                            placeholder="Your API token"
                            value={apiToken}
                            onChange={(e) => setApiToken(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            <a href={platform.tokenUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              Get your API token here
                            </a>
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="project-name">Project Name (Optional)</Label>
                          <Input
                            id="project-name"
                            placeholder="my-awesome-app"
                            value={projectName}
                            onChange={(e) => setProjectName(e.target.value)}
                          />
                        </div>
                        {platform.id === "cloudflare" && (
                          <div className="space-y-2">
                            <Label htmlFor="account-id">Account ID *</Label>
                            <Input
                              id="account-id"
                              placeholder="Your Cloudflare Account ID"
                              value={accountId}
                              onChange={(e) => setAccountId(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              Find this in your Cloudflare dashboard
                            </p>
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setSelectedPlatform(null)}>
                          Cancel
                        </Button>
                        <Button onClick={handleDeploy} disabled={isDeploying}>
                          {isDeploying ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Deploying...
                            </>
                          ) : (
                            <>
                              <Rocket className="h-4 w-4 mr-2" />
                              Deploy
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  )}
                </Dialog>

                <Button
                  variant="outline"
                  onClick={() => handleGenerateConfig(platform.id)}
                  disabled={isGeneratingConfig === platform.id}
                  className="gap-2"
                >
                  {isGeneratingConfig === platform.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileCode className="h-4 w-4" />
                  )}
                  Config
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-blue-500/50 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="text-sm">How Deployment Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p><strong>1. Generate Config:</strong> Creates platform-specific config files (vercel.json, netlify.toml, etc.)</p>
          <p><strong>2. Deploy:</strong> Uploads all files to the platform and builds your app</p>
          <p><strong>3. Live URL:</strong> Get a production URL instantly (usually takes 30-60 seconds)</p>
          <p className="pt-2 text-xs">
            <strong>Note:</strong> Free tiers available on all platforms. No credit card required for initial deployments.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
