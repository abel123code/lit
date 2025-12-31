const { readHEAD, readRef } = require("./ref");
const { readObject } = require("./objectStore");

/*
  Parse commit text into:
  - parent hash (or null)
  - message
  - date
*/
function parseCommit(commitText) {
  const lines = commitText.split("\n");

  let parent = null;
  let date = null;
  let messageLines = [];

  let i = 0;

  // Read header lines first
  while (i < lines.length) {
    const line = lines[i];

    // Blank line separates header from message
    if (line === "") {
      i++;
      break;
    }

    if (line.startsWith("parent ")) {
      parent = line.split(" ")[1];
    }

    if (line.startsWith("date ")) {
      date = line.split(" ")[1];
    }

    i++;
  }

  // Everything after the blank line is the message
  messageLines = lines.slice(i);

  return {
    parent,
    date,
    message: messageLines.join("\n").trim(),
  };
}

/*
  Log commits starting from a specific commit hash
*/
async function logFromCommit(startHash) {
  let currentHash = startHash;

  // Walk commit chain
  while (currentHash) {
    // Read commit object from .lit/objects
    const { type, content } = await readObject(currentHash);

    if (type !== "commit") {
      throw new Error(`Expected commit object, got ${type}`);
    }

    // Convert bytes → text
    const commitText = content.toString("utf8");

    // Parse commit text
    const { parent, date, message } = parseCommit(commitText);

    // Pretty print (simple version)
    console.log(`commit ${currentHash}`);
    if (date) {
      console.log(`Date: ${new Date(Number(date) * 1000).toISOString()}`);
    }
    console.log("");
    console.log(`    ${message}`);
    console.log("");

    // Move to parent commit
    currentHash = parent;
  }
}

/*
  Main log function
*/
async function logCommits() {
  // 1) Find which branch HEAD points to
  const head = await readHEAD();
  if (head.type === "hash") {
    // Detached HEAD: log from the commit hash directly
    if (!head.value) {
      console.log("No commits yet.");
      return;
    }
    await logFromCommit(head.value);
    return;
  }
  const refPath = head.value; // e.g. "refs/heads/main"

  // 2) Read latest commit hash from that branch
  const currentHash = await readRef(refPath);

  // If no commits yet
  if (!currentHash) {
    console.log("No commits yet.");
    return;
  }

  // 3) Walk commit chain
  await logFromCommit(currentHash);
}

module.exports = { logCommits };
