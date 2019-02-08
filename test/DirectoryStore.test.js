/**
 * @author Roman Decker
 * Open sourced with permission from innovation.rocks consulting gmbh
 **/

'use strict';

const cafs = require('../index.js');
const uuid = require('uuid');
const os = require('os');

const chai = require('chai');
const expect = chai.expect;
const fs = require('fs-extra');
const path = require('path');
chai.use(require('chai-as-promised'));

describe('DirectoryStore', function() {
  let base = path.join(os.tmpdir(), uuid.v4());
  let cfs;

  beforeEach(function() {
    return fs.emptyDir(base).then(function() {
      cfs = cafs({
        store: new cafs.DirectoryStore({ base }),
        mapKey: ({ hash }) => (hash ? hash : path.join(os.tmpdir(), uuid.v4()))
      });
    });
  });

  describe('#put', function() {
    it('should work with a temporary path with a different root', function() {
      return cfs
        .put(Buffer.from('This should be stored under /tmp'))
        .then(info => cfs.readFile(info))
        .then(function(buf) {
          expect(buf.toString('utf-8')).to.equal('This should be stored under /tmp');
        });
    });
  });
});
