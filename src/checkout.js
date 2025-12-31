const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const { readObject } = require("./objectStore"); // you already have this logic from cat-file
const { readHEAD, readRef, writeRef } = require("./ref"); // Phase 4 refs helpers
const { readIndex } = require("./indexFile");
const { litPath } = require("./indexFile");

/*
  -------------------------
  PART A: Dirty check logic
  -------------------------

  We block checkout if there are uncommitted changes.

  "Uncommitted changes" includes:
  1) Working directory differs from HEAD commit tree
  2) Staging area (index) differs from HEAD commit tree

  So we need:
  - HEAD commit hash (from refs)
  - HEAD tree hash (from commit object)
  - Current working tree hash (computed WITHOUT writing objects)
  - Current index tree hash (computed WITHOUT writing objects)
*/

// Hash helper: sha1 of Buffer -> hex string
function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

/*
  Compute a blob hash WITHOUT storing the object.

  This must match your writeObject("blob", contentBytes) hashing rule:
  hash = sha1( "blob <size>\0" + contentBytes )
*/
function computeBlobOid(contentBytes) {
  const header = Buffer.from(`blob ${contentBytes.length}\0`, "utf8");
  const storeBytes = Buffer.concat([header, contentBytes]);
  return sha1(storeBytes);
}

/*
  Compute a tree hash WITHOUT storing it.

  IMPORTANT:
  - The "content" of the tree must match exactly how you built tree objects in Phase 3/5B.
  - In your project, tree content is text lines like:
      "100644 blob <hash> filename"
      "040000 tree <hash> foldername"
    joined with "\n" and ending with "\n" if not empty.

  hash = sha1( "tree <size>\0" + treeContentBytes )
*/
function computeTreeOid(treeContentBytes) {
  const header = Buffer.from(`tree ${treeContentBytes.length}\0`, "utf8");
  const storeBytes = Buffer.concat([header, treeContentBytes]);
  return sha1(storeBytes);
}

/*
  Compute the working directory tree hash (Phase 3 style),
  but WITHOUT writing objects.

  This scans the disk (like your old writeTreeForDir),
  and hashes file contents to blob oids, then folder description to tree oid.
*/
async function computeWorkTreeOidForDir(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  // Ignore internal repo folder (and usually node_modules too, or it becomes huge)
  const filtered = entries.filter(
    (e) => e.name !== ".lit" && e.name !== "node_modules"
  );

  // Stable order so result doesn't change just because OS returned a different order
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  const lines = [];

  for (const entry of filtered) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isFile()) {
      const contentBytes = await fs.readFile(fullPath);

      // IMPORTANT: we compute blob hash only (no storing)
      const blobHash = computeBlobOid(contentBytes);

      lines.push(`100644 blob ${blobHash} ${entry.name}`);
      continue;
    }

    if (entry.isDirectory()) {
      const childTreeHash = await computeWorkTreeOidForDir(fullPath);
      lines.push(`040000 tree ${childTreeHash} ${entry.name}`);
      continue;
    }

    // Skip other types
  }

  const treeText = lines.join("\n") + (lines.length ? "\n" : "");
  const treeBytes = Buffer.from(treeText, "utf8");
  return computeTreeOid(treeBytes);
}

/*
  Build a tree hash from the index WITHOUT writing objects.

  We do the Phase 5B grouping (paths -> nested structure),
  then compute tree hashes bottom-up.
*/

// Split "src/utils/math.js" -> ["src","utils","math.js"]
function splitPath(p) {
  return p.split("/").filter(Boolean);
}

// Build in-memory folder structure from indexMap
function buildFolderTreeFromIndex(indexMap) {
  const root = { files: new Map(), dirs: new Map() };

  for (const [filePath, blobHash] of indexMap.entries()) {
    const parts = splitPath(filePath);
    if (parts.length === 0) continue;

    let node = root;

    // Walk folders
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      if (!node.dirs.has(dirName)) {
        node.dirs.set(dirName, { files: new Map(), dirs: new Map() });
      }
      node = node.dirs.get(dirName);
    }

    const fileName = parts[parts.length - 1];
    node.files.set(fileName, blobHash);
  }

  return root;
}

// Compute tree oid for a folder node (bottom-up), WITHOUT writing objects
function computeTreeOidForNode(node) {
  // We need recursion because a folder line needs child folder hashes
  // We'll do it as an async function because child computations are recursive.
  return (async () => {
    const lines = [];

    // files
    const fileNames = Array.from(node.files.keys()).sort((a, b) =>
      a.localeCompare(b)
    );
    for (const fileName of fileNames) {
      const blobHash = node.files.get(fileName);
      lines.push(`100644 blob ${blobHash} ${fileName}`);
    }

    // dirs
    const dirNames = Array.from(node.dirs.keys()).sort((a, b) =>
      a.localeCompare(b)
    );
    for (const dirName of dirNames) {
      const childNode = node.dirs.get(dirName);
      const childTreeHash = await computeTreeOidForNode(childNode);
      lines.push(`040000 tree ${childTreeHash} ${dirName}`);
    }

    const treeText = lines.join("\n") + (lines.length ? "\n" : "");
    const treeBytes = Buffer.from(treeText, "utf8");
    return computeTreeOid(treeBytes);
  })();
}

async function computeIndexTreeOid() {
  const indexMap = await readIndex(); // Map(path -> blobHash)
  const rootNode = buildFolderTreeFromIndex(indexMap);
  return await computeTreeOidForNode(rootNode);
}

/*
  Get HEAD commit hash:
  - If HEAD is "ref: refs/heads/main", read that file to get commit hash
  - If HEAD is detached (a hash), use it directly
*/
async function getHeadCommitHash() {
    // Read .lit/HEAD as text
    const headText = (await fs.readFile(litPath("HEAD"), "utf8")).trim();
  
    // Case 1: HEAD points to a ref, like: "ref: refs/heads/main"
    if (headText.startsWith("ref: ")) {
      const refPath = headText.slice("ref: ".length).trim(); // "refs/heads/main"
  
      // IMPORTANT:
      // refPath is relative to .lit/, so the real file is:
      // .lit/refs/heads/main
      const fullRefPath = litPath(...refPath.split("/"));
  
      // If branch file doesn't exist yet, return null
      try {
        const refHash = (await fs.readFile(fullRefPath, "utf8")).trim();
        return refHash || null; // empty file => null
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    }
  
    // Case 2: detached HEAD (HEAD directly stores a commit hash)
    // e.g. "3239336c1721..."
    return headText || null;
  }

/*
  Read commit object and extract tree hash.
  Commit body text looks like:
    tree <hash>
    parent <hash>   (optional)
    ...
    <blank line>
    <message>
*/
async function getTreeHashFromCommit(commitHash) {
  const obj = await readObject(commitHash);

  if (obj.type !== "commit") {
    throw new Error(`Not a commit: ${commitHash}`);
  }

  const text = obj.content.toString("utf8");

  // Find line starting with "tree "
  const line = text.split("\n").find((l) => l.startsWith("tree "));
  if (!line) throw new Error("Commit has no tree line");

  return line.slice("tree ".length).trim();
}

/*
  Determine if repo is "dirty" (has uncommitted changes)
*/
async function assertCleanWorkingState() {
  const headCommit = await getHeadCommitHash();

  // If there is no commit yet, we treat:
  // - empty working dir + empty index = clean
  // - otherwise = dirty (because checkout would overwrite your files)
  if (!headCommit) {
    const workTree = await computeWorkTreeOidForDir(process.cwd());
    const indexTree = await computeIndexTreeOid();

    // This is the known empty tree hash (same as Git).
    // If both match empty tree, it's clean.
    const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

    if (workTree === EMPTY_TREE && indexTree === EMPTY_TREE) return;

    throw new Error(
      "Uncommitted changes (no commits yet). Commit or clear your working directory before checkout."
    );
  }

  const headTree = await getTreeHashFromCommit(headCommit);

  // Working directory snapshot (computed from disk)
  const workTree = await computeWorkTreeOidForDir(process.cwd());

  // Index snapshot (computed from .lit/index)
  const indexTree = await computeIndexTreeOid();

  // If either differs from HEAD tree, we consider it dirty.
  if (workTree !== headTree) {
    throw new Error(
      "Uncommitted changes detected. Commit (or reset) before checkout."
    );
  }
}

/*
  -------------------------
  PART B: Checkout logic
  -------------------------

  checkout(commitHash):
  - block if dirty
  - read commit -> tree hash
  - replace working directory files to match that tree
  - move branch pointer (if on a branch)
*/

// Parse one tree line like:
// "100644 blob AAA111 a.txt"
function parseTreeLine(line) {
  const [mode, type, hash, ...nameParts] = line.trim().split(" ");
  const name = nameParts.join(" "); // safe if you ever allow spaces (optional)
  return { mode, type, hash, name };
}

// Read a tree object and return parsed entries
async function readTreeEntries(treeHash) {
  const obj = await readObject(treeHash);
  if (obj.type !== "tree") throw new Error(`Not a tree: ${treeHash}`);

  const text = obj.content.toString("utf8").trim();
  if (!text) return [];

  return text.split("\n").map(parseTreeLine);
}

// Read blob bytes (file content) from blob hash
async function readBlobContent(blobHash) {
  const obj = await readObject(blobHash);
  if (obj.type !== "blob") throw new Error(`Not a blob: ${blobHash}`);
  return obj.content; // content is the raw file bytes (after header)
}

/*
  Dangerous but simple: clear working directory except .lit and node_modules.

  Because we're blocking dirty state, this won't nuke uncommitted work.
*/
async function clearWorkingDir(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".lit" || entry.name === "node_modules") continue;

    const full = path.join(rootDir, entry.name);

    // rm with recursive:true deletes folders/files
    await fs.rm(full, { recursive: true, force: true });
  }
}

/*
  Materialize a tree hash onto disk at targetDir.
  This creates files/folders exactly matching the tree snapshot.
*/
async function checkoutTree(treeHash, targetDir) {
  const entries = await readTreeEntries(treeHash);

  // Make sure target folder exists
  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const outPath = path.join(targetDir, entry.name);

    if (entry.type === "blob") {
      const content = await readBlobContent(entry.hash);

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(outPath), { recursive: true });

      // Write/overwrite file
      await fs.writeFile(outPath, content);
      continue;
    }

    if (entry.type === "tree") {
      // Create folder and recurse into it
      await fs.mkdir(outPath, { recursive: true });
      await checkoutTree(entry.hash, outPath);
      continue;
    }
  }
}

/*
  Update the current branch ref to point at commitHash.
  If HEAD is detached, we write the commit hash directly to HEAD.
*/
async function moveHeadToCommit(commitHash) {
  const head = await readHEAD();

  if (head.type === "ref") {
    // HEAD points to a branch file, so update that branch file
    await writeRef(head.value, commitHash);
    return;
  }

  // Detached HEAD: write commit hash directly to HEAD
  const headPath = litPath("HEAD");
  await fs.writeFile(headPath, commitHash + "\n", "utf8");
}

async function checkoutCommit(commitHash) {
  // 1) block if dirty
  await assertCleanWorkingState();

  // 2) load commit -> tree
  const treeHash = await getTreeHashFromCommit(commitHash);

  // 3) clear working directory (safe because we blocked dirty)
  await clearWorkingDir(process.cwd());

  // 4) materialize snapshot
  await checkoutTree(treeHash, process.cwd());

  // 5) move branch pointer
  await moveHeadToCommit(commitHash);

  console.log(`Checked out ${commitHash}`);
}

module.exports = { checkoutCommit };
