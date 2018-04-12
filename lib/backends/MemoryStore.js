/**
 * @author Roman Decker
 * Open sourced with permission from innovation.rocks consulting gmbh
 **/

'use strict';

const Promise = require('bluebird');
const log = require('debug')('cafs:store:memory');
const _ = require('lodash');
const streamBuffers = require('stream-buffers');

/**
 * A store that will store blobs in memory (primarily designed to be used for caching or testing).
 *
 * Internally, all blobs are just stored as buffers in a single object under the respective key.
 *
 * @param {Object} [options] MemoryStore options
 * @param {Function} [options.log] Custom logging function (should behave like `console.log()`)
 *
 * @return {CacheStore} A new MemoryStore
 */
function MemoryStore(options) {
  options = _.defaults(options, { log });
  this.log = options.log;
  this.data = {};
}

/**
 * Stores the given stream under the given key.
 *
 * @param {String} key key
 * @param {Stream} sourceStream The source stream to store
 * @return {Promise<>} Resolves when storing process has finished.
 */
// must export
MemoryStore.prototype.ensure = function(key, sourceStream) {
  const writer = new streamBuffers.WritableStreamBuffer();

  sourceStream.pipe(writer);

  return new Promise(function(resolve, reject) {
    writer.on('error', reject);
    sourceStream.on('error', reject);
    sourceStream.on('end', resolve);
  }).tap(() => {
    const buf = writer.getContents();
    this.data[key] = buf;
    this.log(`Saved ${buf.length} bytes under ${key}`);
  });
};

/**
 * Streams the given key out of the store into the given destination. Options will be passed to
 * `stream.pipe()`.
 *
 * @param {String} key key
 * @param {Writable} dest The destination stream to pipe to
 * @return {Promise<>} Resolves when streaming process has finished.
 */
// must export
MemoryStore.prototype.stream = Promise.method(function(key, dest, options) {
  const reader = new streamBuffers.ReadableStreamBuffer();

  const buf = this.data[key];
  if (!buf) {
    throw new Error(`Key '${key}' does not exist!`);
  }

  reader.put(buf);
  reader.stop();
  reader.pipe(dest, options);

  return new Promise(function(resolve, reject) {
    reader.on('error', reject);
    reader.on('end', resolve);
  });
});

/**
 * Move source to dest.
 * @param {String} source Source key
 * @param {Stream} dest Destination key
 * @return {Promise<>} Resolves when moving process has finished
 */
// must export
MemoryStore.prototype.move = Promise.method(function(source, dest) {
  const buf = this.data[source];
  if (!buf) {
    throw new Error(`Key '${source}' does not exist!`);
  }

  delete this.data[source];
  this.data[dest] = buf;
  this.log(`Renamed cache entry ${source} to ${dest}`);
});

/**
 * Checks whether the the given key exists in the store
 *
 * @param {String} key key
 * @return {Promise<Boolean>} True if the key exists, otherwise false
 */
// must export
MemoryStore.prototype.exists = function(key) {
  return !!this.data[key];
};

/**
 * Remove the blob with the given key
 *
 * @param {String} key file name
 * @return {Promise<>} Resolves when removal process has finished.
 */
// must export
MemoryStore.prototype.unlink = function(key) {
  this.log(`Unlink ${key}`);
  delete this.data[key];
};

module.exports = MemoryStore;
