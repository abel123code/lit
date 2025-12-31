// We need filesystem access to read/write the index file
const fs = require("fs/promises");

// Used to build correct file paths
const path = require("path");

function litPath(...parts) {
  return path.join(process.cwd(), ".lit", ...parts);
}

/*
  What is the index?

  The index is a SIMPLE TEXT FILE that stores:
    filePath -> blobHash

  Example content of .lit/index:

    a.txt b1117c3a5e3c8d8d8b1f6a2a0c2e4a9d1f2c3b4a
    src/file.js 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b

  Meaning:
    - The staged version of a.txt is blob b111...
    - The staged version of src/file.js is blob 9f86...
*/

/*
  Read the index file and return its contents
  as a Map:
    Map<filePath, blobHash>
*/
/* 
Example: 
lines = ["a.txt aaa111", "src/file.js bbb222"]
Map {
  "a.txt"        ->  "aaa111",
  "src/file.js"  -> "bbb222"
}
Note this map is just to visulaise the data structure,

if empty, return empty Map

*/
async function readIndex() {
  const indexPath = litPath("index");

  let text = "";

  try {
    // Read the entire index file as plain text
    text = await fs.readFile(indexPath, "utf8");
  } catch (err) {
    // If the index file does not exist yet,
    // treat it as an empty staging area
    if (err.code === "ENOENT") {
      return new Map();
    }
    throw err;
  }

  // We use a Map because:
  // - keys are unique (one entry per file path)
  // - easy to update existing entries
  const map = new Map();

  // Split file into lines
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Each line is: "<path> <hash>"
    // Example: "a.txt b1117c3a..."
    const [filePath, hash] = trimmed.split(" ");

    // Only add valid entries
    if (filePath && hash) {
      map.set(filePath, hash);
    }
  }

  // Return the in-memory representation of the index
  return map;
}

/*
  Write the Map back into `.lit/index`
*/
async function writeIndex(map) {
  const indexPath = litPath("index");

  /*

1. Convert map to array

2. Sort paths alphabetically

3. Convert to text lines   
  */
  const lines = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, hash]) => `${filePath} ${hash}`);

  // Join lines and write back to disk
  // Add newline at the end if there are entries
  const output =
    lines.length > 0 ? lines.join("\n") + "\n" : "";

  await fs.writeFile(indexPath, output, "utf8");
}

/*
  Add or update ONE entry in the index.

  This is what `lit add` ultimately calls.
*/
async function setIndexEntry(filePath, blobHash) {
  // Step 1: load current index into memory
  const map = await readIndex();

  // Step 2: update or insert the entry
  // If the file already existed, this overwrites it
  map.set(filePath, blobHash);

  // Step 3: write updated index back to disk
  await writeIndex(map);
}

// Export helpers so `lit add` can use them
module.exports = {
  readIndex,
  writeIndex,
  setIndexEntry,
  litPath
};
