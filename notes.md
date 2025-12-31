Setting it up

1. Clone repo
2. npm link

Phase 1:

1. Running command 'lit init' allows for .lit folder to be created
2. Sets up 3 folders in .lit folder

- objects folder - where saved content lives
- refs/head - the branch
- HEAD - tells you which pointer you are currently following

Phase 2:
Takes a file’s content, turns it into a blob, stores it in .lit/objects/ using a hash as its ID, and lets you read it back.
Build 2 commands:

- lit hash-object -w <file> : Take this file’s content, turn it into a Git object, store it, and tell me its hash.

- lit cat-file -p <hash>: Given a hash, show me what’s inside that object

Blob: the raw bytes of the file, stored immutably, addressed by hash

git uses a hash, that is generated from the content of the file. so if the hash is the same, then the blob is the same, and thus they point to the same blob, reducing the duplication of blobs
essentially if u have the same content, u have the same hash and blob

objectStores.js: similar to warehouse manager (knows how objects are stored and retrieved)

zlib is used to compress or decompress the file

Flow of how it works:
file content (bytes)
↓
add header: "blob <size>\0"
↓
RAW OBJECT BYTES
↓
SHA-1 hash is computed HERE (This is the address of where your compressed file is stored)
↓
zlib.deflate (compress) - this is the content of the file
↓
stored on disk at path based on hash (
Those 256 folders are just an address system telling Git (and your lit) where on disk the compressed bytes live.)

E.g
File content:
"hello"

1. Add header:
   blob 5\0hello
2. Hash (aka address):
   SHA1("blob 5\0hello") = b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
   first 2 (b6) is folder name
   last 38 (fc4c62...) is the file name
3. Compress data:
   compressedBytes = zlib.compress("blob 5\0hello") (binary compessed bytes)
4. Storing data:
   fs.writeFile(
   ".lit/objects/b6/fc4c620b67d95f953a5c1c1230aaab5db5a1b0",
   compressedBytes
   )

testing phase 2:

1. Running the command so you can get the hash
   $h = lit hash-object -w test.js
   $h

2. Determine location (first 2 characters of hash is the directory, the remaining is the filename)
   $dir = $h.Substring(0,2)
   $file = $h.Substring(2)
   Test-Path ".lit\objects\$dir\$file" //Print True

3. Decompress the file to get its content
   lit cat-file -p $h

Note: Different objects (files, trees, commits) can be stored in the same folder (the folder stored is the first 2 letter of the hash) if the first two hex characters of their SHA-1 hash are the same.

Mindblowing:
The hash is not just a label — it is a fingerprint of the content.
If the content changes, the fingerprint changes.
Git detects change by comparing fingerprints, not files.

Why 2 letters for each folder:

- needed a fast look up way
  if 1 char:
  16 folders , assuming 100,000 objects, thats 100,000/16 = 6250 files per folder which is alot

if 2 char:
16 x 16 = 256 folders, thats 100,000/256 = 390 files per folder. acceptable

if 3 char:
16 x 16 x 16 = 4096 folders, thats 100,000/4096 = 24 files per folder. more folders than file

Therefore, 2 char for each folder

Phase 3:
Building
lit write-tree: snapshot of your code. each time you run it creates a snapshot. store all of it in the objects folder.

lit ls-tree <treeHash>

100644 → regular file
040000 → folder (directory)

For files: straightforward. content -> raw data in bytes -> sha1 hash -> compress and stored
For folders: The folder’s hash is computed from a textual description listing filenames, types, and the hashes of the blobs/trees they point to.

eg
src/
a.js
b.js
↓
100644 blob aaaa1111 a.js
100644 blob bbbb2222 b.js
↓
add header: "tree <size>\0"
↓
tree 58\0100644 blob aaaa1111 a.js
100644 blob bbbb2222 b.js
↓
hash it: c4cc3333....
↓
Stored in the same way

Psuedocode:
FUNCTION writeTree(folderPath):

    entries = list all items inside folderPath
    remove ".lit" from entries

    sort entries by name
    (this ensures same folder state → same snapshot hash)

    treeEntries = empty list

    FOR EACH entry IN entries:

        fullPath = folderPath + "/" + entry.name

        IF entry is a file:
            content = read file bytes
            blobHash = writeBlob(content)
            add "file entry" to treeEntries:
                (mode=100644, type=blob, hash=blobHash, name=entry.name)

        ELSE IF entry is a folder:
            childTreeHash = writeTree(fullPath)
            add "folder entry" to treeEntries:
                (mode=040000, type=tree, hash=childTreeHash, name=entry.name)

    treeDescription = convert treeEntries into text lines
    treeBytes = convert treeDescription into bytes

    treeHash = writeTreeObject(treeBytes)

    RETURN treeHash

Phase 4:
Goal: Build commit history
Command:
lit commit-tree <tree-hash> -m "message"
e.g lit commit-tree t222... -m "first commit"

What does lit (or git) do behind the scene:

1. Read Head from .lit/HEAD → "ref: refs/heads/main"
2. Since its your first commit, there is nothing yet. so refs/heads/main does not exist yet
3. a. Build commit text (the "content"). Refer to commit anatomy.
   b. Convert the "content" into a hash
4. point the branch (.lit/refs/heads/main) to the latest commit hash

Commit anatomy:
A commit never points directly to files!! Points to one tree. thats why you write-tree -> commit-tree because you generate a hash for a tree, then use that hash to generate a commit hash.

1. tree hash - points to a snapshot of the project
2. parents commit hash - points to the previous commit.
3. metadata - author, timestamp, message

Commits for a linked list:
commit C (latest)
↓ parent
commit B
↓ parent
commit A

Overall framework for phase 4:
HEAD (tells us which branch we are on. eg we are on main, head points to main)
↓
branch [main] (shows entire commit history from latest to oldest)
↓
commit (the latest commit needs to point to the tree (which is essentially the phase 3 "description" for the entire overall file (ig the root) that was converted into a hash ))

Your refs/head/main stores the latest commit's hash. The previous commits hash is built into the "content" of the current commit, right before it is hashed.
↓
tree [the snapshot] (contains the information about every single file)
↓
blobs (file contents)

Example of seeing it at work:

1.  lit init - setting up from blank slate.
    .lit/
    objects/
    refs/
    heads/
    HEAD
    HEAD: points to refs/heads/main

2.  First commit
    a. Put wtv you want inside the folder
    b. $tree = lit write-tree
        $tree
        Goal: Create a tree hash
    c.  $commit1 = lit commit-tree $tree -m "first commit" -> create a tree hash 
        $commit1
        Goal: Use the tree hash to create a commit. Notice how ref/heads/main now store the hash ($commit1)
    d. lit cat-file -p $commit1
    Goal: Allow you to see what the hash is in text
    Example:
    tree 4334096df17061e2aa7ec848696b6157a999190f
    author Abel <Abel@lit.com> // Hardcoded author for now
    date 1766989076

    first commit

3.  Second commit:
    Repeat steps a, b, c
    for step d, you should see the same thing, just this time with a parent hash (this is how we linked them)

    Example:
    tree fc440601b4590fc2268b35ce9f16383c47bc13c8
    parent 293110c6053e18784340f51e5cb0bd460d9ff02a
    author Abel <Abel@lit.com>
    date 1766989130

    second commit

One step further: Building "lit log"!!!
running "lit log" shows the commit history

Example:
PS C:\Users\User\Desktop\lit\test-proj> lit log
commit 38d1a27f3fc49228286a293c45e5ded91ef6d3ed
Date: 2025-12-29T06:18:50.000Z

    second commit

commit 293110c6053e18784340f51e5cb0bd460d9ff02a
Date: 2025-12-29T06:17:56.000Z

    first commit

Pure english understanding of how to do it:
Once you get the commit hash, you convert it into text so we can see it, then extract the parent hash, then repeat until there is no parent hash.

git commit ultimately creates a tree and a commit object
But it does NOT snapshot your working directory directly
It snapshots the staging area (index)
Staging will be done in Phase 5

Phase 5:

Phase 5A:
Implementing the staging area so commits only commit what is being staged.
Goal:

1. lit add <file> → hash file into a blob object (Phase 2 writeObject) + record path blobHash in .lit/index

2. lit add . → walk the working directory recursively (like your old write-tree traversal), but instead of building trees, you stage files into the index

Current code up till Phase 4:
use 'lit write-tree' to recursively go throught the file system and generate hashes to get a tree hash

we will have index file in .lit -> staged item will be this file as a hash
e.g for .lit/index
a.txt b1117c3a5e3c8d8d8b1f6a2a0c2e4a9d1f2c3b4a
src/file.js 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b

when we wish to 'lit write-tree' again, we can just read what is being staged, and build the tree hash based on wtv is added in the staging area.

Steps to implement Phase 5A:
lit add . OR lit add directory: we need to traverse through the entire file structure, as long as the file isnt a .lit or node module file we add it. if its a directory within, we just traverse into it.

lit add filename: we just simply convert the file into the hash. We then use the app to insert or upsert

Sub-functions that help us (indexFile.js):

1. Read function (ReadIndex): Read the .lit/index file and convert it to a map(). The map() helps us maintain the data as we can insert or upsert
2. Write function (WriteIndex): Convert map to array -> Sort paths alphabetically -> Convert to text lines
3. Read and write function(SetIndexEntry): Combine the Read and write function to perform operation for one file

Phase 5B:
Modify the current write tree command (ls write-tree)

Logic: You want to get the tree hash (the "content"/"description" of the files that are staged). Start from the deepest folder (think of it as working from bottom up), generate a description of the staged files inside it, hash that description to create a tree object, then go up one level and repeat until you reach the root.

Steps to implement:
.lit/index file:
a.txt AAA111
src/test.js BBB222
src/utils/math.js CCC333

1. We read the index file to see all the files we need to traverse. We use readIndex() which reads the file and returns a map (key value store) of the file path and hash (e.g src/abc.txt -> 9f86......)
   indexMap = new Map([
   ["a.txt", "AAA111"],
   ["src/test.js", "BBB222"],
   ["src/utils/math.js", "CCC333"],
   ]);
2. Build a in memory folder structure from path
   a. Start from empty
   root = {
   files: new Map(),
   dirs: new Map(),
   };

   b. We go through the map. if it is a directory, check if it exist or not. if exist, we traverse inside, else we create a new directory
   root = {
   files: new Map([
   ["a.txt", "AAA111"]
   ]),
   dirs: new Map([
   ["src", {
   files: new Map([
   ["test.js", "BBB222"]
   ]),
   dirs: new Map([
   ["utils", {
   files: new Map([
   ["math.js", "CCC333"]
   ]),
   dirs: new Map()
   }]
   ])
   }]
   ])
   };

3. The new writeTree function
   a. for all files in the root, we can straightaway form '100644 blob ${blobHash} ${fileName}'
   b. For each directory, we recursively traverse through. this will allow us to get the hash of the folder (040000 tree ${SRC_TREE_HASH} src)
   c. finally once we have the file + folder hashes, the "content" will be used to generate the hash for the folder. a Tree hash is returned

Summary: Phase 5B allows us to write-tree from only the staged item (which is wtv is inside the index folder)

Phase 6:
lit checkout <commitHash> : Moves HEAD (and the current branch ref) to that commit. Updates the working directory to match it.

What is done in background (for git):

1. Read the commit object → get its tree <treeHash>
2. Read that tree object → list entries like:

100644 blob <blobHash> a.txt
040000 tree <treeHash> src

3. For each blob -> read the blob object , extract the raw content, write the file to the disk
4. For each tree -> recursively do the same inside that folder

Our implementation:

(a) Performing Check:
If a user did not commit their changes, we should block checkout.
Steps for checking:
HEAD: it is a pointer that tells git where you are at.

1. Read the HEAD commit hash (HEAD ──► refs/heads/main ──► <commit-hash>)
2. Read commit hash -> shows the entire file structure
3. Compute the current working directory hash (lets call it workTree)
4. workTree must be the same as the HEAD tree hash. Error message if not the same
   note: HEAD contains a commit hash. The commit contains a line tree <treeHash>
5. If safe, we clear everything in the folder except .lit

So now we have empty folder except for .lit folder
(b) Recreating the files of a specific hash

1. Read by decompressing the content
   e.g
   100644 blob BLOB_A1 a.txt
   040000 tree TS1 src

2. For each blob:
   decompress blob bytes , remove header blob <size>\0 , remainder = file content bytes , create a file to put the content.

3. For each directory: we need to expand the tree hash (taking the hash, finding where it is stored (the first 2 char and remaining 38), then using zlib to inflate). Recurse until all blobs/trees are materialized

(c) Update branch pointer
Update the refs/head/main to contain the hash that was checkout

Phase 7:
Goal: Build lit commit -m "message"

Steps to implement:

1. Check for arguments (must have a message)
2. Check that HEAD must point to a branch (something like ref: refs/heads/main ) in the HEADS file
3. Get parent hash - reading the previous commit from the refs/head/main so that you know that this was the hash of the previous commit
4. Create tree snapshot + create commit messgae (with all metadata so you have "content")
5. Create & write commit hash
