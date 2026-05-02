const childMap = new Map<string, FileTreeNode>();
for (const child of folder.children) childMap.set(child.name, child);
(folder as FileTreeNode & { _map: Map<string, FileTreeNode> })._map = childMap;
currentMap = childMap;
