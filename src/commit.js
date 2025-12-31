const { writeObject } = require("./objectStore");

/*
  Build the commit "text" that will be hashed + stored.

  A commit object is basically a text file that includes:
  - tree hash (required)
  - parent hash (optional)
  - author (we'll keep simple)
  - timestamp
  - blank line
  - message

  This is similar to real git commits, just simplified.
*/
function buildCommitText({ treeHash, parentHash, message, author }) {
  // Very simple timestamp (seconds since 1970)
  const timestamp = Math.floor(Date.now() / 1000);

  const lines = [];

  // Required: which snapshot does this commit represent?
  lines.push(`tree ${treeHash}`);

  // Optional: link to previous commit (history chain)
  if (parentHash) {
    lines.push(`parent ${parentHash}`);
  }

  // Simple metadata (not strict Git format, but close enough)
  lines.push(`author ${author}`);
  lines.push(`date ${timestamp}`);

  // Blank line separates header from message (Git does this too)
  lines.push("");
  lines.push(message);

  // End with newline for nice formatting
  return lines.join("\n") + "\n";
}

/*
  Create and store a commit object, return its hash.
*/
async function createCommit({ treeHash, parentHash, message, author }) {
  const commitText = buildCommitText({ treeHash, parentHash, message, author });

  // Convert to bytes so we can store it like blob/tree
  const commitBytes = Buffer.from(commitText, "utf8");

  // Store as type "commit" in .lit/objects/ and return the commit hash
  const commitHash = await writeObject("commit", commitBytes);

  return commitHash;
}

module.exports = { createCommit };
