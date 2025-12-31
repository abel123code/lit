const fs = require("fs/promises");
const path = require("path");

// Helper: build paths inside .lit
function litPath(...parts) {
  return path.join(process.cwd(), ".lit", ...parts);
}

/*
  Read .lit/HEAD and return an object indicating what it points to.
  Returns:
    { type: "ref", value: "refs/heads/main" } if HEAD points to a branch
    { type: "hash", value: "commitHash" } if HEAD is detached (direct commit hash)
*/
async function readHEAD() {
  const headPath = litPath("HEAD");
  const headText = await fs.readFile(headPath, "utf8");

  const trimmed = headText.trim();

  // If HEAD starts with "ref:", it points to a branch file
  if (trimmed.startsWith("ref:")) {
    // Split "ref: refs/heads/main" into ["ref:", "refs/heads/main"]
    const [, refPath] = trimmed.split(" ");
    return { type: "ref", value: refPath };
  }

  // Detached HEAD: HEAD directly contains a commit hash
  // e.g. "3239336c1721..."
  if (trimmed.length > 0) {
    return { type: "hash", value: trimmed };
  }

  // Empty HEAD (no commits yet)
  return { type: "hash", value: null };
}

/*
  Given a ref like "refs/heads/main", read its current commit hash.
  If branch file doesn't exist yet, return null (no commits yet).
*/
async function readRef(refPath) {
  const fullPath = litPath(refPath);

  try {
    const text = await fs.readFile(fullPath, "utf8");
    const hash = text.trim();
    return hash.length ? hash : null;
  } catch (err) {
    // If file doesn't exist, this branch has no commits yet
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/*
  Update a branch ref file to point to a new commit hash.
  Example:
    write "abcd1234..." into .lit/refs/heads/main
*/
async function writeRef(refPath, hash) {
  const fullPath = litPath(refPath);

  // Make sure parent folder exists (e.g. ".lit/refs/heads")
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Store commit hash with newline (nice format)
  await fs.writeFile(fullPath, hash + "\n", "utf8");
}

module.exports = { readHEAD, readRef, writeRef };
