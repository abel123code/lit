const fs = require("fs/promises");
// File system module (async version)
// Used to read/write files and create folders

const path = require("path");
// Helps build OS-safe paths (Windows / Mac / Linux)

const crypto = require("crypto");
// Used to generate SHA-1 hashes

const zlib = require("zlib");
// Used to compress / decompress objects (Git does this)

const { promisify } = require("util");
// Converts callback-based functions into Promise-based ones

// Turn zlib.deflate / inflate into async functions
const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

const LIT_DIR = ".lit";
// Name of our repository folder (like .git)

// Helper to build paths inside .lit relative to WHERE the command is run
function litPath(...parts) {
  // process.cwd() = current directory user is in
  // Example: C:/Users/User/Desktop/test-proj
  return path.join(process.cwd(), LIT_DIR, ...parts);
}

// Ensures a directory exists (creates parent folders too)
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

// Compute SHA-1 hash of a Buffer
function sha1(buffer) {
  return crypto
    .createHash("sha1")
    .update(buffer)
    .digest("hex");
}

/*
  Builds the exact bytes Git hashes:

  "<type> <size>\0" + content

  Example for a file with "hello":
  "blob 5\0hello"
*/
function buildObjectBytes(type, contentBytes) {
  // Header describes WHAT the object is and HOW BIG it is
  const header = Buffer.from(
    `${type} ${contentBytes.length}\0`,
    "utf8"
  );

  // Final object = header + actual content
  return Buffer.concat([header, contentBytes]);
}

// Writes an object (blob for now) into .lit/objects
async function writeObject(type, contentBytes) {
  // Build raw object bytes (before compression)
  const raw = buildObjectBytes(type, contentBytes);

  // Hash is calculated from raw (NOT compressed) bytes
  const hash = sha1(raw);

  // Git-style storage:
  // first 2 chars = folder
  // rest = filename
  //
  // e.g. ab1234... → .lit/objects/ab/1234...
  const dir = litPath("objects", hash.slice(0, 2));
  const file = litPath("objects", hash.slice(0, 2), hash.slice(2));

  // Ensure the directory exists
  await ensureDir(dir);

  // Compress object to save space
  const compressed = await deflate(raw);

  // Write compressed object to disk
  await fs.writeFile(file, compressed);

  // Return hash so caller can reference it
  return hash;
}

// Reads an object back from disk using its hash
async function readObject(hash) {
  // Reconstruct file path from hash
  const file = litPath(
    "objects",
    hash.slice(0, 2),
    hash.slice(2)
  );

  // Read compressed data
  const compressed = await fs.readFile(file);

  // Decompress back to raw bytes
  const raw = await inflate(compressed);

  /*
    raw format:
    "<type> <size>\0<content>"
  */

  // Find where header ends (null byte)
  const nulIndex = raw.indexOf(0);

  // Extract header text
  const header = raw
    .slice(0, nulIndex)
    .toString("utf8");

  // Extract content bytes
  const content = raw.slice(nulIndex + 1);

  // Header looks like: "blob 12"
  const [type, sizeStr] = header.split(" ");
  const size = Number(sizeStr);

  return { type, size, content };
}

// Export functions for CLI to use
module.exports = {
  writeObject,
  readObject,
};
