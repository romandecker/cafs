/**
 * @author Roman Decker
 * Open sourced with permission from innovation.rocks consulting gmbh
 **/
'use strict';

const Promise = require('bluebird');
const log = require('debug')('cafs:store:cache');
const stream = require('stream');
const _ = require('lodash');
const LRU = require('lru-cache');

const KiB = 1024;
const MiB = 1024 * KiB;

/**
 * A caching store that will hold recently used blobs in a faster store in a LRU-fashion. Actual
 * storage is delegated to the given two stores passed as options:
 *
 *   * `cacheStore`: The "quick" store used for caching a limited amount of blobs
 *   * `fallbackStore`: The "slower" store that holds all data
 *
 * @param {Object} options CacheStore options
 * @param {Store} options.cacheStore A proper cafs-store used for caching least recently used files
 * @param {Store} options.fallbackStore A proper cafs-store used for storing all data
 * @param {Number} [options.cacheLimit=104857600] Maximum amount of bytes to keep in cache (defaults to 100MiB)
 * @param {Function} [options.log] Custom logging function (should behave like `console.log()`)
 *
 * @return {CacheStore} A new CacheStore
 */
function CacheStore(options) {
  options = _.defaults({}, options, { log, cacheLimit: 100 * MiB });

  this.log = options.log;
  this.cacheStore = options.cacheStore;
  this.cacheLimit = options.cacheLimit;
  this.fallbackStore = options.fallbackStore;

  this.moves = {};
  this.lru = LRU({
    max: options.cacheLimit,
    length: size => size,
    noDisposeOnSet: true,
    dispose: key => {
      // do not unlink if key was moved
      if (this.moves[key]) {
        delete this.moves[key];
        return;
      }

      this.log(`Evicting ${key} from cache store`);
      return Promise.try(() => this.cacheStore.unlink(key)).then(() => {
        log(`Evicted ${key} from cache store, cache size: ${this.getCacheStatString()}`);
      });
    }
  });

  // proxy all methods in cache store
  _.forIn(this.cacheStore, (v, name) => {
    if (typeof v === 'function' && !this[name]) {
      // create a method here that calls its sibling in cacheStore first and then tries to call its
      // sibling in fallbackStore
      this[name] = function() {
        // call the original in cacheStore
        log(`Proxying invocation of ${name} to cache store`);
        const ret = this.cacheStore[name].apply(this.cacheStore, arguments);

        return thenSync(ret, () => {
          // try to also call the method in fallbackStore if it exists
          if (typeof this.fallbackStore[name] === 'function') {
            return this.fallbackStore[name].apply(this.fallbackStore, arguments);
          } else {
            log(`Cannot proxy call of ${name} to fallback store`);
            return ret;
          }
        });
      };
    }
  });

  // proxy all methods in fallback store
  _.forIn(this.fallbackStore, (v, name) => {
    if (typeof v === 'function' && !this[name]) {
      this[name] = function() {
        // first, try to call method in cache store if it exists
        let ret = null;
        if (typeof this.cacheStore[name] === 'function') {
          log(`Proxying invocation of ${name} to cache store`);
          ret = this.cacheStore[name].apply(this.fallbackStore, arguments);
        } else {
          log(`Cannot proxy call of ${name} to cache store`);
        }

        // afterwards, call the original in fallbackStore
        return thenSync(ret, () => this.fallbackStore[name].apply(this.fallbackStore, arguments));
      };
    }
  });
}

// must export
/**
 * Calls ensure on both the `cacheStore` and the `fallbackStore`.
 *
 * All arguments are passed as-is to the underlying stores.
 *
 * @return {Promise<null>}
 */
CacheStore.prototype.ensure = function(key, sourceStream) {
  let size = 0;
  this.log(`Ensuring ${key} in cache and fallback`);
  sourceStream.on('data', data => (size += data.length));
  return Promise.join(
    this.fallbackStore.ensure(key, sourceStream),
    this.cacheStore.ensure(key, sourceStream)
  ).spread(() => {
    this.lru.set(key, size);
    this.log(`Cached ${key} (${size} bytes), cache size: ${this.getCacheStatString()}`);
    return null;
  });
};

/**
 * Checks if the given key is present in the `cacheStore`, if yes will stream it directly from
 * there. If not, will stream it from the `fallbackStore` and cache it in the `cacheStore` for
 * future use. All arguments are passed as is to the underlying stores.
 *
 * @return {Promise<Any>} Returns whatever the used underlying store's `store#stream()` method
 * returned.
 */
// must export
CacheStore.prototype.stream = function(key, dest, options) {
  this.log(`Checking for ${key} in cache store`);
  const size = this.lru.get(key);
  if (size) {
    this.log(`Cache hit for ${key}, streaming directly from cache`);
    return this.cacheStore.stream(key, dest, options);
  } else {
    this.log(`Cache miss for ${key}, streaming from fallback store`);
    const pass = new stream.PassThrough();
    pass.pipe(dest, options);
    return Promise.join(
      this.fallbackStore.stream(key, pass, options),
      this.cacheStore.ensure(key, pass)
    ).spread(result => {
      this.log(`Caching ${key} for future use`);
      this.lru.get(key);
      return result;
    });
  }
};

/**
 * Calls move on both stores. All arguments are passed as-is to the underlying stores. Checks if the
 * object is present in the `cacheStore` before moving.
 *
 * @return {Promise<[Any, Any]>} Whatever the underlying `fallbackStore` and `cacheStore` returned.
 */
// must export
CacheStore.prototype.move = function(source, dest) {
  this.moves[source] = dest;
  return Promise.join(
    this.fallbackStore.move(source, dest),
    // object may no longer exist in cache store due to eviction
    Promise.try(() => this.cacheStore.exists(source)).then(
      exists => exists && this.cacheStore.move(source, dest)
    )
  ).tap(() => {
    const size = this.lru.get(source);
    this.lru.del(source);
    this.lru.set(dest, size);
    this.log(`Renamed cache entry ${source} to ${dest}`);
  });
};

/**
 * Checks whether or not the given key exists in the `fallbackStore`. The cacheStore is not queried,
 * because it might not exist there due to cache eviction.
 *
 * @return {Promise<Any>} Whatever the underlying `fallbackStore`'s `exists()` function returned.
 */
// must export
CacheStore.prototype.exists = function(key) {
  return this.fallbackStore.exists(key);
};

/**
 * Removes the blob with the given key from both stores. All arguments are passed as-is to both
 * underlying stores.
 *
 * @return {Promise<Any>} Whatever the underlying `fallbackStore`'s `unlink()` method returned
 */
// must export
CacheStore.prototype.unlink = function(key) {
  this.log(`Unlink ${key}`);
  return Promise.join(this.fallbackStore.unlink(key), this.cacheStore.unlink(key)).spread(
    ret => ret
  );
};

/**
 * Gets a cache stats as string (used for debug-logs)
 *
 * @return {String} Cache stats.
 */
CacheStore.prototype.getCacheStatString = function() {
  return `${this.lru.length}/${this.cacheLimit} (${Math.round(
    this.lru.length / this.cacheLimit * 10000
  ) / 100}%)`;
};

module.exports = CacheStore;

/** If obj is a promise, call fn after it is fulfilled, else call it immediately */
function thenSync(obj, fn) {
  if (obj && typeof obj.then === 'function') {
    return obj.then(fn);
  } else {
    return fn();
  }
}
