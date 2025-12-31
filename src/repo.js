const fs = require("fs/promises");
const path = require("path");

const LIT_DIR = ".lit";

function litPath(...parts) {
  // current directory where the user runs `lit ...`
  return path.join(process.cwd(), LIT_DIR, ...parts);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function writeIfMissing(filePath, content) {
  if (await exists(filePath)) return;
  await fs.writeFile(filePath, content, "utf8");
}

async function initRepo() {
  const root = litPath();
  const already = await exists(root);

  // Create folders
  await ensureDir(litPath("objects"));
  await ensureDir(litPath("refs", "heads"));

  // HEAD points to main branch
  await writeIfMissing(litPath("HEAD"), "ref: refs/heads/main\n");
  await writeIfMissing(litPath("index"), "");


  console.log(
    already
      ? "Reinitialized existing lit repository in .lit/"
      : "Initialized empty lit repository in .lit/"
  );
}

module.exports = { initRepo };
