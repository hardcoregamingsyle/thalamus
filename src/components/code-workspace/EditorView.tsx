import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Code2, FileText, Save, X } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface EditorViewProps {
  branchId: string;
}

export function EditorView({ branchId }: EditorViewProps) {
  const files = useQuery(api.codeBranches.watchFiles, { branchId });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const currentFile = files?.find(f => f.filepath === selectedFile);

  const handleSelectFile = (filepath: string) => {
    if (isDirty && !confirm("You have unsaved changes. Discard them?")) {
      return;
    }
    const file = files?.find(f => f.filepath === filepath);
    setSelectedFile(filepath);
    setEditContent(file?.content || "");
    setIsDirty(false);
  };

  const handleContentChange = (content: string) => {
    setEditContent(content);
    setIsDirty(content !== currentFile?.content);
  };

  const handleSave = () => {
    // In a real implementation, this would save to the backend
    toast.info("Editor is read-only. Files are managed by AI agents.");
    setIsDirty(false);
  };

  const handleClose = () => {
    if (isDirty && !confirm("You have unsaved changes. Discard them?")) {
      return;
    }
    setSelectedFile(null);
    setEditContent("");
    setIsDirty(false);
  };

  return (
    <div className="h-full flex">
      {/* File Tree */}
      <div className="w-64 border-r bg-muted/20">
        <div className="p-4 border-b">
          <h3 className="font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Files
          </h3>
        </div>
        <ScrollArea className="h-[calc(100vh-12rem)]">
          {files === undefined ? (
            <div className="p-4 text-sm text-muted-foreground">Loading...</div>
          ) : files.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No files yet</div>
          ) : (
            <div className="p-2 space-y-1">
              {files.map((file) => (
                <button
                  key={file._id}
                  onClick={() => handleSelectFile(file.filepath)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded text-sm hover:bg-muted transition-colors",
                    selectedFile === file.filepath && "bg-primary/10 text-primary font-medium"
                  )}
                >
                  <div className="truncate">{file.filepath}</div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Editor Area */}
      <div className="flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {selectedFile ? (
            <motion.div
              key={selectedFile}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col"
            >
              {/* Editor Header */}
              <div className="border-b bg-background px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Code2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-semibold">{selectedFile}</div>
                    <div className="text-xs text-muted-foreground">
                      Last modified by {currentFile?.lastModifiedBy}
                    </div>
                  </div>
                  {isDirty && (
                    <span className="text-xs text-orange-500 font-medium">• Modified</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={handleSave} disabled={!isDirty}>
                    <Save className="h-4 w-4 mr-2" />
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleClose}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Editor Content */}
              <div className="flex-1 p-4">
                <Textarea
                  value={editContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  className="h-full font-mono text-sm resize-none"
                  placeholder="File content..."
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex items-center justify-center"
            >
              <div className="text-center">
                <div className="rounded-full bg-muted p-6 inline-block mb-4">
                  <Code2 className="h-12 w-12 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No File Selected</h3>
                <p className="text-muted-foreground">
                  Select a file from the sidebar to view its contents
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
