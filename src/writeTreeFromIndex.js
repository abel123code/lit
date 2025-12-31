const { readIndex } = require("./indexFile");
const { writeObject } = require("./objectStore");

/*
  The index is like:
    a.txt -> AAA111
    src/test.js -> BBB222
    src/utils/math.js -> CCC333

  write-tree (staged) must NOT read files/folders from disk.

  Instead, it uses these staged paths to build "tree objects" (folder snapshots).

  A tree object is just text lines like:
    100644 blob <hash> <filename>
    040000 tree <hash> <foldername>
*/

// Split a staged path like "src/utils/math.js" into ["src","utils","math.js"]
function splitPath(p) {
  // Index paths should use "/" even on Windows, so splitting on "/" is safe
  return p.split("/").filter(Boolean);
}

/*
  Build an in-memory folder structure from the index.

  We create nodes like:
    node.files: Map(filename -> blobHash)
    node.dirs:  Map(dirName -> childNode)

  This is NOT saved to disk. It's just to help us build trees.
*/
function buildFolderTreeFromIndex(indexMap) {
  // Root folder node
  const root = { files: new Map(), dirs: new Map() };

  // Go through every staged file (every line in index)
  for (const [filePath, blobHash] of indexMap.entries()) {
    const parts = splitPath(filePath);

    // Example:
    //  filePath = "src/utils/math.js"
    //  parts = ["src", "utils", "math.js"]

    // Start from the root folder
    let node = root;

    // Walk through all folder parts (everything except the last part)
    // because the last part is the filename.
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];

      // If we haven't created this folder node yet, create it
      if (!node.dirs.has(dirName)) {
        node.dirs.set(dirName, { files: new Map(), dirs: new Map() });
      }

      // Move into that folder node
      node = node.dirs.get(dirName);
    }

    // The last part is the filename (example: "math.js")
    const fileName = parts[parts.length - 1];

    // Store that this folder contains this staged file + its blob hash
    // If the same path appears again, it overwrites (that’s correct for staging)
    node.files.set(fileName, blobHash);
  }

  return root;
}

/*
  Recursively write a tree object for a folder node.

  Why recursion?
  Because a folder tree needs the hashes of its child folders first.

  Return value:
    treeHash for this node
*/
async function writeTreeNode(node) {
  const lines = [];

  // ----- 1) Add FILE entries -----
  // We sort names so the tree text is always in a stable order.
  const fileNames = Array.from(node.files.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  for (const fileName of fileNames) {
    const blobHash = node.files.get(fileName);

    // IMPORTANT:
    // We do NOT read the file content here.
    // Because the blob already exists (created during `lit add`)
    // The index already tells us which blob hash to use.
    lines.push(`100644 blob ${blobHash} ${fileName}`);
  }

  // ----- 2) Add FOLDER entries -----
  const dirNames = Array.from(node.dirs.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  for (const dirName of dirNames) {
    const childNode = node.dirs.get(dirName);

    // Recursively write the child folder first
    const childTreeHash = await writeTreeNode(childNode);

    // Now we can reference that child folder by its tree hash
    lines.push(`040000 tree ${childTreeHash} ${dirName}`);
  }

  // ----- 3) Turn lines into this folder’s "tree content" -----
  const treeText = lines.join("\n") + (lines.length ? "\n" : "");

  // Convert to bytes so we can store it
  const treeBytes = Buffer.from(treeText, "utf8");

  // Store the tree object in .lit/objects (same as before)
  const treeHash = await writeObject("tree", treeBytes);

  return treeHash;
}

/*
  Main function: write a root tree from the staging area (.lit/index)
*/
async function writeTreeFromIndex() {
  // 1) Read index (path -> blobHash)
  const indexMap = await readIndex();

  // 2) Build an in-memory folder structure from the staged paths
  const rootNode = buildFolderTreeFromIndex(indexMap);

  // 3) Write tree objects bottom-up and return the root tree hash
  const rootTreeHash = await writeTreeNode(rootNode);

  return rootTreeHash;
}

module.exports = { writeTreeFromIndex };
