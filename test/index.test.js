/**
 * @author Roman Decker
 * Open sourced with permission from innovation.rocks consulting gmbh
 **/
'use strict';

const EventEmitter = require('events');
const uuid = require('uuid');
const os = require('os');
const Promise = require('bluebird');
const fs = require('fs-extra');
const path = require('path');
const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

const cafs = require('../index.js');

describe('cafs', function() {
  let base = path.join(__dirname, 'storage');
  let cfs;

  const mapKey = ({ hash, meta }) => {
    if (!hash) {
      return `tmp/${uuid.v4()}` + meta.ext;
    } else {
      return hash + meta.ext;
    }
  };

  runParameterizedTests();
  runParameterizedTests(mapKey);

  function runParameterizedTests(mapKey) {
    let description;
    if (mapKey) {
      description = 'with custom mapKey';
    } else {
      description = 'without custom mapKey';
    }

    context(description, function() {
      beforeEach(function() {
        return fs.emptyDir(base).then(function() {
          cfs = cafs({
            store: new cafs.DirectoryStore({ base }),
            mapKey
          });
        });
      });

      describe('#readFile', function() {
        it('should throw an error when trying to get a non-existant file', function() {
          return expect(cfs.readFile('abc')).to.eventually.be.rejectedWith('ENOENT');
        });
      });

      describe('#put', function() {
        it('should work with buffers', function() {
          return expect(cfs.hasContent(new Buffer('hello, world!'), { ext: '.txt' }))
            .to.eventually.equal(false)
            .then(() => cfs.put(new Buffer('hello, world!'), { ext: '.txt' }))
            .then(function(info) {
              expect(info.meta).to.have.property('ext', '.txt');
              expect(info).to.have.property('size', 13);

              return Promise.join(
                cfs.readFile(info),
                expect(cfs.has(info)).to.eventually.equal(true),
                expect(cfs.has(info.key)).to.eventually.equal(true),
                expect(
                  cfs.hasContent(new Buffer('hello, world!'), { ext: '.txt' })
                ).to.eventually.equal(true)
              );
            })
            .spread(function(buf) {
              expect(buf.toString('utf-8')).to.equal('hello, world!');
            });
        });

        it('should work with file-paths', function() {
          const tmpPath = path.join(os.tmpdir(), uuid.v4() + '.txt');
          return fs
            .outputFile(tmpPath, 'This is a test')
            .then(() => cfs.put(tmpPath, 'test.txt'))
            .then(info => cfs.readFile(info))
            .then(function(buf) {
              expect(buf.toString('utf-8')).to.equal('This is a test');
            });
        });

        it('should work with streams', function() {
          const tmpPath = path.join(os.tmpdir(), uuid.v4() + '.txt');
          return fs
            .outputFile(tmpPath, 'This is another test')
            .then(() => cfs.put(fs.createReadStream(tmpPath), 'test.txt'))
            .then(info => cfs.readFile(info))
            .then(function(buf) {
              expect(buf.toString('utf-8')).to.equal('This is another test');
            });
        });

        it('should correctly handle files with same content', function() {
          return cfs
            .put(new Buffer('hello, world!'), { ext: '.txt' })
            .bind({})
            .then(function(info1) {
              this.info1 = info1;
              expect(info1).to.have.property('size', 13);
              expect(info1.meta).to.have.property('ext', '.txt');
              return cfs.readFile(info1);
            })
            .then(function(buf) {
              expect(buf.toString('utf-8')).to.equal('hello, world!');

              return cfs.put(new Buffer('hello, world!'), { ext: '.txt' });
            })
            .then(function(info2) {
              this.info2 = info2;
              expect(info2).to.have.property('size', 13);
              expect(info2.meta).to.have.property('ext', '.txt');

              return cfs.readFile(info2);
            })
            .then(function(buf) {
              expect(buf.toString('utf-8')).to.equal('hello, world!');

              expect(this.info1.hash).to.equal(this.info2.hash);
            });
        });
      });

      it('should correctly handle errors in source-stream', function() {
        const failingStream = new EventEmitter();
        failingStream.pipe = function() {
          Promise.delay(100)
            .then(() => this.emit('data', 'hello'))
            .delay(50)
            .then(() => this.emit('error', new Error('aargh')))
            .delay(100)
            .then(() => this.emit('data', ' world!'))
            .then(() => this.emit('end'));

          return null;
        };

        return expect(cfs.put(failingStream, 'hello.txt')).to.be.rejectedWith(/^aargh$/);
      });

      describe('#unlink', function() {
        it('should remove a file', function() {
          return cfs
            .put(new Buffer('hello, world!'), 'hello.txt')
            .bind({})
            .then(function(info) {
              this.info = info;

              return cfs.unlink(info);
            })
            .then(function() {
              return expect(cfs.has(this.info)).to.eventually.equal(false);
            });
        });
      });
    });
  }
});
