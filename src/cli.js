#!/usr/bin/env node

const fs = require("fs/promises");
// Needed to read file content for hash-object

const { initRepo } = require("./repo");
// Phase 1 logic

const { writeObject, readObject } = require("./objectStore");
// Phase 2 logic

const { writeTreeForDir, listTree } = require("./tree");
// Phase 3 logic

const { readHEAD, readRef, writeRef } = require("./ref");
const { createCommit } = require("./commit");
const { logCommits } = require("./log");
// Phase 4 logic

const { add } = require("./add");
const { writeTreeFromIndex } = require("./writeTreeFromIndex");
// Phase 5A + 5B logic

const { checkoutCommit } = require("./checkout");
// Phase 6 logic

function usage() {
  console.log(`Usage:
  lit init
  lit hash-object -w <file>
  lit cat-file -p <hash>
  lit write-tree
  lit ls-tree <treeHash>
  lit commit-tree <tree-hash> -m "message"
  lit log
  lit add <file | ".">
  lit checkout <commitHash>
  lit commit -m "message"

`);
}

async function main() {
  // Get command-line arguments (excluding node + script)
  const args = process.argv.slice(2);

  // First argument is the command
  const cmd = args[0];

  if (!cmd) {
    usage();
    process.exit(1);
  }

  // -------------------------
  // PHASE 1
  // -------------------------
  if (cmd === "init") {
    await initRepo();
    return;
  }

  // -------------------------
  // PHASE 2: hash-object
  // -------------------------
  if (cmd === "hash-object") {
    // Expected format:
    // lit hash-object -w test.js
    const flag = args[1];
    const filePath = args[2];

    if (flag !== "-w" || !filePath) {
      console.error("Expected: lit hash-object -w <file>");
      process.exit(1);
    }

    // Read file content as raw bytes
    const contentBytes = await fs.readFile(filePath);

    // Store as blob object
    const hash = await writeObject("blob", contentBytes);

    // Print hash (just like git)
    console.log(hash);
    return;
  }

  // -------------------------
  // PHASE 2: cat-file
  // -------------------------
  if (cmd === "cat-file") {
    // Expected format:
    // lit cat-file -p <hash>
    const flag = args[1];
    const hash = args[2];

    if (flag !== "-p" || !hash) {
      console.error("Expected: lit cat-file -p <hash>");
      process.exit(1);
    }

    // Read object back from storage
    const obj = await readObject(hash);

    // Print only the content (pretty print)
    process.stdout.write(obj.content);
    return;
  }


  // -------------------------
  // PHASE 3: write-tree
  // -------------------------
  if (cmd === "write-tree") {
    // Snapshot current working directory
    
    // Phase 3: Write tree from index code. OLD WAY
    //const rootDir = process.cwd();
    //const treeHash = await writeTreeForDir(rootDir);

    // Phase 5B: Write tree from index code. NEW WAY
    const treeHash = await writeTreeFromIndex();
    console.log(treeHash);
    return;
  }

  if (cmd === "ls-tree") {
    // Expected: lit ls-tree <treeHash>
    const treeHash = args[1];
    if (!treeHash) {
      console.error("Expected: lit ls-tree <treeHash>");
      process.exit(1);
    }

    const entries = await listTree(treeHash);

    // Print similar to git-ish output
    for (const e of entries) {
      console.log(`${e.mode} ${e.type} ${e.hash} ${e.name}`);
    }
    return;
  }


  // Phase 4: commit-tree
  // -------------------------
  if (cmd === "commit-tree") {
    // Usage: lit commit-tree <treeHash> -m "message"
    const treeHash = args[1];
    if (!treeHash) {
      console.error('Expected: lit commit-tree <treeHash> -m "message"');
      process.exit(1);
    }
  
    // Find "-m" message
    const mIndex = args.indexOf("-m");
    if (mIndex === -1 || !args[mIndex + 1]) {
      console.error('Expected: lit commit-tree <treeHash> -m "message"');
      process.exit(1);
    }
  
    const message = args[mIndex + 1];
  
    // 1) Read HEAD -> which branch are we on?
    const head = await readHEAD();
    if (head.type !== "ref") {
      throw new Error("Cannot commit in detached HEAD state. Checkout a branch first.");
    }
    const refPath = head.value; // e.g. "refs/heads/main"
  
    // 2) Read branch file -> parent commit (if any)
    const parentHash = await readRef(refPath); // null if first commit
  
    // 3) Create new commit object
    const author = "Abel <Abel@lit.com>"; // keep simple for now
    const commitHash = await createCommit({
      treeHash,
      parentHash,
      message,
      author,
    });
  
    // 4) Move branch forward to the new commit
    await writeRef(refPath, commitHash);
  
    // 5) Print commit hash (like git does)
    console.log(commitHash);
    return;
  }

  if (cmd === "log") {
    await logCommits();
    return;
  }

  if (cmd === "add") {
    const target = args[1]; // "file.js" or "."
    await add(target);
    console.log(`Added ${target} to staging.`);
    return;
  }

  if (cmd === "checkout") {
    const commitHash = args[1];
    if (!commitHash) {
      console.error("Expected: lit checkout <commitHash>");
      process.exit(1);
    }
    await checkoutCommit(commitHash);
    return;
  }

  // -------------------------
  // PHASE 7: commit (write-tree + commit-tree)
  // -------------------------
  if (cmd === "commit") {
    // Usage: lit commit -m "message"
    const mIndex = args.indexOf("-m");
    if (mIndex === -1 || !args[mIndex + 1]) {
      console.error('Expected: lit commit -m "message"');
      process.exit(1);
    }
    const message = args[mIndex + 1];

    // 1) HEAD must point to a branch (same rule as your commit-tree)
    const head = await readHEAD();
    if (head.type !== "ref") {
      throw new Error(
        "Cannot commit in detached HEAD state. Checkout a branch first."
      );
    }
    const refPath = head.value; // "refs/heads/main"

    // 2) Parent commit = current branch tip (can be null for first commit)
    const parentHash = await readRef(refPath);

    // 3) Create tree snapshot from INDEX (staging area)
    const treeHash = await writeTreeFromIndex();

    // 4) Create commit object
    const author = "Abel <Abel@lit.com>";
    const commitHash = await createCommit({
      treeHash,
      parentHash,
      message,
      author,
    });

    // 5) Move branch forward
    await writeRef(refPath, commitHash);

    console.log(commitHash);
    return;
  }
  
  // Unknown command
  console.error(`Unknown command: ${cmd}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
