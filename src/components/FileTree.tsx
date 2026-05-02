import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight, ChevronDown, Folder, FolderOpen, FileCode,
  MoreHorizontal, Trash2, Copy, Pencil, Download, FolderPlus, FilePlus,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface FileTreeFile {
  filepath: string;
  content: string;
  lastModifiedBy: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeNode[];
  file?: FileTreeFile;
}

// ── Build tree from flat file list ────────────────────────────────────────────
export function buildFileTree(files: FileTreeFile[]): FileTreeNode[] {
  const rootMap = new Map<string, FileTreeNode>();

  function getOrCreateFolder(map: Map<string, FileTreeNode>, name: string, fullPath: string): FileTreeNode {
    if (!map.has(name)) {
      map.set(name, { name, path: fullPath, type: "folder", children: [] });
    }
    return map.get(name)!;
  }

  for (const file of files) {
    const parts = file.filepath.split("/").filter(Boolean);
    let currentMap = rootMap;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = parts.slice(0, i + 1).join("/");
      const isLast = i === parts.length - 1;

      if (isLast) {
        if (!currentMap.has(part)) {
          currentMap.set(part, { name: part, path: fullPath, type: "file", file });
        }
      } else {
        const folder = getOrCreateFolder(currentMap, part, fullPath);
        if (!folder.children) folder.children = [];
        const childMap = new Map<string, FileTreeNode>();
        for (const child of folder.children) childMap.set(child.name, child);
        (folder as FileTreeNode & { _map: Map<string, FileTreeNode> })._map = childMap;
        currentMap = childMap;
      }
    }
  }

  function finalize(map: Map<string, FileTreeNode>): FileTreeNode[] {
    const nodes: FileTreeNode[] = [];
    for (const node of map.values()) {
      const n = node as FileTreeNode & { _map?: Map<string, FileTreeNode> };
      if (n._map) {
        n.children = finalize(n._map);
        delete n._map;
      }
      nodes.push(node);
    }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  return finalize(rootMap);
}

// ── Context Menu ──────────────────────────────────────────────────────────────
interface ContextMenuProps {
  x: number;
  y: number;
  node: FileTreeNode;
  onClose: () => void;
  onDelete: (node: FileTreeNode) => void;
  onDuplicate: (node: FileTreeNode) => void;
  onRename: (node: FileTreeNode) => void;
  onDownload: (node: FileTreeNode) => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
}

function ContextMenu({ x, y, node, onClose, onDelete, onDuplicate, onRename, onDownload, onCreateFile, onCreateFolder }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const isFolder = node.type === "folder";
  const label = isFolder ? "Folder" : "File";

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("mousedown", handleClick); document.removeEventListener("keydown", handleKey); };
  }, [onClose]);

  // Adjust position to stay in viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - 300),
    zIndex: 9999,
  };

  const items = [
    { icon: Pencil, label: `Rename ${label}`, action: () => { onRename(node); onClose(); } },
    { icon: Copy, label: `Duplicate ${label}`, action: () => { onDuplicate(node); onClose(); } },
    { icon: Download, label: `Download ${label}`, action: () => { onDownload(node); onClose(); } },
    { icon: Trash2, label: `Delete ${label}`, action: () => { onDelete(node); onClose(); }, danger: true },
    ...(isFolder ? [
      { divider: true },
      { icon: FilePlus, label: "Create File", action: () => { onCreateFile(node.path); onClose(); } },
      { icon: FolderPlus, label: "Create Sub-Folder", action: () => { onCreateFolder(node.path); onClose(); } },
    ] : []),
  ];

  return (
    <div ref={menuRef} style={style} className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden min-w-[180px] py-1">
      {items.map((item, i) => {
        if ("divider" in item) return <div key={i} className="h-px bg-border my-1" />;
        const Icon = item.icon!;
        return (
          <button
            key={i}
            onClick={item.action}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] transition-colors text-left ${
              item.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted/60"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Inline rename input ───────────────────────────────────────────────────────
function RenameInput({ defaultValue, onConfirm, onCancel }: { defaultValue: string; onConfirm: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  return (
    <input
      ref={inputRef}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") onConfirm(value.trim());
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onConfirm(value.trim())}
      className="flex-1 bg-background border border-primary/60 rounded px-1.5 py-0.5 text-[10px] text-foreground focus:outline-none min-w-0"
      onClick={e => e.stopPropagation()}
    />
  );
}

// ── FileTreeNodeItem ──────────────────────────────────────────────────────────
interface FileTreeNodeItemProps {
  node: FileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (file: FileTreeFile) => void;
  onDelete: (node: FileTreeNode) => void;
  onDuplicate: (node: FileTreeNode) => void;
  onRename: (node: FileTreeNode, newName: string) => void;
  onDownload: (node: FileTreeNode) => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onMove: (sourcePath: string, destFolderPath: string) => void;
  renamingPath: string | null;
  setRenamingPath: (p: string | null) => void;
}

export function FileTreeNodeItem({
  node, depth, selectedPath, onSelect, onDelete, onDuplicate, onRename, onDownload,
  onCreateFile, onCreateFolder, onMove, renamingPath, setRenamingPath,
}: FileTreeNodeItemProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showDots, setShowDots] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const isRenaming = renamingPath === node.path;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (node.type === "folder") {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);
    }
  };

  const handleDragLeave = () => setIsDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const sourcePath = e.dataTransfer.getData("text/plain");
    if (sourcePath && sourcePath !== node.path && node.type === "folder") {
      onMove(sourcePath, node.path);
    }
  };

  const menuActions = {
    onDelete: () => onDelete(node),
    onDuplicate: () => onDuplicate(node),
    onRename: () => setRenamingPath(node.path),
    onDownload: () => onDownload(node),
    onCreateFile: (p: string) => onCreateFile(p),
    onCreateFolder: (p: string) => onCreateFolder(p),
  };

  const indentPx = 8 + depth * 12;

  if (node.type === "file") {
    const isSelected = selectedPath === node.path;
    return (
      <>
        <div
          className={`group relative flex items-center gap-1.5 px-2 py-1 rounded text-[10px] transition-all cursor-pointer ${
            isSelected ? "bg-primary/15 border border-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          }`}
          style={{ paddingLeft: `${indentPx}px` }}
          onClick={() => node.file && onSelect(node.file)}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setShowDots(true)}
          onMouseLeave={() => setShowDots(false)}
          draggable
          onDragStart={handleDragStart}
        >
          <FileCode className="h-3 w-3 shrink-0" />
          {isRenaming ? (
            <RenameInput
              defaultValue={node.name}
              onConfirm={v => { if (v && v !== node.name) onRename(node, v); setRenamingPath(null); }}
              onCancel={() => setRenamingPath(null)}
            />
          ) : (
            <span className="truncate flex-1">{node.name}</span>
          )}
          {showDots && !isRenaming && (
            <button
              onClick={e => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
              className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          )}
        </div>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x} y={contextMenu.y}
            node={node}
            onClose={() => setContextMenu(null)}
            {...menuActions}
          />
        )}
      </>
    );
  }

  // Folder
  return (
    <>
      <div
        className={`group relative ${isDragOver ? "bg-primary/10 rounded" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all cursor-pointer"
          style={{ paddingLeft: `${indentPx}px` }}
          onClick={() => setExpanded(e => !e)}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setShowDots(true)}
          onMouseLeave={() => setShowDots(false)}
          draggable
          onDragStart={handleDragStart}
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          {expanded ? <FolderOpen className="h-3 w-3 shrink-0 text-amber-400" /> : <Folder className="h-3 w-3 shrink-0 text-amber-400" />}
          {isRenaming ? (
            <RenameInput
              defaultValue={node.name}
              onConfirm={v => { if (v && v !== node.name) onRename(node, v); setRenamingPath(null); }}
              onCancel={() => setRenamingPath(null)}
            />
          ) : (
            <span className="truncate font-medium flex-1">{node.name}</span>
          )}
          {showDots && !isRenaming && (
            <button
              onClick={e => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
              className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          )}
        </div>
        <AnimatePresence>
          {expanded && node.children && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              style={{ overflow: "hidden" }}
            >
              {node.children.map(child => (
                <FileTreeNodeItem
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onRename={onRename}
                  onDownload={onDownload}
                  onCreateFile={onCreateFile}
                  onCreateFolder={onCreateFolder}
                  onMove={onMove}
                  renamingPath={renamingPath}
                  setRenamingPath={setRenamingPath}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          node={node}
          onClose={() => setContextMenu(null)}
          {...menuActions}
        />
      )}
    </>
  );
}

// ── FileTreeView — top-level component ───────────────────────────────────────
interface FileTreeViewProps {
  files: FileTreeFile[];
  selectedPath: string | null;
  onSelect: (file: FileTreeFile) => void;
  onDelete: (node: FileTreeNode) => void;
  onDuplicate: (node: FileTreeNode) => void;
  onRename: (node: FileTreeNode, newName: string) => void;
  onDownload: (node: FileTreeNode) => void;
  onCreateFile: (parentPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onMove: (sourcePath: string, destFolderPath: string) => void;
}

export function FileTreeView({
  files, selectedPath, onSelect, onDelete, onDuplicate, onRename, onDownload,
  onCreateFile, onCreateFolder, onMove,
}: FileTreeViewProps) {
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const tree = buildFileTree(files);

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const sourcePath = e.dataTransfer.getData("text/plain");
    if (sourcePath) onMove(sourcePath, "");
  };

  return (
    <div
      className="flex-1 overflow-y-auto min-h-0"
      onDragOver={e => e.preventDefault()}
      onDrop={handleRootDrop}
    >
      {tree.length === 0 ? (
        <p className="text-[10px] text-muted-foreground p-3 text-center">No files yet</p>
      ) : (
        <div className="p-1 space-y-0.5">
          {tree.map(node => (
            <FileTreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onRename={onRename}
              onDownload={onDownload}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onMove={onMove}
              renamingPath={renamingPath}
              setRenamingPath={setRenamingPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
