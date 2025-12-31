const fs = require("fs/promises");
const path = require("path");
const { writeObject } = require("./objectStore");
const { setIndexEntry } = require("./indexFile");

// Helper: normalize paths so index always uses forward slashes
// (Git stores paths with / even on Windows)
function normalizeRepoPath(p) {
  return p.split(path.sep).join("/");
}

// Helper: should we ignore this path?
function shouldIgnore(name) {
  return name === ".lit" || name === "node_modules";
}

/*
  Stage ONE file:
  - read bytes
  - write blob object (Phase 2)
  - record "path blobHash" into .lit/index
*/
async function addFile(absPath, repoRelativePath) {
  const bytes = await fs.readFile(absPath); // Buffer
  const blobHash = await writeObject("blob", bytes);

  // Store using forward slashes in the index
  const normalized = normalizeRepoPath(repoRelativePath);
  await setIndexEntry(normalized, blobHash);

  return blobHash;
}

/*
  Recursively walk a directory and stage every file.
  This is similar to your old write-tree traversal, except:
  - instead of building tree objects
  - we stage files into the index
*/
async function addAllFromDir(dirAbsPath, repoRelBase = "") {
  const entries = await fs.readdir(dirAbsPath, { withFileTypes: true });

  for (const entry of entries) {
    if (shouldIgnore(entry.name)) continue;

    const abs = path.join(dirAbsPath, entry.name);

    // Build the repo-relative path (like "src/file.js")
    const rel = repoRelBase ? path.join(repoRelBase, entry.name) : entry.name;

    if (entry.isDirectory()) {
      await addAllFromDir(abs, rel);
    } else if (entry.isFile()) {
      await addFile(abs, rel);
    }
  }
}

/*
  Main entry:
  - target can be "." or a file path
*/
async function add(target) {
  if (!target) {
    throw new Error('Usage: lit add <file | ".">');
  }

  const cwd = process.cwd();
  const absTarget = path.resolve(cwd, target);

  // If "." → stage everything in the repo folder
  if (target === ".") {
    await addAllFromDir(cwd);
    return;
  }

  // Otherwise stage the given file
  const stat = await fs.stat(absTarget);

  if (stat.isDirectory()) {
    // Optional: support `lit add src` meaning "add everything under src"
    // If you don't want this yet, you can throw instead.
    const baseName = path.basename(absTarget);
    await addAllFromDir(absTarget, baseName);
    return;
  }

  if (!stat.isFile()) {
    throw new Error(`Not a file: ${target}`);
  }

  const repoRel = path.relative(cwd, absTarget);
  await addFile(absTarget, repoRel);
}

module.exports = { add };
