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
npm install cafs
```

## Usage
``` javascript
const cafs = require('cafs')({
  store: new cafs.DirectoryStore('./storage')
});

cafs.put(new Buffer('hello, cafs!'), 'hello.txt')
.then(info => cafs.readFile(info))
.then(contents => console.log(contents));
```

## General concept

Putting a file into the cafs is a two-part operation:

1) Stream the file to a temporary location, calculating the hash while streaming
2) Move the file to its persistent location, depending on the hash.

This way, we can quickly store files in slower stores by streaming the file directly into the store,
and only issuing a `move`-operation (to it's hash-dependent name), once the stream ends. The
`mapKey` function you pass to the `cafs`-constructor plays the most important role here: It has to
map an object holding information about a blob that is about to be stored to its key in the
store.

`mapKey` is called immediately when the first step is happening (when the hash of the stream
is not yet known) and is passed only the metadata of the blob (as passed to `preparePut`/`put`). In
this step, `mapKey` can simply return a uniquely random string to store the file as.

After streaming has finished and the hash for the blob has been calculated, `mapKey` is called
again, this time **with** the hash in the `info`-object and it should return a key that is dependend
on the hash.

The default implementation of `mapKey` simply returns a `UUID` for step 1 and the hash itself for
step 2. You can however customize `mapKey` to your needs, for example if you wish to make the key
dependent on some meta-data as well. One sample use-case would be if you want to add the
file-extension of each blob to its key (you are yourself responsible to always pass the correct
meta-data to your calls of `put`/`preparePut`).

Be aware that you are in charge of storing the info returned by `preparePut`/`put` so that `cafs`
can later find your blobs again.

## API

### `cafs(options)`

Construct a new `cafs`.

* `options`: Options for cafs
* `options.store`: The underlying store to use
* `[options.hashAlgorithm = 'sha1']`: The underlying hashing algorithm to use (any of `crypto.getHashes()`)
* `[options.mapKey = info => (info.hash ? info.hash uuid.v4())]`: A function used to obtain the key for a
  blob when storing it
* `[options.log]`: A custom logging function to be used instead of `debug`, should behave like `console.log()`

After a `cafs` is initialized, you can then use the `put` function to stream data into the store,
and the `stream` function to get data out of the store. The `mapKey` option is rather important, as
it dictates the key under which every blob will be stored in the underlying store. It receives an
`info`-object, consisting of `{ hash, meta }`, where `meta` is the meta-data passed to `preparePut`
or `put` when storing the file. `hash` is optional (as the hash for a stream can not be known until
it completes).

#### `Cafs#put(source, meta)`

Stream a blob into the `cafs`. `source` can be a string (= file name), a `Readable`, or a `Buffer`
directly. `meta` will be passed to `mapKey` in order to determine both the temporary key used during
streaming and the final key for the blob once streaming has finished. This function basically calls
`Cafs#preparePut` followed by `Cafs#finalizePut`.

#### `Cafs#stream(info, dest, options)`

Stream a file out of the `cafs` into `dest` (which should be something that can be `pipe()`d
to). Info may be a key or an object holding a `key` property that represents the key. `options` will
be passed as-is to the underlying store's `stream` function. Returns a promise that resolves when
streaming has finished.

#### `Cafs#readFile(info, options)`

Same as `Cafs#stream` but resolves with a buffer of the blob's contents directly for convenience.


#### `Cafs#getTemporaryFile(info, options=path.join(os.tmpdir(), uuid.v4()))`

Sometimes, you simply need a blob as a file, for example if you need random-file-access (e.g. for
unzipping). `getTemporaryFile` streams the file to a temporary location and returns a promise
resolving with the path to the file. The promise is a bluebird-promise which can be disposed with
`Promise.using()`.

Example usage:

``` javascript 
const Promise = require('bluebird');

// [...]

return Promise.using( cafs.getTemporaryFile(info), filePath => {
  // ... do something with filePath ...
} )
.then( () => {
  // file will be deleted here again
} )
```

If you are not using `Promise.using()` you have to clean up the file yourself! `options` can be a
string which will be the used as the temporary path, or an object holding a `suffix` property which
will be appended to a random temporary file name if specified.


#### `Cafs#preparePut(source, meta)`

Prepare storing a new blob in the cafs. This will cause the underlying store to receive a call to
`ensure` with a temporary key (as generated by calling `options.mapKey` without a hash). The put
operation can be finalized by calling `cafs#finalizePut` with the returned object (or just its
`key`). Like `put`, this takes either a `string`, `Readable` or `Buffer` as source and any
`meta`-data will be passed to `mapKey`. Returns a promise resolving when the put is prepared.

#### `Cafs#finalizePut(info)`

Finalize a put-operation prepared by `cafs#preparePut()`. Take in an info-object as returned by
`cafs#preparePut()`. Alternatively, just a `key` can be passed as well. This will use
`options.mapKey` to determine the key under which to store the final blob in the store and than
called `store#move()` to move the temporary blob created by `cafs#preparePut()` there. Returns a
promise resolving when the blob is stored.

#### `Cafs#unlink(info)`

Alias: `Cafs#remove(info)`

Removes the given file from the cafs. `info` should be the key returned from `preparePut` or an
object holding the key under `key`. Returns a promise resolving when removal has finished.

#### `Cafs#has(info)`

Checks if there is already a blob with that key in the underlying store. `info` can be the key
directly, or an object holding a `key` property.

#### `Cafs#hasContent(source, meta)`

Just like `cafs#has()` but takes the same arguments as `cafs#put` and checks whether or not this
blob is already present in the underlying store.

Alias: `Cafs#hasFile(source, meta)`

### `new DirectoryStore(options)`

Create a new store that will save all blobs in the file system at a given directory indicated by the
`base` option. Options:

* `base='.'`: The directory to use for storing all blobs
* `log`: Custom logging function to use instead of `debug`. Should behave like `console.log()`.

### `new MemoryStore(options)`

Create a new store that will save all blobs in-memory. This is mainly useful for testing or - in
combination with the `CacheStore` - for caching. Options:

* `log`: Custom logging function to use instead of `debug`. Should behave like `console.log()`.

### `new CacheStore(options)`

On creation, the `CacheStore` is given two other stores: a `cacheStore`, which will be used to cache
blobs up to a certain limit and a `fallbackStore` that will be used to store all blobs. Ideally, the
`cacheStore` should be a fast store (like the `MemoryStore`) in order to facilitate good caching
behaviour. Blobs will be kept in the `cacheStore` until a certain total size of blobs is reached at
which point blobs are evicted from the `cacheStore` in an LRU-fashion. Options:

* `cacheStore`: The "fast" store to use as a cache, can be any `cafs`-compatible store will hold a
  subset of the blobs in the `fallbackStore` at all times
* `fallbackStore`: The store to use as a fallback, will hold all stored blobs
* `cacheLimit`: Maximum size (in bytes) of the `cacheStore`. Blobs will be evicted from the
  `cacheStore` to stay below this limit
* `log`: Custom logging function to use instead of `debug`. Should behave like `console.log()`.

# Implementing your own store

Stores must be objects holding 5 functions:

## `ensure(key, sourceStream) -> Promise`

This function must store data coming in from `sourceStream` under the given key. Calls to `stream`
with the same key (= a string) should retrieve stored blob again. If the key already exists in the
store, it must be overwritten. The function must return a promise that resolves when the store
process has finished.

## `stream(key, dest, options) -> Promise`

This function must retrieve a blob stored under a `key` from the store. It should stream the
blob-data to the given `dest`, which is a `Writable` and return a promise that resolves when the
streaming process has finished. `options` can be implementation-specific and are whatever options
are passed to `Cafs#stream(info, dest, options)`. If the key does not exist, the returned promise
should be rejected with an error.

## `move(source, dest) -> [Promise]`

This function must move a blob from the `source` key to the `dest` key in the store. This function
may return a Promise (but doesn't have to). If `source` does not exist, an error should be thrown or
the returned Promise should be rejected. If `dest` already exists, it should simply be overwritten.

## `exists(key) -> Boolean|Promise<Boolean>`

This function must check whether or not a blob is stored under the given key in the store. It can
either return a boolean directly or return a promise that resolves to a boolean.

## `unlink(key) -> [Promise]`

This function must remove the blob with the given key from the store.

# Debugging

Debug-logs are done by the excellent `debug` package. Just set `DEBUG=cafs` to see debug logs of
`cafs`.
