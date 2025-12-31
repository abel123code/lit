# lit — a tiny Git clone (learning project)

![lit logo](assets/lit-fire.png)

`lit` is a minimal Git-like version control tool built in Node.js to understand Git internals:

- content-addressed storage (SHA-1)
- blobs / trees / commits
- refs + HEAD
- staging (index) + add
- checkout (reset-style) to restore files from a past commit snapshot

This is a learning project — not a production VCS.

---

## What `lit` supports

✅ `lit init`  
✅ `lit hash-object -w <file>`  
✅ `lit cat-file -p <hash>`  
✅ `lit add <file | .>`  
✅ `lit write-tree` (writes tree snapshot from the staging index)  
✅ `lit commit-tree <treeHash> -m "message"`  
✅ `lit log`  
✅ `lit checkout <commitHash>` (restores working directory to that commit)

---

## Key concepts (Git mental model)

- **Blob**: file contents
- **Tree**: directory snapshot (files + folders)
- **Commit**: metadata + pointer to a root tree snapshot (+ optional parent commit)
- **Refs**: branch pointers, e.g. `refs/heads/main`
- **HEAD**: usually points to a ref (attached HEAD), e.g. `ref: refs/heads/main`

> In this project, `checkout <commitHash>` behaves like `git reset --hard <commitHash>`:
> it updates the branch pointer (main) to that commit.

---

## Requirements

- Node.js (recommended: **Node 18+**)
- Works best on Windows/macOS/Linux terminals

---

## Installation

```bash
git clone <your-repo-url>
cd <your-repo-folder>
npm install
npm link
```

You can now use lit from any directory:

```bash
lit init
lit add .
lit commit -m "message"
```
