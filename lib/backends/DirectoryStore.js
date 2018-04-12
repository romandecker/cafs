/**
 * @author Roman Decker
 * Open sourced with permission from innovation.rocks consulting gmbh
 **/
'use strict';

const Promise = require('bluebird');
const fs = require('fs-extra');
const path = require('path');
const log = require('debug')('cafs:store:dir');
const stream = require('stream');
const _ = require('lodash');

/**
 * A store that will store blobs in a folder on disk.
 *
 * @param {Object} [options] DirectoryStore options
 * @param {Store} [options.base='.'] A proper cafs-store used for caching least recently used files
 * @param {Function} [options.log] Custom logging function (should behave like `console.log()`)
 *
 * @return {CacheStore} A new DirectoryStore
 */
function DirectoryStore(options) {
  options = _.defaults(options, { base: '.', log });
  this.base = options.base;
  this.log = options.log;
}

/**
 * Store the given stream under the given file name in the store's base directory.
 *
 * @param {String} key file name
 * @param {Stream} sourceStream The source stream to store
 * @return {Promise<>} Resolves when storing process has finished.
 */
// must export
DirectoryStore.prototype.ensure = function(key, sourceStream) {
  const pass = new stream.PassThrough();
  pass.pause();

  sourceStream.pipe(pass);

  return this.ensureParents(key).then(fullPath => {
    const writer = fs.createWriteStream(fullPath);

    return new Promise(function(resolve, reject) {
      pass.pipe(writer);
      pass.resume();

      writer.on('error', reject);
      pass.on('error', reject);
      pass.on('end', resolve);
    }).tap(() => this.log(`Wrote ${key} to disk at ${fullPath}`));
  });
};

/**
 * Streams the given key out of the store into the given destination. Options will be passed to
 * `stream.pipe()`.
 *
 * @param {String} key file name
 * @param {Writable} dest The destination stream to pipe to
 * @return {Promise<>} Resolves when streaming process has finished.
 */
// must export
DirectoryStore.prototype.stream = function(key, dest, options) {
  const fullPath = this.getFullPath(key);
  this.log(`Creating read-stream for ${key} at ${fullPath}`);

  const stream = fs.createReadStream(fullPath, options);

  stream.pipe(dest, options);

  return new Promise(function(resolve, reject) {
    stream.on('error', reject);
    stream.on('end', resolve);
  });
};

/**
 * Move source to dest.
 * @param {String} source file name
 * @param {Stream} dest file name
 * @return {Promise<>} Resolves when moving process has finished
 */
// must export
DirectoryStore.prototype.move = function(source, dest) {
  return Promise.join(this.getFullPath(source), this.ensureParents(dest)).spread(
    (sourcePath, destPath) => {
      this.log(`Moving ${sourcePath} to ${destPath}`);
      return fs.rename(sourcePath, destPath);
    }
  );
};

/**
 * copy source to dest.
 * @param {String} source file name
 * @param {Stream} dest file name
 * @return {Promise<>} Resolves when copying process has finished
 */
// must export
DirectoryStore.prototype.copy = function(source, dest) {
  return Promise.join(this.getFullPath(source), this.ensureParents(dest)).spread(
    (sourcePath, destPath) => {
      this.log(`Copying ${sourcePath} to ${destPath}`);
      console.log('Annnnnnd cooopy');
      return fs.copy(sourcePath, destPath);
    }
  );
};

/**
 * Checks whether the file at `key` exists in the base directory
 *
 * @param {String} key file name
 * @return {Promise<Boolean>} True if the file exists, otherwise false
 */
// must export
DirectoryStore.prototype.exists = function(key) {
  const fullPath = this.getFullPath(key);
  this.log(`Checking for ${key} at ${fullPath}`);
  return fs.exists(this.getFullPath(key));
};

/**
 * Remove the file with the given name from the base directory.
 *
 * @param {String} key file name
 * @return {Promise<>} Resolves when removal process has finished.
 */
// must export
DirectoryStore.prototype.unlink = function(key) {
  this.log(`Unlink ${key}`);
  return fs.unlink(this.getFullPath(key));
};

/**
 * Get the fully qualified path of the file with the given key.
 * @param {String} key file name
 * @return {String} The full path of the file
 */
DirectoryStore.prototype.getFullPath = function(key) {
  return path.resolve(path.join(this.base, key));
};

/**
 * Asynchronously create all parent directories needed to store afile under `key`.
 * 
 * @param {String} key file name
 * @return {Promise<String>} Full path of the passed key.
 
 */
DirectoryStore.prototype.ensureParents = function(key) {
  this.log(`Ensuring all parents exist for ${key}`);
  const fullPath = this.getFullPath(key);
  const parent = path.dirname(fullPath);
  return Promise.resolve(fs.ensureDir(parent)).then(() => fullPath);
};

module.exports = DirectoryStore;
