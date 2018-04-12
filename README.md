CAFS (Content-Addressed File System)
====================================

Easily store blobs in a content-addressed fashion in various back-ends. Open sourced with permission
from innovation.rocks consulting gmbh

## What's "content-addressed"?

Content-addressed means, that everything you store will be hashed and actually stored under its
hash. You can later retrieve the full data by its hash again. This gives you the advantage that even
if you store the exact same content twice, you will only ever allocate the relevant memory once.

This can be a very useful characteristic, imagine for example you run a website where users can
upload arbitrary data. When you use a content-addressed file-system, you only ever store each file
once, even if multiple users upload the same stuff!

## Flexibility

`cafs` is built so that you can easily switch out the underlying back-end store. Probably the
simplest store is the included `cafs.DirectoryStore` which uses a directory on your local file
system to store all blobs in a flat hierarchy. There's also `cafs.MemoryStore`, which stores all
data in memory and is mainly designed for mocking and testing.

Additionaly, there's `cafs-s3store` (published as a separate module), which will use AWS' S3 to
store your blobs.

Bonus: You can combine two stores by using the included `cafs.CacheStore` which works as a two-level
cache for stores.

## Installation

``` shell
npm install @inr/cafs
```

## Usage
``` javascript
const cafs = require('@inr/cafs')({
  store: new cafs.DirectoryStore('./storage')
});

cafs.put(new Buffer('hello, cafs!'), 'hello.txt')
.then(info => cafs.readFile(info))
.then(contents => console.log(contents));
```

## API

### cafs( options )

Construct a new `cafs`.

* `options`: Options for cafs
* `options.store`: The underlying store to use
* `[options.hashAlgorithm = 'sha1']`: The underlying hashing algorithm to use (any of `crypto.getHashes()`)
* `[options.getTemporaryKey]`: A function used to generate unique keys when storing temporary blobs
* `[options.log]`: A custom logging function, should behave like `console.log()`

