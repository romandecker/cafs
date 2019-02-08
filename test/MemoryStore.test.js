/**
 * @author Roman Decker
 * Open sourced with permission from innovation.rocks consulting gmbh
 **/

'use strict';

const cafs = require('../index.js');

const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

describe('MemoryStore', function() {
  let cfs;

  beforeEach(function() {
    cfs = cafs({
      store: new cafs.MemoryStore(),
      keepExtension: true
    });
  });

  describe('#put', function() {
    it('should store files in memory', function() {
      return cfs
        .put(Buffer.from('This should be stored under /tmp'))
        .then(info => cfs.readFile(info))
        .then(function(buf) {
          expect(buf.toString('utf-8')).to.equal('This should be stored under /tmp');
        });
    });
  });
});
