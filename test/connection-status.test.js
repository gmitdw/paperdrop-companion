import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectionStatus} from '../src/connection-status.js';
test('setup and expired sign-in have explicit different actions',()=>{
 assert.equal(connectionStatus('setup').action,'Connect OneDrive');
 assert.equal(connectionStatus('signin').action,'Sign in to OneDrive');
 assert.match(connectionStatus('signin').title,/uploads have stopped/);
 assert.match(connectionStatus('signin').text,/folder is remembered/);
});
test('incomplete delivery never claims connected and offers recovery',()=>{
 for(const state of ['setup','signin','folder','offline','error','pending','stale']){
  const info=connectionStatus(state);assert.ok(info.action);assert.notEqual(info.title,'OneDrive connected');
 }
 assert.equal(connectionStatus('connected').action,null);
});
