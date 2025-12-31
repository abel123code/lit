const fs = require("fs/promises");
const path = require("path");

// We reuse Phase 2 functions:
// - writeObject(type, bytes): store an object in .lit/objects and return its hash (ID)
// - readObject(hash): read it back (decompress + parse header)
const { writeObject, readObject } = require("./objectStore");

/*
  This function "snapshots" a folder.

  It returns a hash (ID) for the tree object representing the folder.
  A "tree" is basically a list like:
    - filename -> blob hash
    - foldername -> tree hash

  THIS IS THE PHASE 3 WAY OF DOING. WE WILL MODIFY THIS FOR PHASE 5B which is writeTreeFromIndex
*/
async function writeTreeForDir(dirPath) {
  // Read everything inside this folder.
  // withFileTypes: true means:
  //   "Don't just give me names; also tell me if each thing is a file or folder."
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  // We must NOT snapshot our own internal folder (.lit), or we'd store the repo inside itself.
  const filtered = entries.filter((e) => e.name !== ".lit");

  /*
    IMPORTANT: Sort entries by name.

    Why?
    - A folder listing may come back in different orders sometimes.
    - If the order changes, the snapshot text changes, which changes the hash.
    - Sorting makes the result "deterministic" (defined below).

    Deterministic = "Same input → same output every time."
    Here it means: if the folder contents did not change,
    running write-tree again should give the SAME tree hash.
  */
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  // We'll build a list of text lines that describe the folder.
  // Example lines:
  //   "100644 blob <hash> test.js"
  //   "040000 tree <hash> src"
  const lines = [];

  // Go through each file/folder inside the current directory.
  for (const entry of filtered) {
    // Build full path to that item (so we can read it)
    const fullPath = path.join(dirPath, entry.name);

    // CASE 1: It's a normal file
    if (entry.isFile()) {
      // Read the file content as bytes
      const contentBytes = await fs.readFile(fullPath);

      // Store the file content as a blob object (Phase 2)
      // This returns a hash that identifies the content.
      const blobHash = await writeObject("blob", contentBytes);

      // Add a line that says:
      // - mode 100644 = regular file
      // - type blob = file content object
      // - blobHash = ID of the stored content
      // - entry.name = filename (this is where filenames finally get recorded!)
      lines.push(`100644 blob ${blobHash} ${entry.name}`);

      // Continue to next entry
      continue;
    }

    // CASE 2: It's a directory (folder)
    if (entry.isDirectory()) {
      // Recursively snapshot the child folder.
      // This returns a tree hash for that folder.
      const childTreeHash = await writeTreeForDir(fullPath);

      // Add a line that says:
      // - mode 040000 = directory
      // - type tree = folder snapshot object
      // - childTreeHash = ID of that child folder snapshot
      // - entry.name = folder name
      lines.push(`040000 tree ${childTreeHash} ${entry.name}`);

      continue;
    }

    // CASE 3: Other types (symlinks, etc.)
    // We skip for simplicity.
  }

  /*
    Now we turn the lines into the content of our tree object.

    If the folder has:
      test.js (blob hash abc)
      src/    (tree hash def)

    The tree content becomes:
      100644 blob abc test.js
      040000 tree def src
  */
  const treeText = lines.join("\n") + (lines.length ? "\n" : "");

  // Convert the text into bytes so we can store it like any other object
  const treeBytes = Buffer.from(treeText, "utf8");

  // Store the tree object in .lit/objects/ using Phase 2 storage
  // This returns the tree hash (ID) of this folder snapshot.
  const treeHash = await writeObject("tree", treeBytes);

  // Return the ID so the caller can reference this snapshot later
  return treeHash;
}

/*
  This function is like a "debug viewer" for tree objects.

  Given a tree hash, it:
  - reads the object
  - checks it's a tree
  - parses each line into { mode, type, hash, name }
*/
async function listTree(treeHash) {
  // Read the object bytes from storage
  const obj = await readObject(treeHash);

  // Safety check: make sure the hash refers to a tree
  if (obj.type !== "tree") {
    throw new Error(
      `Object ${treeHash} is not a tree (it is type: ${obj.type})`
    );
  }

  // Convert tree content bytes into text
  // trimEnd removes trailing newlines so split() behaves nicely
  const text = obj.content.toString("utf8").trimEnd();

  // If tree is empty, return empty array
  if (!text) return [];

  // Each line represents one entry in the folder snapshot
  const lines = text.split("\n");

  // Convert each line into a structured object
  return lines.map((line) => {
    // Line format:
    // "<mode> <type> <hash> <name>"
    // Example:
    // "100644 blob abc123 test.js"
    const [mode, type, hash, ...nameParts] = line.split(" ");

    // Join name back in case filename had spaces
    const name = nameParts.join(" ");

    return { mode, type, hash, name };
  });
}

// Export functions so cli.js can call them
module.exports = { writeTreeForDir, listTree };
