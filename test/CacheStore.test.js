/**
 * @author Roman Decker
 * Open sourced with permission from innovation.rocks consulting gmbh
 **/
'use strict';

const cafs = require('../index.js');

const _ = require('lodash');
const Promise = require('bluebird');
const uuid = require('uuid');
const os = require('os');
const fs = require('fs-extra');
const path = require('path');
const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));

describe('CacheStore', function() {
  let base = path.join(os.tmpdir(), uuid.v4());
  let directoryStore, memoryStore;
  let cachedFs, fallbackFs;

  beforeEach(function() {
    return fs.emptyDir(base).then(function() {
      directoryStore = new cafs.DirectoryStore({ base });
      memoryStore = new cafs.MemoryStore();

      sinon.spy(directoryStore, 'ensure');
      sinon.spy(directoryStore, 'stream');
      sinon.spy(memoryStore, 'ensure');
      sinon.spy(memoryStore, 'stream');
      sinon.spy(memoryStore, 'unlink');

      fallbackFs = cafs({ store: directoryStore });
      cachedFs = cafs({
        store: new cafs.CacheStore({
          fallbackStore: directoryStore,
          cacheLimit: 100, // 100 bytes of cache
          cacheStore: memoryStore
        }),
        keepExtension: true
      });
    });
  });

  describe('proxying', function() {
    let cacheStore;

    context('sync', function() {
      beforeEach(function() {
        directoryStore.onlyOnFallback = sinon.spy(() => 'fallback');
        memoryStore.onlyOnCache = sinon.spy(() => 'cache');
        directoryStore.onCacheAndFallback = sinon.spy(() => 'bothFallback');
        memoryStore.onCacheAndFallback = sinon.spy(() => 'bothCache');

        cacheStore = new cafs.CacheStore({
          fallbackStore: directoryStore,
          cacheLimit: 100, // 100 bytes of cache
          cacheStore: memoryStore
        });
      });

      it('should proxy to methods only on the fallback store', function() {
        const ret = cacheStore.onlyOnFallback('hello', 1, true);

        expect(directoryStore.onlyOnFallback).to.have.been.calledWith('hello', 1, true);
        expect(ret).to.equal('fallback');
      });

      it('should proxy to methods only on the cache store', function() {
        const ret = cacheStore.onlyOnCache('foo', 2, [false]);

        expect(memoryStore.onlyOnCache).to.have.been.calledWith('foo', 2, [false]);
        expect(ret).to.equal('cache');
      });

      it('should proxy to methods on both, fallback and cache store', function() {
        const ret = cacheStore.onCacheAndFallback('bar', 3, [/asdf/]);

        expect(memoryStore.onCacheAndFallback).to.have.been.calledWith('bar', 3, [/asdf/]);
        expect(directoryStore.onCacheAndFallback).to.have.been.calledWith('bar', 3, [/asdf/]);

        expect(ret).to.equal('bothFallback');
      });

      it('should not proxy non-existing methods', function() {
        expect(() => cacheStore.doesntExist()).to.throw(/cacheStore.doesntExist is not a function/);
      });
    });

    context('async', function() {
      beforeEach(function() {
        directoryStore.onlyOnFallback = sinon.spy(() => Promise.resolve('fallback'));
        memoryStore.onlyOnCache = sinon.spy(() => Promise.resolve('cache'));
        directoryStore.onCacheAndFallback = sinon.spy(() => Promise.resolve('bothFallback'));
        memoryStore.onCacheAndFallback = sinon.spy(() => Promise.resolve('bothCache'));

        cacheStore = new cafs.CacheStore({
          fallbackStore: directoryStore,
          cacheLimit: 100, // 100 bytes of cache
          cacheStore: memoryStore
        });
      });

      it('should proxy to methods only on the fallback store', function() {
        const ret = cacheStore.onlyOnFallback('hello', 1, true);

        expect(directoryStore.onlyOnFallback).to.have.been.calledWith('hello', 1, true);
        return expect(ret).to.eventually.equal('fallback');
      });

      it('should proxy to methods only on the cache store', function() {
        const ret = cacheStore.onlyOnCache('foo', 2, [false]);

        expect(memoryStore.onlyOnCache).to.have.been.calledWith('foo', 2, [false]);
        return expect(ret).to.eventually.equal('cache');
      });

      it('should proxy to methods on both, fallback and cache store', function() {
        const ret = cacheStore.onCacheAndFallback('bar', 3, [/asdf/]);

        return expect(ret)
          .to.eventually.equal('bothFallback')
          .then(function() {
            expect(memoryStore.onCacheAndFallback).to.have.been.calledWith('bar', 3, [/asdf/]);
            expect(directoryStore.onCacheAndFallback).to.have.been.calledWith('bar', 3, [/asdf/]);
          });
      });
    });
  });

  describe('#put', function() {
    it('should work put files in cache and fallback store', function() {
      return cachedFs
        .put(new Buffer('This should be stored under /tmp'))
        .bind({})
        .tap(function() {
          expect(directoryStore.ensure).to.have.been.calledOnce;
          expect(memoryStore.ensure).to.have.been.calledOnce;
        })
        .then(function(info) {
          this.info = info;

          return cachedFs.readFile(info);
        })
        .then(function(cachedBuf) {
          expect(memoryStore.stream).to.have.been.called;
          expect(directoryStore.stream).to.not.have.been.called;
          expect(cachedBuf.toString('utf-8')).to.equal('This should be stored under /tmp');

          return fallbackFs.readFile(this.info);
        })
        .then(function(fallbackBuf) {
          expect(fallbackBuf.toString('utf-8')).to.equal('This should be stored under /tmp');
        });
    });

    it('should correctly evict files from cacheStore', function() {
      let as = _.repeat('a', 40);
      let bs = _.repeat('b', 40);
      let cs = _.repeat('c', 40);

      return cachedFs
        .put(new Buffer(as))
        .bind({})
        .then(function(info) {
          this.aInfo = info;
          expect(memoryStore.unlink).to.not.have.been.called;

          return cachedFs.put(new Buffer(bs));
        })
        .then(function(info) {
          this.bInfo = info;
          expect(memoryStore.unlink).to.not.have.been.called;

          return cachedFs.put(new Buffer(cs));
        })
        .then(function(info) {
          this.cInfo = info;
          expect(memoryStore.unlink).to.have.been.called;

          return cachedFs.readFile(this.bInfo);
        })
        .then(function(buf) {
          expect(buf.toString('utf-8')).to.equal(bs);
          expect(memoryStore.stream).to.have.been.called;
          expect(directoryStore.stream).to.not.have.been.called;

          return cachedFs.readFile(this.aInfo);
        })
        .then(function(buf) {
          expect(buf.toString('utf-8')).to.equal(as);
          expect(directoryStore.stream).to.have.been.called;
        });
    });
  });
});
